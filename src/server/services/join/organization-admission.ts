import { createHash, randomUUID } from 'node:crypto';
import { error } from '@sveltejs/kit';
import type postgres from 'postgres';
import { getPgClient } from '$server/db/pg-pool';
import {
  buildCapabilities,
  MODULES,
  ACTIONS,
  JOINABLE_ROLE_KEY,
  invalidateRbac,
  resolveMemberRoleKeys,
  type CapabilityOverrideRow,
} from '../rbac.service';
import { roleFitsActualAuthority } from '../role-simulation-policy';
import { normalizeNavConfig } from '$lib/nav/custom-sections';
import { ALL_SUBRESOURCES } from '$lib/permissions';
import { generateOpaqueToken, isLinkUsable } from './helpers';
import type { MembershipUser } from './membership';
import {
  currentEffectiveAuthority,
  narrowAdmittedCapabilities,
} from '$server/auth/effective-authority';
import { parseOrganizationRolePolicy } from '../organization-role-policy';
import {
  readRoleBrainGrants,
  assertRoleBrainGrantCeiling,
  assertRecipientBrainGrantCeiling,
} from '../brain-role-grants';
import { lockAdmissionProfiles } from './profile-admission';

type Tx = postgres.TransactionSql;
export interface AdmissionTables {
  organizations: string;
  roles: string;
  systemRoles: string;
  members: string;
  assignments: string;
  rules: string;
  profiles: string;
  nav: string;
  links: string;
  requests: string;
  audit: string;
  brains: string;
  brainAccess: string;
  personalAgents: string;
}
export const ADMISSION_TABLES: Readonly<AdmissionTables> = {
  organizations: 'public.organizations',
  roles: 'public.org_roles',
  systemRoles: 'public.permission_roles',
  members: 'public.organization_members',
  assignments: 'public.member_roles',
  rules: 'public.permission_rules',
  profiles: 'public.profiles',
  nav: 'public.app_nav_config',
  links: 'public.join_link',
  requests: 'public.join_request',
  audit: 'public.doc_audit_log',
  brains: 'public.brains',
  brainAccess: 'public.brain_access',
  personalAgents: 'public.personal_agents',
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
export function admissionRoleRevision(
  role: RoleRow,
  rules: CapabilityOverrideRow[],
  nav: unknown = null,
  objectRevision: string | null = null,
): string {
  const capabilities = buildCapabilities([role.key], rules);
  const targets = [
    ...new Set([
      ...MODULES,
      ...ALL_SUBRESOURCES.map((r) => r.key),
      ...rules.filter((r) => r.role_key === role.key).map((r) => r.module),
    ]),
  ].sort();
  return createHash('sha256')
    .update(
      JSON.stringify({
        key: role.key,
        rank: role.rank,
        capabilities: targets.map((target) => [
          target,
          ...ACTIONS.map((action) => capabilities.can(target, action)),
          capabilities.ownerScoped(target),
          capabilities.fieldLevel(target),
        ]),
        nav,
        objectRevision,
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
  const [org] = await tx<OrganizationRow[]>`select to_jsonb(o)->>'role_model' as role_model,
    to_jsonb(o)->>'default_role_key' as default_role_key,status
    from ${tx(tables.organizations)} o where id=${orgId}::uuid for share`;
  if (!org || org.status !== 'active') throw error(403, 'Organization admission unavailable');
  return parseOrganizationRolePolicy(org);
}
async function grantSnapshot(
  tx: Tx,
  orgId: string,
  grantor: string,
  requestedRole: string | undefined,
  tables: AdmissionTables,
) {
  const policy = await lockOrganization(tx, orgId, tables);
  const roleKey =
    requestedRole ?? (policy.roleModel === 'legacy' ? 'staff' : policy.defaultRoleKey);
  const localRoles = await tx<
    RoleRow[]
  >`select key,rank from ${tx(tables.roles)} where org_id=${orgId} for share`;
  const roles =
    policy.roleModel === 'legacy'
      ? [
          ...(await tx<RoleRow[]>`select key,rank from ${tx(tables.systemRoles)} for share`),
          ...localRoles,
        ]
      : localRoles;
  if (policy.roleModel === 'legacy' && !JOINABLE_ROLE_KEY.safeParse(roleKey).success)
    throw error(400, 'role must be one of: admin, manager, staff, viewer');
  const role = roles.find(
    (r) => r.key === roleKey && (policy.roleModel === 'legacy' || r.key.startsWith('custom-')),
  );
  if (!role) throw error(400, 'Role must belong to the target organization');
  const [actor] = await tx<
    { profile_role: string; membership_role: string }[]
  >`select p.role as profile_role,m.role as membership_role
    from ${tx(tables.members)} m join ${tx(tables.profiles)} p on p.id=m.profile_id
    where m.organization_id=${orgId}::uuid and m.profile_id=${grantor}::uuid for share of m,p`;
  if (!actor) throw error(403, 'Organization membership required');
  const assigned = await tx<{ role_key: string }[]>`select role_key from ${tx(tables.assignments)}
    where org_id=${orgId}::uuid and profile_id=${grantor}::uuid for share`;
  const keys = resolveMemberRoleKeys(
    assigned.map((r) => r.role_key),
    actor.membership_role,
    policy.roleModel,
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
  let effectiveActor:
    { profileId: string; roles: string[]; caps: ReturnType<typeof buildCapabilities> } | undefined;
  if (simulation) {
    const simulationRole = roles.find((r) => r.key === simulation.roleKey);
    const effective = narrowAdmittedCapabilities(
      buildCapabilities([simulation.roleKey], rules),
      simulation.capabilities,
    );
    effectiveActor = { profileId: grantor, roles: [simulation.roleKey], caps: effective };
    if (
      simulation.invalid ||
      !simulationRole ||
      !effective.can('users', 'manage') ||
      role.rank > Math.min(simulation.rank, simulationRole.rank) ||
      !roleFitsActualAuthority({
        actual: effective,
        selected,
        rules,
        nav: normalizedNav,
        platformAdmin: false,
      })
    )
      throw error(403, 'Role exceeds the simulated grantor authority');
  }
  const snapshot = await readRoleBrainGrants(tx, orgId, {
    brains: tables.brains,
    access: tables.brainAccess,
    personalAgents: tables.personalAgents,
  });
  const { revision: objectRevision } = assertRoleBrainGrantCeiling({
    roleModel: policy.roleModel,
    snapshot,
    actual: { profileId: grantor, roles: keys, caps: actual },
    effective: effectiveActor,
    selected: { roles: [role.key], caps: selected },
  });
  return {
    role,
    policy,
    revision: admissionRoleRevision(role, rules, normalizedNav, objectRevision),
    brainAuthority: {
      snapshot,
      actual: { profileId: grantor, roles: keys, caps: actual },
      effective: effectiveActor,
      selected: { roles: [role.key], caps: selected },
    },
  };
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
  roleModel: 'legacy' | 'organization',
  brainAuthority: Awaited<ReturnType<typeof grantSnapshot>>['brainAuthority'],
) {
  // Caller holds the org policy lock. An existing member is never promoted by admission.
  if (await memberExists(tx, orgId, profileId, tables)) return false;
  assertRecipientBrainGrantCeiling({
    roleModel,
    snapshot: brainAuthority.snapshot,
    actual: brainAuthority.actual,
    effective: brainAuthority.effective,
    before: { profileId, active: false, roles: [], caps: buildCapabilities([], []) },
    after: { profileId, active: true, ...brainAuthority.selected },
  });
  // Inactive assignments are not authority: admission installs exactly the verified role.
  const staleRoles = await tx<{ role_key: string }[]>`delete from ${tx(tables.assignments)}
    where org_id=${orgId}::uuid and profile_id=${profileId}::uuid returning role_key`;
  await tx`insert into ${tx(tables.members)} (organization_id,profile_id,role)
    values (${orgId}::uuid,${profileId}::uuid,${roleModel === 'legacy' && roleKey === 'admin' ? 'admin' : 'member'})`;
  await tx`insert into ${tx(tables.assignments)} (org_id,profile_id,role_key,granted_by)
    values (${orgId}::uuid,${profileId}::uuid,${roleKey},${grantor}::uuid)`;
  await tx`insert into ${tx(tables.audit)} (id,org_id,ref_type,ref_id,actor_id,op,changes)
    values (${randomUUID()}::uuid,${orgId},'organization_membership',${profileId}::uuid,
      ${grantor}::uuid,'create',${JSON.stringify([
        { field: 'role', old: null, new: roleKey },
        ...(staleRoles.length
          ? [
              {
                field: 'inactive_role_assignments',
                old: staleRoles.map((r) => r.role_key).sort(),
                new: [],
              },
            ]
          : []),
      ])}::text::jsonb)`;
  return true;
}

/** The legacy direct adapter shares the same grant check and lifecycle lock as links. */
export async function admitVerifiedLegacyMember(
  orgId: string,
  profileId: string,
  roleKey: string,
  grantorProfileId: string,
  tables: AdmissionTables = ADMISSION_TABLES,
): Promise<void> {
  await getPgClient().begin(async (tx) => {
    await lockAdmissionProfiles(tx, [profileId, grantorProfileId], tables.profiles);
    const { role, policy, brainAuthority } = await grantSnapshot(
      tx,
      orgId,
      grantorProfileId,
      roleKey,
      tables,
    );
    if (policy.roleModel !== 'legacy') throw error(409, 'Organization admission model changed');
    await admit(tx, orgId, profileId, role.key, grantorProfileId, tables, 'legacy', brainAuthority);
  });
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
    const { role, revision, policy } = await grantSnapshot(
      tx,
      opts.organizationId,
      opts.grantorProfileId,
      opts.role,
      tables,
    );
    if (policy.roleModel === 'legacy' && !opts.role) throw error(400, 'role required');
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
      throw error(
        409,
        'This invitation predates grant verification. Ask an administrator to create a new link.',
      );
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
      current.policy.roleModel,
      current.brainAuthority,
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
    const { role, policy, brainAuthority } = await grantSnapshot(
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
      policy.roleModel,
      brainAuthority,
    );
    await tx`update ${tx(tables.requests)} set status='approved',reviewed_by=${opts.reviewerId},reviewed_at=now()
      where id=${id}::uuid and organization_id=${opts.organizationId}`;
  });
  await invalidateRbac(opts.organizationId);
}
