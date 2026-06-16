import { supabaseAdmin } from '$server/supabase';

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
  const { data, error } = await supabaseAdmin()
    .from('organization_members')
    .select('profile_id')
    .eq('profile_id', supabaseId)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error) return false;
  return !!data;
}

/** True if the Supabase profile belongs to any organization at all. */
export async function hasAnyMembership(supabaseId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from('organization_members')
    .select('profile_id')
    .eq('profile_id', supabaseId)
    .limit(1);
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

/**
 * Grant `u` membership of `orgId` by upserting a Supabase `organization_members`
 * row (idempotent on (organization_id, profile_id)). Requires `u.supabaseId`.
 * Membership lives entirely in Supabase — no Turso handle needed.
 */
export async function createMembership(
  u: MembershipUser,
  orgId: string,
  role: string,
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
        role: role === 'admin' ? 'admin' : 'member',
      },
      { onConflict: 'organization_id,profile_id' },
    );
  if (error) {
    throw new Error(`createMembership: supabase org_members upsert failed: ${error.message}`);
  }
}
