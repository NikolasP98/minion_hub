import { error } from '@sveltejs/kit';
import type postgres from 'postgres';
import { getPgClient } from '$server/db/pg-pool';

/** Profile lifecycle locks always precede organization policy locks. */
export async function lockAdmissionProfiles(
  tx: postgres.TransactionSql,
  profileIds: readonly string[],
  profilesTable = 'public.profiles',
): Promise<void> {
  const ids = [...new Set(profileIds)].sort();
  for (const id of ids) await tx`select pg_advisory_xact_lock(hashtextextended(${id},114))`;
  for (const id of ids) {
    const [profile] = await tx<{ pending: boolean }[]>`
      select coalesce((to_jsonb(p)->>'deletion_pending')::boolean,false) as pending
      from ${tx(profilesTable)} p where id=${id}::uuid for share`;
    if (!profile || profile.pending)
      throw error(403, 'Profile is unavailable for membership admission');
  }
}

/** Legacy column mapping and additive role grant, atomically fenced without pool re-entry. */
export async function admitLegacyMembership(
  orgId: string,
  profileId: string,
  roleKey: string,
  tables = {
    profiles: 'public.profiles',
    organizations: 'public.organizations',
    members: 'public.organization_members',
    assignments: 'public.member_roles',
  },
): Promise<void> {
  await getPgClient().begin(async (tx) => {
    await lockAdmissionProfiles(tx, [profileId], tables.profiles);
    const [org] = await tx<{ model: string }[]>`
      select coalesce(to_jsonb(o)->>'role_model','legacy') as model
      from ${tx(tables.organizations)} o where id=${orgId}::uuid for share`;
    if (!org || org.model !== 'legacy') throw error(409, 'Organization admission model changed');
    await tx`insert into ${tx(tables.members)}(organization_id,profile_id,role)
      values(${orgId}::uuid,${profileId}::uuid,${roleKey === 'admin' ? 'admin' : 'member'})
      on conflict(organization_id,profile_id) do update set role=excluded.role`;
    await tx`insert into ${tx(tables.assignments)}(org_id,profile_id,role_key,granted_by)
      values(${orgId}::uuid,${profileId}::uuid,${roleKey},null)
      on conflict(org_id,profile_id,role_key) do nothing`;
  });
}
