import { createHash, randomUUID } from 'node:crypto';
import { error } from '@sveltejs/kit';
import type postgres from 'postgres';
import { getPgClient } from '$server/db/pg-pool';
import {
  buildCapabilities,
  invalidateRbac,
  resolveMemberRoleKeys,
  type CapabilityOverrideRow,
} from '../rbac.service';
import { roleFitsActualAuthority } from '../role-simulation-policy';
import { normalizeNavConfig } from '$lib/nav/custom-sections';
import { generateOpaqueToken, isLinkUsable } from './helpers';
import type { MembershipUser } from './membership';
import { currentEffectiveAuthority } from '$server/auth/effective-authority';
import { lockAdmissionProfiles } from './profile-admission';

type Tx = postgres.TransactionSql;
export interface AdmissionTables {
  organizations: string;
  roles: string;
  members: string;
  assignments: string;
  rules: string;
  profiles: string;
  nav: string;
  links: string;
  requests: string;
  audit: string;
}
export const ADMISSION_TABLES: Readonly<AdmissionTables> = {
  organizations: 'public.organizations',
  roles: 'public.org_roles',
  members: 'public.organization_members',
  assignments: 'public.member_roles',
  rules: 'public.permission_rules',
  profiles: 'public.profiles',
  nav: 'public.app_nav_config',
  links: 'public.join_link',
  requests: 'public.join_request',
  audit: 'public.doc_audit_log',
};
interface RoleRow {
  key: string;
  rank: number;
}
interface OrganizationRow {
  role_model: string;
  default_role_key: string | null;
  status: string;
}
interface InviteRow {
  id: string;
  organization_id: string;
  role: string;
  role_revision: string | null;
  grantor_profile_id: string | null;
  revoked: boolean;
  expires_at: Date | string | null;
  max_uses: number | null;
  uses_count: number;
}
interface RequestRow {
  supabase_id: string;
  status: string;
}

/** Stable-key rename does not invalidate an invite; authority changes do. */
export function admissionRoleRevision(role: RoleRow, rules: CapabilityOverrideRow[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        key: role.key,
        rank: role.rank,
        rules: rules
          .filter((r) => r.role_key === role.key)
          .sort((a, b) => (a.module < b.module ? -1 : a.module > b.module ? 1 : 0))
          .map((r) => [
            r.module,
            r.can_view,
            r.can_create,
            r.can_edit,
            r.can_delete,
            r.can_export,
            r.can_manage,
            r.if_owner ?? false,
            r.field_level ?? 0,
          ]),
      }),
    )
    .digest('hex');
}
async function lockOrganization(tx: Tx, orgId: string, tables: AdmissionTables) {
  await tx`set local lock_timeout='5s'`;
  await tx`set local statement_timeout='10s'`;
  await tx`select pg_advisory_xact_lock(hashtextextended(${orgId},112))`;
  const [org] = await tx<OrganizationRow[]>`select role_model,default_role_key,status
    from ${tx(tables.organizations)} where id=${orgId}::uuid for share`;
  if (!org || org.status !== 'active' || org.role_model !== 'organization')
    throw error(403, 'Organization admission unavailable');
  return org;
}
async function grantSnapshot(
  tx: Tx,
  orgId: string,
  grantor: string,
  requestedRole: string | undefined,
  tables: AdmissionTables,
) {
  const org = await lockOrganization(tx, orgId, tables);
  const roleKey = requestedRole ?? org.default_role_key;
  const roles = await tx<
    RoleRow[]
  >`select key,rank from ${tx(tables.roles)} where org_id=${orgId} for share`;
  const role = roles.find((r) => r.key === roleKey && r.key.startsWith('custom-'));
  if (!role) throw error(400, 'Role must belong to the target organization');
  const [actor] = await tx<{ profile_role: string }[]>`select p.role as profile_role
    from ${tx(tables.members)} m join ${tx(tables.profiles)} p on p.id=m.profile_id
    where m.organization_id=${orgId}::uuid and m.profile_id=${grantor}::uuid for share of m,p`;
  if (!actor) throw error(403, 'Organization membership required');
  const assigned = await tx<{ role_key: string }[]>`select role_key from ${tx(tables.assignments)}
    where org_id=${orgId}::uuid and profile_id=${grantor}::uuid for share`;
  const keys = resolveMemberRoleKeys(
    assigned.map((r) => r.role_key),
    null,
    'organization',
    roles.map((r) => r.key),
  );
  const rules = await tx<
    CapabilityOverrideRow[]
  >`select role_key,module,can_view,can_create,can_edit,
    can_delete,can_export,can_manage,if_owner,field_level from ${tx(tables.rules)}
    where org_id=${orgId}::uuid order by role_key,module for share`;
  const actual = buildCapabilities(keys, rules);
  const [nav] = await tx<
    { value: unknown }[]
  >`select value from ${tx(tables.nav)} where org_id=${orgId} for share`;
  const platformAdmin = actor.profile_role === 'admin';
  const rank = Math.max(0, ...roles.filter((r) => keys.includes(r.key)).map((r) => r.rank));
  const selected = buildCapabilities([role.key], rules);
  const normalizedNav = normalizeNavConfig(nav?.value);
  if (
    !platformAdmin &&
    (!actual.can('users', 'manage') ||
      role.rank > rank ||
      !roleFitsActualAuthority({
        actual,
        selected,
        rules,
        nav: normalizedNav,
        platformAdmin: false,
      }))
  )
    throw error(403, 'Role exceeds the grantor authority');
  const simulation = currentEffectiveAuthority(orgId, grantor);
  if (
    simulation &&
    (simulation.invalid ||
      !simulation.capabilities.can('users', 'manage') ||
      role.rank > simulation.rank ||
      !roleFitsActualAuthority({
        actual: simulation.capabilities,
        selected,
        rules,
        nav: normalizedNav,
        platformAdmin: false,
      }))
  )
    throw error(403, 'Role exceeds the simulated grantor authority');
  return { role, revision: admissionRoleRevision(role, rules) };
}
async function memberExists(tx: Tx, orgId: string, profileId: string, tables: AdmissionTables) {
  const rows = await tx`select 1 from ${tx(tables.members)} where organization_id=${orgId}::uuid
    and profile_id=${profileId}::uuid for share`;
  return rows.length > 0;
}
async function admit(
  tx: Tx,
  orgId: string,
  profileId: string,
  roleKey: string,
  grantor: string,
  tables: AdmissionTables,
) {
  // Caller holds the org policy lock. An existing member is never promoted by admission.
  if (await memberExists(tx, orgId, profileId, tables)) return false;
  await tx`insert into ${tx(tables.members)} (organization_id,profile_id,role)
    values (${orgId}::uuid,${profileId}::uuid,'member')`;
  await tx`insert into ${tx(tables.assignments)} (org_id,profile_id,role_key,granted_by)
    values (${orgId}::uuid,${profileId}::uuid,${roleKey},${grantor}::uuid)`;
  await tx`insert into ${tx(tables.audit)} (id,org_id,ref_type,ref_id,actor_id,op,changes)
    values (${randomUUID()}::uuid,${orgId},'organization_membership',${profileId}::uuid,
      ${grantor}::uuid,'create',${JSON.stringify([{ field: 'role', old: null, new: roleKey }])}::text::jsonb)`;
  return true;
}

export async function mintOrganizationInvite(
  opts: {
    organizationId: string;
    role?: string;
    grantorProfileId: string;
    createdBy: string;
    expiresAt?: string | null;
    maxUses?: number | null;
  },
  tables: AdmissionTables = ADMISSION_TABLES,
): Promise<{ id: string; token: string }> {
  const token = generateOpaqueToken();
  return getPgClient().begin(async (tx) => {
    await lockAdmissionProfiles(tx, [opts.grantorProfileId], tables.profiles);
    const { role, revision } = await grantSnapshot(
      tx,
      opts.organizationId,
      opts.grantorProfileId,
      opts.role,
      tables,
    );
    if (opts.maxUses != null && (!Number.isInteger(opts.maxUses) || opts.maxUses < 1))
      throw error(400, 'maxUses must be a positive integer');
    if (
      opts.expiresAt &&
      (!Number.isFinite(Date.parse(opts.expiresAt)) || Date.parse(opts.expiresAt) <= Date.now())
    )
      throw error(400, 'expiresAt must be a future timestamp');
    const [link] = await tx<{ id: string }[]>`insert into ${tx(tables.links)}
      (token,organization_id,role,created_by,expires_at,max_uses,role_revision,grantor_profile_id)
      values (${token},${opts.organizationId},${role.key},${opts.createdBy},${opts.expiresAt ?? null},
        ${opts.maxUses ?? null},${revision},${opts.grantorProfileId}::uuid) returning id`;
    if (!link) throw error(500, 'Invite creation failed');
    return { id: link.id, token };
  });
}

export async function consumeOrganizationInvite(
  token: string,
  user: MembershipUser,
  tables: AdmissionTables = ADMISSION_TABLES,
): Promise<{ organizationId: string }> {
  if (!user.supabaseId) throw error(401, 'Authenticated profile required');
  const result = await getPgClient().begin(async (tx) => {
    // Read the immutable scope first, then acquire org lock before a link-row lock.
    const [scope] = await tx<
      { organization_id: string; grantor_profile_id: string | null }[]
    >`select organization_id,grantor_profile_id from ${tx(tables.links)} where token=${token}`;
    if (!scope) throw error(404, 'Invite not found');
    await lockAdmissionProfiles(
      tx,
      [user.supabaseId!, ...(scope.grantor_profile_id ? [scope.grantor_profile_id] : [])],
      tables.profiles,
    );
    await lockOrganization(tx, scope.organization_id, tables);
    const [link] = await tx<InviteRow[]>`select * from ${tx(tables.links)} where token=${token}
      and organization_id=${scope.organization_id} for update`;
    if (!link) throw error(404, 'Invite not found');
    if (link.grantor_profile_id !== scope.grantor_profile_id)
      throw error(409, 'Invite changed; reload before joining');
    if (await memberExists(tx, link.organization_id, user.supabaseId!, tables))
      return { organizationId: link.organization_id };
    // Drizzle's shared client returns timestamp strings; untouched raw pools return Dates.
    const expiresAt =
      link.expires_at == null
        ? null
        : link.expires_at instanceof Date
          ? link.expires_at
          : new Date(link.expires_at);
    if (expiresAt && !Number.isFinite(expiresAt.getTime()))
      throw error(400, 'Invite is no longer usable');
    if (
      !isLinkUsable({
        revoked: link.revoked,
        expiresAt,
        maxUses: link.max_uses,
        usesCount: link.uses_count,
      })
    )
      throw error(400, 'Invite is no longer usable');
    if (!link.grantor_profile_id || !link.role_revision)
      throw error(409, 'Invite must be reissued');
    const current = await grantSnapshot(
      tx,
      link.organization_id,
      link.grantor_profile_id,
      link.role,
      tables,
    );
    if (current.revision !== link.role_revision)
      throw error(409, 'Invite role changed; reissue the invite');
    await admit(
      tx,
      link.organization_id,
      user.supabaseId!,
      current.role.key,
      link.grantor_profile_id,
      tables,
    );
    await tx`update ${tx(tables.links)} set uses_count=uses_count+1 where id=${link.id}::uuid`;
    return { organizationId: link.organization_id };
  });
  await invalidateRbac(result.organizationId);
  return result;
}

export async function approveOrganizationRequest(
  id: string,
  opts: { organizationId: string; role?: string; reviewerId: string; reviewerProfileId: string },
  tables: AdmissionTables = ADMISSION_TABLES,
): Promise<void> {
  await getPgClient().begin(async (tx) => {
    const [scope] = await tx<RequestRow[]>`select supabase_id,status from ${tx(tables.requests)}
      where id=${id}::uuid and organization_id=${opts.organizationId}`;
    if (!scope) throw error(404, 'Request not found');
    await lockAdmissionProfiles(tx, [scope.supabase_id, opts.reviewerProfileId], tables.profiles);
    await lockOrganization(tx, opts.organizationId, tables);
    const [request] = await tx<RequestRow[]>`select supabase_id,status from ${tx(tables.requests)}
      where id=${id}::uuid and organization_id=${opts.organizationId} for update`;
    if (!request) throw error(404, 'Request not found');
    if (request.supabase_id !== scope.supabase_id)
      throw error(409, 'Request changed; reload before approving');
    if (request.status !== 'pending') return;
    const { role } = await grantSnapshot(
      tx,
      opts.organizationId,
      opts.reviewerProfileId,
      opts.role,
      tables,
    );
    await admit(
      tx,
      opts.organizationId,
      request.supabase_id,
      role.key,
      opts.reviewerProfileId,
      tables,
    );
    await tx`update ${tx(tables.requests)} set status='approved',reviewed_by=${opts.reviewerId},reviewed_at=now()
      where id=${id}::uuid and organization_id=${opts.organizationId}`;
  });
  await invalidateRbac(opts.organizationId);
}
