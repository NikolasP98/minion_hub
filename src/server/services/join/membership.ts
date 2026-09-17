import { supabaseAdmin } from '$server/supabase';
import { hasCanonicalMembership } from '$server/services/canonical-directory.service';
import { addMemberRole } from '$server/services/rbac.service';

export interface MembershipUser {
  id: string;
  email: string;
  displayName: string | null;
  /**
   * The user's Supabase profile uuid — REQUIRED. Membership is granted by the
   * Supabase `organization_members` row (the tenancy source-of-truth read by
   * `resolveSupabaseTenant`). The legacy Turso `user`/`member` dual-write was
   * removed (Supabase is the single auth store).
   */
  supabaseId?: string | null;
}

/**
 * True if the Supabase profile is already a member of `orgId`. Used by the
 * `/join` load to bounce already-approved users off the invite/request screens
 * (a refreshed join-link must not strand a now-member on the join page).
 */
export async function isOrgMember(supabaseId: string, orgId: string): Promise<boolean> {
  return hasCanonicalMembership(supabaseId, orgId);
}

/** True if the Supabase profile belongs to any organization at all. */
export async function hasAnyMembership(supabaseId: string): Promise<boolean> {
  return hasCanonicalMembership(supabaseId);
}

/**
 * Grant `u` membership of `orgId` by upserting a Supabase `organization_members`
 * row (idempotent on (organization_id, profile_id)) AND a `member_roles` row for
 * `roleKey` — the RBAC engine's actual source of truth (see rbac.service.ts).
 * Requires `u.supabaseId`. Without the `member_roles` row, every grant fell
 * through `legacyRoleKey('member') → 'manager'`, handing every join-link or
 * approved invite manager-level access (read/write/export on every business
 * module) regardless of the role the link/approval actually named.
 *
 * `roleKey` must already be validated by the caller (join-link
 * consume/approve endpoints reject anything outside JOINABLE_ROLE_KEY, so
 * `owner` never reaches here). `system=true` on the `addMemberRole` call:
 * both callers already gate the mint/approve step on
 * `requireOrgCapability(locals, 'users', 'manage')`, so there's no caller
 * identity here whose own role rank needs checking.
 */
export async function createMembership(
  u: MembershipUser,
  orgId: string,
  roleKey: string,
): Promise<void> {
  if (!u.supabaseId) {
    throw new Error('createMembership: supabaseId is required (Supabase is the sole auth store)');
  }
  const { error } = await supabaseAdmin()
    .from('organization_members')
    .upsert(
      {
        organization_id: orgId,
        profile_id: u.supabaseId,
        role: roleKey === 'admin' ? 'admin' : 'member',
      },
      { onConflict: 'organization_id,profile_id' },
    );
  if (error) {
    throw new Error(`createMembership: supabase org_members upsert failed: ${error.message}`);
  }
  await addMemberRole(orgId, u.supabaseId, roleKey, null, true);
}
