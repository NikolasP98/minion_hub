// Runtime helper — imports $server/supabase (which needs $env shims).
// Kept separate from supabase-bridge.ts so the pure mapper stays unit-testable.
import type { RequestEvent } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer } from '$server/supabase';
import { mapProfileToUser, type BridgedUser, type ProfileRow } from './supabase-bridge.js';
import type { OrgKind } from '$lib/org-kind';
import {
  loadCanonicalMemberships,
  loadCanonicalProfile,
} from '$server/services/canonical-directory.service';

/** DB `organizations.kind` is free-text; only the two known values normalize
 *  — anything else (or null/unset) is "unresolvable", not a silent default
 *  (routing-simplification spec S2: the caller fails closed on this). */
function normalizeOrgKind(value: string | null | undefined): OrgKind | null {
  return value === 'personal' || value === 'business' ? value : null;
}

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

  // The profile and membership gates use the canonical database connection,
  // not PostgREST. Auth's access-token verification remains Supabase-native;
  // only the server-side directory lookup avoids turning a Data API outage into
  // a claims-only user with no role or tenant.
  const profile = (await loadCanonicalProfile(userId)) as ProfileRow | null;

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
          username: null,
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
 * Returns null only when the user has no membership. Database failures throw so
 * callers cannot misclassify an infrastructure outage as an authorization fact.
 */
export async function resolveSupabaseTenant(
  supabaseId: string,
  preferredOrgId?: string | null,
): Promise<{ orgId: string; kind: OrgKind | null } | null> {
  const orgs = await loadCanonicalMemberships(supabaseId);
  if (orgs.length === 0) return null;
  if (preferredOrgId) {
    const preferred = orgs.find((o) => o.id === preferredOrgId);
    if (preferred) return { orgId: preferred.id, kind: normalizeOrgKind(preferred.kind) };
  }
  return { orgId: orgs[0].id, kind: normalizeOrgKind(orgs[0].kind) };
}
