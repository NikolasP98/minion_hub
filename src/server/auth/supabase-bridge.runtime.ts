// Runtime helper — imports $server/supabase (which needs $env shims).
// Kept separate from supabase-bridge.ts so the pure mapper stays unit-testable.
import type { RequestEvent } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer, supabaseAdmin } from '$server/supabase';
import { mapProfileToUser, type BridgedUser, type ProfileRow } from './supabase-bridge.js';

export type { BridgedUser } from './supabase-bridge.js';

/**
 * Runtime: resolve the current Supabase user (if any) into the hub user shape.
 * Returns null when unauthenticated. Reads role/id from public.profiles via the
 * service-role client (RLS-independent, server-side).
 *
 * Performance: identity is established with `getClaims()`, which verifies the
 * access-token signature LOCALLY (no GoTrue round-trip) when the project uses
 * asymmetric JWT signing keys, and transparently falls back to a `getUser()`
 * network call for legacy HS256 tokens — so this is never less correct than the
 * old `getUser()`, just faster on the common path.
 *
 * Optional `client` / `accessToken` let the caller (resolve-identity) reuse the
 * request-scoped client and the token it already read for cache keying, avoiding
 * a duplicate `getSession()`.
 */
export async function resolveSupabaseUser(
  event: RequestEvent,
  client?: SupabaseClient,
  accessToken?: string,
): Promise<BridgedUser | null> {
  const supabase = client ?? supabaseServer(event);
  const { data: claimsData, error } = accessToken
    ? await supabase.auth.getClaims(accessToken)
    : await supabase.auth.getClaims();
  const claims = claimsData?.claims as
    | { sub?: string; email?: string | null; user_metadata?: Record<string, unknown> | null }
    | undefined;
  if (error || !claims?.sub) return null;
  const userId = claims.sub;

  const admin = supabaseAdmin();

  // Single round-trip: pull core identity + enrichment columns together. If an
  // enrichment column isn't migrated yet PostgREST errors the whole select, so
  // we retry with the CORE-only column set — login must never break on
  // migration lag. (legacy_user_id was dropped in S7: GoTrue principal id ==
  // profile uuid, no bridge needed.)
  let profile: ProfileRow | null = null;
  const full = await admin
    .from('profiles')
    .select('id, email, display_name, role, avatar_url, created_at')
    .eq('id', userId)
    .single();
  if (!full.error && full.data) {
    profile = full.data as ProfileRow;
  } else {
    const core = await admin
      .from('profiles')
      .select('id, email, display_name, role')
      .eq('id', userId)
      .single();
    profile = (core.data as ProfileRow | null) ?? null;
  }

  // Fall back to the Google OAuth metadata avatar when the profile row has none.
  const metadataAvatar =
    (claims.user_metadata?.avatar_url as string) ??
    (claims.user_metadata?.picture as string) ??
    null;

  return mapProfileToUser(
    profile
      ? { ...profile, avatar_url: profile.avatar_url ?? metadataAvatar }
      : {
          id: userId,
          email: claims.email ?? null,
          display_name: (claims.user_metadata?.full_name as string) ?? null,
          avatar_url: metadataAvatar,
          role: null,
          created_at: null,
        },
    userId,
  );
}

/**
 * Resolve a user's active tenant (org id) from the canonical Supabase
 * `organization_members` ⋈ `organizations`, keyed by the SUPABASE profile id
 * (`auth.uid()` = profiles.id = user.supabaseId). This is the Turso-free
 * tenancy source: it does NOT touch the better-auth/Turso `member` table or the
 * legacy id bridge.
 *
 * Ordering matches `loadOrganizationsForUser` (alphabetical by name) so the
 * resolved active org is consistent with the sidebar org picker's default.
 * If `preferredOrgId` is one of the user's memberships it wins (honors an
 * explicit org selection); otherwise the alphabetical-first org is the default.
 *
 * Returns null (never throws) when Supabase is unreachable or the user has no
 * membership, so callers can fall back to the legacy Turso path during bake-in.
 */
export async function resolveSupabaseTenant(
  supabaseId: string,
  preferredOrgId?: string | null,
): Promise<{ orgId: string } | null> {
  try {
    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from('organization_members')
      .select('organizations(id, name)')
      .eq('profile_id', supabaseId);
    if (error || !data) return null;

    type OrgRow = { id: string; name: string | null };
    type MemRow = { organizations: OrgRow | OrgRow[] | null };
    const orgs = (data as unknown as MemRow[])
      .map((row) => (Array.isArray(row.organizations) ? row.organizations[0] : row.organizations))
      .filter((o): o is OrgRow => o != null)
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

    if (orgs.length === 0) return null;
    if (preferredOrgId && orgs.some((o) => o.id === preferredOrgId)) {
      return { orgId: preferredOrgId };
    }
    return { orgId: orgs[0].id };
  } catch {
    return null;
  }
}
