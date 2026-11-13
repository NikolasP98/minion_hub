import { error } from '@sveltejs/kit';
import type postgres from 'postgres';
import type { AdmissionTables } from './organization-admission';

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

/** Legacy direct admission requires the same verified grantor as invitation admission. */
export async function admitLegacyMembership(
  orgId: string,
  profileId: string,
  roleKey: string,
  grantorProfileId: string,
  tables?: AdmissionTables,
): Promise<void> {
  if (!grantorProfileId) throw error(403, 'Authenticated grantor profile required');
  const { admitVerifiedLegacyMember } = await import('./organization-admission');
  return admitVerifiedLegacyMember(orgId, profileId, roleKey, grantorProfileId, tables);
}
