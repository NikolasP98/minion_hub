import type { TenantContext } from './base';
import { supabaseAdmin } from '$server/supabase';

/**
 * User-admin surface — Supabase system-of-record.
 *
 * Identity is keyed by the Supabase profile uuid (= auth.users.id). This is the
 * post-cutover replacement for the legacy Turso `user`/`member` tables, whose
 * ids diverged from the auth identity and caused a delete-doesn't-revoke leak:
 * the admin list was Turso-keyed, so a delete removed the Turso row but never
 * the Supabase auth user that actually gates login. Reading + mutating profiles
 * directly makes the id unambiguous, so deletes revoke and the list shows the
 * real users (including Supabase-only / OAuth signups that never got a Turso row).
 *
 * `ctx.tenantId` is the active org; the team list is scoped to that org's members.
 */

interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string | null;
  alias: string | null;
  role_id: string | null;
  account_type: string | null;
  created_at: string | null;
}

export interface UserEntry {
  id: string;
  email: string | null;
  displayName: string | null;
  role: string | null;
  alias: string | null;
  roleId: string | null;
  /** 'person' (default) or 'service' — a shared/business account, not a human. */
  accountType: string;
  createdAt: string | null;
  organizations: Array<{ id: string; name: string; role: string }>;
}

/**
 * Members of the active org, each with the full set of orgs they belong to (the
 * org-assignment editor reads the per-user list). Scoped to `ctx.tenantId` — an
 * admin's team page shows their org's people, not every user in the system.
 */
// Only reads ctx.tenantId (data comes from Supabase admin), so accept any
// context carrying a tenantId — lets the Core (pg) ctx call it too.
export async function listUsers(ctx: { tenantId: string }): Promise<UserEntry[]> {
  const admin = supabaseAdmin();

  // 1. Profile ids that belong to the active org.
  const { data: orgMembers, error: omErr } = await admin
    .from('organization_members')
    .select('profile_id')
    .eq('organization_id', ctx.tenantId);
  if (omErr) throw omErr;
  const ids = [...new Set((orgMembers ?? []).map((m) => (m as { profile_id: string }).profile_id))];
  if (ids.length === 0) return [];

  // 2 & 3 both depend only on `ids` and are independent — run them in parallel.
  // 2. The profiles themselves.
  // 3. Every org each of those users belongs to (for the assignment editor).
  const [{ data: profiles, error: pErr }, { data: allMemberships, error: amErr }] =
    await Promise.all([
      admin
        .from('profiles')
        .select('id, email, display_name, role, alias, role_id, account_type, created_at')
        .in('id', ids),
      admin
        .from('organization_members')
        .select('profile_id, role, organizations(id, name)')
        .in('profile_id', ids),
    ]);
  if (pErr) throw pErr;
  if (amErr) throw amErr;

  type Org = { id: string; name: string };
  type Mem = { profile_id: string; role: string; organizations: Org | Org[] | null };
  const orgsByUser = new Map<string, Array<{ id: string; name: string; role: string }>>();
  for (const m of (allMemberships ?? []) as unknown as Mem[]) {
    const org = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations;
    if (!org) continue;
    const list = orgsByUser.get(m.profile_id) ?? [];
    list.push({ id: org.id, name: org.name, role: m.role });
    orgsByUser.set(m.profile_id, list);
  }

  return ((profiles ?? []) as unknown as ProfileRow[])
    .map((p) => ({
      id: p.id,
      email: p.email,
      displayName: p.display_name,
      role: p.role,
      alias: p.alias,
      roleId: p.role_id,
      accountType: p.account_type ?? 'person',
      createdAt: p.created_at,
      organizations: orgsByUser.get(p.id) ?? [],
    }))
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
}

export async function getUser(_ctx: TenantContext, userId: string) {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from('profiles')
    .select('id, email, display_name, role, alias, role_id')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const p = data as unknown as ProfileRow;
  return {
    id: p.id,
    email: p.email,
    displayName: p.display_name,
    role: p.role,
    alias: p.alias,
    roleId: p.role_id,
  };
}

/**
 * Admin-create a user: provision the Supabase auth identity (email pre-confirmed)
 * and add them to the active org so they can use the hub immediately. Role is
 * written to the profile (auto-created by the auth trigger; upsert as a fallback).
 */
export async function createUser(
  ctx: TenantContext,
  data: { email: string; displayName?: string; password: string; role?: 'user' | 'admin' },
) {
  const admin = supabaseAdmin();
  const displayName = data.displayName ?? data.email.split('@')[0];

  const { data: created, error } = await admin.auth.admin.createUser({
    email: data.email,
    password: data.password,
    email_confirm: true,
    user_metadata: { full_name: displayName },
  });
  if (error || !created.user) throw error ?? new Error('Failed to create user');
  const userId = created.user.id;

  // Ensure a profile row with the right role/name (the handle_new_user trigger
  // may create a bare row; upsert reconciles it either way).
  await admin
    .from('profiles')
    .upsert(
      { id: userId, email: data.email, display_name: displayName, role: data.role ?? 'user' },
      { onConflict: 'id' },
    );

  // Membership in the active org — without it the new user resolves no tenancy
  // and gets bounced to /join.
  await admin
    .from('organization_members')
    .upsert(
      { profile_id: userId, organization_id: ctx.tenantId, role: 'member' },
      { onConflict: 'profile_id,organization_id' },
    );

  return userId;
}

export async function updateUserRole(_ctx: TenantContext, userId: string, role: 'user' | 'admin') {
  const admin = supabaseAdmin();
  const { error } = await admin.from('profiles').update({ role }).eq('id', userId);
  if (error) throw error;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Delete a user account entirely: revoke every org membership, then delete the
 * Supabase auth identity (profiles cascades). The auth delete is the actual
 * revocation — login is gated on auth.users, so removing only memberships would
 * leave the account able to sign back in.
 *
 * NOTE: this removes the account globally, including from other orgs. (A future
 * "remove from this org only" action would just delete the org_members row.)
 */
export async function deleteUser(_ctx: TenantContext, userId: string) {
  const admin = supabaseAdmin();
  // Defensive: callers pass the profile uuid. Bail on a non-uuid (e.g. a stray
  // legacy Turso id) rather than feeding garbage to the auth admin API.
  if (!UUID_RE.test(userId)) {
    console.error('[user.service] deleteUser called with non-uuid id, skipping:', userId);
    return;
  }
  await admin.from('organization_members').delete().eq('profile_id', userId);
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error('[user.service] auth.admin.deleteUser failed for', userId, error);
    throw error;
  }
}

export type UserProfileUpdate = {
  displayName?: string;
  email?: string;
  alias?: string | null;
  roleId?: string | null;
};

export async function updateUserProfile(
  _ctx: TenantContext,
  userId: string,
  patch: UserProfileUpdate,
) {
  const admin = supabaseAdmin();
  const updates: Record<string, unknown> = {};
  if (patch.displayName !== undefined) updates.display_name = patch.displayName;
  if (patch.email !== undefined) updates.email = patch.email;
  if (patch.alias !== undefined) updates.alias = patch.alias;
  if (patch.roleId !== undefined) updates.role_id = patch.roleId;
  if (Object.keys(updates).length > 0) {
    const { error } = await admin.from('profiles').update(updates).eq('id', userId);
    if (error) throw error;
  }
  // Keep the login email in sync with the profile email (best-effort — the
  // profile update above is the source of truth the UI reads).
  if (patch.email !== undefined) {
    const { error: authErr } = await admin.auth.admin.updateUserById(userId, {
      email: patch.email,
    });
    if (authErr) console.warn('[user.service] auth email sync failed for', userId, authErr);
  }
}

export async function isAliasTaken(
  _ctx: TenantContext,
  alias: string,
  excludeUserId?: string,
): Promise<boolean> {
  const admin = supabaseAdmin();
  let query = admin.from('profiles').select('id').eq('alias', alias);
  if (excludeUserId) query = query.neq('id', excludeUserId);
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function listAliases(_ctx: TenantContext): Promise<Record<string, string>> {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from('profiles').select('id, alias').not('alias', 'is', null);
  if (error) throw error;
  return Object.fromEntries(
    ((data ?? []) as Array<{ id: string; alias: string | null }>)
      .filter((r) => r.alias)
      .map((r) => [r.id, r.alias as string]),
  );
}

export async function listOrganizations(_ctx: TenantContext) {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from('organizations').select('id, name').order('name');
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string; name: string }>).map((o) => ({
    id: o.id,
    name: o.name,
  }));
}

/**
 * Reconcile a user's org memberships to exactly `orgIds` (add missing, remove
 * extra). Org-shared admin action: the caller (requireAdmin) decides the set.
 */
export async function updateUserOrganizations(
  _ctx: TenantContext,
  userId: string,
  orgIds: string[],
) {
  const admin = supabaseAdmin();
  const { data: current, error } = await admin
    .from('organization_members')
    .select('organization_id')
    .eq('profile_id', userId);
  if (error) throw error;

  const currentIds = new Set(
    ((current ?? []) as Array<{ organization_id: string }>).map((c) => c.organization_id),
  );
  const desiredIds = new Set(orgIds);

  const toRemove = [...currentIds].filter((id) => !desiredIds.has(id));
  const toAdd = [...desiredIds].filter((id) => !currentIds.has(id));

  if (toRemove.length > 0) {
    const { error: delErr } = await admin
      .from('organization_members')
      .delete()
      .eq('profile_id', userId)
      .in('organization_id', toRemove);
    if (delErr) throw delErr;
  }
  if (toAdd.length > 0) {
    const { error: insErr } = await admin.from('organization_members').upsert(
      toAdd.map((organization_id) => ({ profile_id: userId, organization_id, role: 'member' })),
      { onConflict: 'profile_id,organization_id' },
    );
    if (insErr) throw insErr;
  }
}
