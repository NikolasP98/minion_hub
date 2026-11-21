import { getCoreDb, getOrgTransactionDb } from '$server/db/pg-client';
import { cancelPulseForOwnerTx } from './pulse-dispatch.store';
import { sql as pulseSql } from 'drizzle-orm';
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

/**
 * Display name per profile id in ONE query — for the lists that show WHO did
 * something (open shifts, shift history) instead of a bare uuid. Falls back to
 * the email; an id with no profile is simply absent from the map.
 */
export async function getUserNames(ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();
  const { data, error } = await supabaseAdmin()
    .from('profiles')
    .select('id, email, display_name')
    .in('id', unique);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<Pick<ProfileRow, 'id' | 'email' | 'display_name'>>;
  const names = new Map<string, string>();
  for (const row of rows) {
    const label = row.display_name || row.email;
    if (label) names.set(row.id, label);
  }
  return names;
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
async function protectNewModelMembershipRemoval(
  tx: Parameters<typeof cancelPulseForOwnerTx>[0],
  userId: string,
  orgIds: readonly string[],
  actorProfileId?: string | null,
) {
  const { lockNavigationPolicy } = await import('./nav-policy-lock');
  const legacyIds: string[] = [];
  const { assertOrganizationAccessRecoverableDrizzle } = await import('./section-access.service');
  for (const orgId of [...orgIds].sort()) {
    await lockNavigationPolicy(tx, orgId);
    const [org] = await tx.execute<{ model: string } & Record<string, unknown>>(pulseSql`
      select to_jsonb(o)->>'role_model' as model from organizations o where id=${orgId}::uuid for share`);
    if (org?.model !== 'organization') {
      legacyIds.push(orgId);
      continue;
    }
    const oldRoles = await tx.execute<{ role_key: string } & Record<string, unknown>>(
      pulseSql`select role_key from member_roles where org_id=${orgId}::uuid and profile_id=${userId}::uuid`,
    );
    await tx.execute(
      pulseSql`delete from member_roles where org_id=${orgId}::uuid and profile_id=${userId}::uuid`,
    );
    await tx.execute(
      pulseSql`delete from organization_members where organization_id=${orgId}::uuid and profile_id=${userId}::uuid`,
    );
    await assertOrganizationAccessRecoverableDrizzle(tx, orgId);
    await tx.execute(pulseSql`insert into doc_audit_log(org_id,ref_type,ref_id,actor_id,op,changes)
      values(${orgId},'member',${userId}::uuid,${actorProfileId ?? null}::uuid,'membership_remove',
      ${JSON.stringify([{ field: 'roles', old: oldRoles.map((r) => r.role_key), new: [] }])}::jsonb)`);
  }
  return legacyIds;
}

export async function deleteUser(
  _ctx: TenantContext,
  userId: string,
  actorProfileId?: string | null,
) {
  const admin = supabaseAdmin();
  // Defensive: callers pass the profile uuid. Bail on a non-uuid (e.g. a stray
  // legacy Turso id) rather than feeding garbage to the auth admin API.
  if (!UUID_RE.test(userId)) {
    console.error('[user.service] deleteUser called with non-uuid id, skipping:', userId);
    return;
  }
  await getOrgTransactionDb(getCoreDb()).transaction(async (tx) => {
    await tx.execute(pulseSql`select pg_advisory_xact_lock(hashtextextended(${userId},114))`);
    const memberships = await tx.execute<{ organization_id: string }>(
      pulseSql`select organization_id::text from organization_members where profile_id=${userId}::uuid order by organization_id`,
    );
    const { lockNavigationPolicy } = await import('./nav-policy-lock');
    // Obtain every org policy lock before taking the profile's write lock.
    // Policy readers hold org112 before FOR SHARE on member profiles.
    for (const row of memberships) await lockNavigationPolicy(tx, row.organization_id);
    await tx.execute(pulseSql`update profiles set deletion_pending=true where id=${userId}::uuid`);
    await protectNewModelMembershipRemoval(
      tx,
      userId,
      memberships.map((r) => r.organization_id),
      actorProfileId,
    );
    for (const row of memberships)
      await cancelPulseForOwnerTx(tx, { tenantId: row.organization_id, profileId: userId });
  });
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
  actorProfileId?: string | null,
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
    let legacyRemovalIds: string[] = [];
    await getOrgTransactionDb(getCoreDb()).transaction(async (tx) => {
      await tx.execute(pulseSql`select pg_advisory_xact_lock(hashtextextended(${userId},114))`);
      legacyRemovalIds = await protectNewModelMembershipRemoval(
        tx,
        userId,
        toRemove,
        actorProfileId,
      );
      for (const tenantId of [...toRemove].sort())
        await cancelPulseForOwnerTx(tx, { tenantId, profileId: userId });
    });
    if (legacyRemovalIds.length) {
      const { error: delErr } = await admin
        .from('organization_members')
        .delete()
        .eq('profile_id', userId)
        .in('organization_id', legacyRemovalIds);
      if (delErr) throw delErr;
    }
  }
  if (toAdd.length > 0) {
    await getOrgTransactionDb(getCoreDb()).transaction(async (tx) => {
      for (const profileId of [
        ...new Set([userId, ...(actorProfileId ? [actorProfileId] : [])]),
      ].sort())
        await tx.execute(
          pulseSql`select pg_advisory_xact_lock(hashtextextended(${profileId},114))`,
        );
      const [target] = await tx.execute<{ pending: boolean } & Record<string, unknown>>(
        pulseSql`select coalesce((to_jsonb(p)->>'deletion_pending')::boolean,false) as pending from profiles p where id=${userId}::uuid for share`,
      );
      if (!target || target.pending) throw new Error('Account is being deleted');
      const { lockNavigationPolicy } = await import('./nav-policy-lock');
      for (const orgId of [...toAdd].sort()) {
        await lockNavigationPolicy(tx, orgId);
        const [org] = await tx.execute<
          { model: string; default_role_key: string; status: string } & Record<string, unknown>
        >(pulseSql`
          select to_jsonb(o)->>'role_model' as model,to_jsonb(o)->>'default_role_key' as default_role_key,status
          from organizations o where id=${orgId}::uuid for share`);
        if (org?.model !== 'organization') {
          await tx.execute(pulseSql`insert into organization_members(organization_id,profile_id,role)
            values(${orgId}::uuid,${userId}::uuid,'member') on conflict(organization_id,profile_id) do update set role='member'`);
          continue;
        }
        if (!actorProfileId)
          throw new Error('Platform actor identity required for local organization admission');
        const [actor] = await tx.execute<{ role: string } & Record<string, unknown>>(
          pulseSql`select role from profiles p where id=${actorProfileId}::uuid and not coalesce((to_jsonb(p)->>'deletion_pending')::boolean,false) for share`,
        );
        if (actor?.role !== 'admin') throw new Error('Platform administrator required');
        if (org.status !== 'active') throw new Error('Active organization required');
        const [role] = await tx.execute<{ key: string } & Record<string, unknown>>(
          pulseSql`select key from org_roles where org_id=${orgId} and key=${org.default_role_key} for share`,
        );
        if (!role) throw new Error('Organization default role unavailable');
        const admitted = await tx.execute<
          { profile_id: string } & Record<string, unknown>
        >(pulseSql`
          insert into organization_members(organization_id,profile_id,role) values(${orgId}::uuid,${userId}::uuid,'member')
          on conflict(organization_id,profile_id) do nothing returning profile_id`);
        if (admitted.length) {
          await tx.execute(pulseSql`insert into member_roles(org_id,profile_id,role_key,granted_by)
          values(${orgId}::uuid,${userId}::uuid,${role.key},${actorProfileId}::uuid) on conflict do nothing`);
          await tx.execute(pulseSql`insert into doc_audit_log(org_id,ref_type,ref_id,actor_id,op,changes)
            values(${orgId},'member',${userId}::uuid,${actorProfileId}::uuid,'membership_add',
            ${JSON.stringify([{ field: 'roles', old: [], new: [role.key] }])}::jsonb)`);
        }
      }
    });
  }
}
