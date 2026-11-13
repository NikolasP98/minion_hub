import { hasCanonicalMembership } from '$server/services/canonical-directory.service';
import { invalidateRbac } from '$server/services/rbac.service';
import { loadOrganizationRolePolicy } from '../organization-role-policy';
import { admitLegacyMembership } from './profile-admission';

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
 * Legacy admission retains the legacy membership-column mapping and exact
 * selected role. Its writes share one native transaction and profile
 * lifecycle lock; new-model callers must use their transactional admission path.
 */
export async function createMembership(
  u: MembershipUser,
  orgId: string,
  roleKey: string,
  grantorProfileId?: string,
): Promise<void> {
  if (!u.supabaseId) {
    throw new Error('createMembership: supabaseId is required (Supabase is the sole auth store)');
  }
  if (!grantorProfileId) throw new Error('Authenticated grantor profile required');
  const profileId = u.supabaseId;
  const policy = await loadOrganizationRolePolicy(orgId);
  if (policy.roleModel === 'organization') {
    throw new Error('Organization-model membership requires transactional admission');
  }
  await admitLegacyMembership(orgId, profileId, roleKey, grantorProfileId);
  await invalidateRbac(orgId);
}
