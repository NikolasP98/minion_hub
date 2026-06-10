// Runtime helper — imports $server/supabase (which needs $env shims).
// Kept separate from supabase-bridge.ts so the pure mapper stays unit-testable.
import type { RequestEvent } from '@sveltejs/kit';
import { supabaseServer, supabaseAdmin } from '$server/supabase';
import { mapProfileToUser, type BridgedUser } from './supabase-bridge.js';

export type { BridgedUser } from './supabase-bridge.js';

/**
 * Runtime: resolve the current Supabase user (if any) into the hub user shape.
 * Returns null when unauthenticated. Reads role/legacy id from public.profiles
 * via the service-role client (RLS-independent, server-side).
 */
export async function resolveSupabaseUser(event: RequestEvent): Promise<BridgedUser | null> {
  const supabase = supabaseServer(event);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = supabaseAdmin();

  // CORE identity columns only. NEVER add additive columns here: if a
  // not-yet-migrated column is requested, PostgREST errors the whole query,
  // profile comes back null, and login silently breaks (user bounced to /join).
  // Enrichment columns are fetched best-effort below. (legacy_user_id was dropped
  // in S7 — GoTrue principal id == profile uuid, no bridge needed.)
  const { data: profile } = await admin
    .from('profiles')
    .select('id, email, display_name, role')
    .eq('id', user.id)
    .single();

  // Best-effort enrichment (avatar_url, created_at). Tolerates the columns not
  // existing yet (migration lag): on error `extra` is null and we degrade to the
  // Google metadata avatar / null — login is unaffected.
  const metadataAvatar =
    (user.user_metadata?.avatar_url as string) ??
    (user.user_metadata?.picture as string) ??
    null;
  let avatar_url: string | null = metadataAvatar;
  let created_at: string | null = null;
  const { data: extra } = await admin
    .from('profiles')
    .select('avatar_url, created_at')
    .eq('id', user.id)
    .single();
  if (extra) {
    avatar_url = (extra.avatar_url as string | null) ?? metadataAvatar;
    created_at = (extra.created_at as string | null) ?? null;
  }

  return mapProfileToUser(
    profile
      ? { ...profile, avatar_url, created_at }
      : {
          id: user.id,
          email: user.email ?? null,
          display_name: (user.user_metadata?.full_name as string) ?? null,
          avatar_url,
          role: null,
          created_at,
        },
    user.id,
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
