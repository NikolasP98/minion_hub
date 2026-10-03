import { getPgClient } from '$server/db/pg-pool';
import {
  buildCapabilities,
  resolveMemberRoleKeys,
  type CapabilityOverrideRow,
  type Module,
  type PermAction,
} from './rbac.service';

export const FRESH_ORG_MEMBER_LIMIT = 1000;

export interface FreshOrgAuthorityTables {
  organizations: string;
  organizationMembers: string;
  profiles: string;
  authUsers: string;
  memberRoles: string;
  permissionRules: string;
}

export const FRESH_ORG_AUTHORITY_TABLES: Readonly<FreshOrgAuthorityTables> = Object.freeze({
  organizations: 'public.organizations',
  organizationMembers: 'public.organization_members',
  profiles: 'public.profiles',
  authUsers: 'auth.users',
  memberRoles: 'public.member_roles',
  permissionRules: 'public.permission_rules',
});

export class FreshOrgAuthorityOverflow extends Error {
  readonly code = 'candidate_limit_exceeded';

  constructor(readonly limit: number) {
    super('Fresh organization authority candidate limit exceeded');
    this.name = 'FreshOrgAuthorityOverflow';
  }
}

export interface FreshOrgAuthorityRow {
  profile_id: string;
  legacy_role: string | null;
  profile_role: string | null;
  auth_email: string | null;
  email_confirmed_at: Date | string | null;
  role_key: string | null;
}

export interface FreshOrgAuthorizedMember {
  profileId: string;
  verifiedEmail: string | null;
}

function verifiedEmail(row: FreshOrgAuthorityRow): string | null {
  if (!row.email_confirmed_at || typeof row.auth_email !== 'string') return null;
  const email = row.auth_email.trim().toLocaleLowerCase('en-US');
  return email || null;
}

export function buildFreshOrgAuthorizedMembers(
  rows: readonly FreshOrgAuthorityRow[],
  rules: readonly CapabilityOverrideRow[],
  module: Module,
  action: PermAction,
  limit = FRESH_ORG_MEMBER_LIMIT,
): FreshOrgAuthorizedMember[] {
  const members = new Map<string, { row: FreshOrgAuthorityRow; assignedRoles: Set<string> }>();
  for (const row of rows) {
    const member = members.get(row.profile_id) ?? { row, assignedRoles: new Set<string>() };
    if (row.role_key) member.assignedRoles.add(row.role_key);
    members.set(row.profile_id, member);
  }
  if (members.size > limit) throw new FreshOrgAuthorityOverflow(limit);

  return [...members.values()]
    .filter(({ row, assignedRoles }) => {
      // The profile-level administrator bypass is considered only after this
      // member came from the exact organization_members candidate set.
      if (row.profile_role === 'admin') return true;
      const roles = resolveMemberRoleKeys([...assignedRoles], row.legacy_role);
      return buildCapabilities(roles, [...rules]).can(module, action);
    })
    .map(({ row }) => ({ profileId: row.profile_id, verifiedEmail: verifiedEmail(row) }))
    .sort((a, b) => a.profileId.localeCompare(b.profileId));
}

function authorityRoleKeys(rows: FreshOrgAuthorityRow[], limit: number): string[] {
  const roleKeys = new Set<string>();
  const grouped = new Map<string, FreshOrgAuthorityRow>();
  const membersWithAssignedRoles = new Set<string>();
  for (const row of rows) {
    grouped.set(row.profile_id, row);
    if (row.role_key) {
      roleKeys.add(row.role_key);
      membersWithAssignedRoles.add(row.profile_id);
    }
  }
  if (grouped.size > limit) throw new FreshOrgAuthorityOverflow(limit);
  for (const row of grouped.values()) {
    if (!membersWithAssignedRoles.has(row.profile_id)) {
      roleKeys.add(resolveMemberRoleKeys([], row.legacy_role)[0]!);
    }
  }
  return [...roleKeys];
}

/**
 * Resolve capability recipients without the navigation cache. Membership is
 * selected first in SQL, then the exact current role/rule rows are evaluated
 * through the same capability builder used by normal RBAC.
 */
export async function resolveFreshOrgMembersWithCapability(
  orgId: string,
  module: Module,
  action: PermAction,
  limit = FRESH_ORG_MEMBER_LIMIT,
  tables: Readonly<FreshOrgAuthorityTables> = FRESH_ORG_AUTHORITY_TABLES,
): Promise<FreshOrgAuthorizedMember[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > FRESH_ORG_MEMBER_LIMIT) {
    throw new RangeError('Fresh organization authority limit is invalid');
  }
  const pg = getPgClient();
  return pg.begin('isolation level repeatable read read only', async (tx) => {
    const rows = await tx<FreshOrgAuthorityRow[]>`
      with candidates as (
        select m.profile_id,m.role as legacy_role,p.role as profile_role
        from ${tx(tables.organizationMembers)} m
        inner join ${tx(tables.organizations)} o on o.id=m.organization_id and o.status='active'
        inner join ${tx(tables.profiles)} p on p.id=m.profile_id
        where m.organization_id=${orgId}::uuid
        order by m.profile_id
        limit ${limit + 1}
      )
      select c.profile_id::text,c.legacy_role,c.profile_role,
             u.email as auth_email,u.email_confirmed_at,mr.role_key
      from candidates c
      left join ${tx(tables.authUsers)} u on u.id=c.profile_id
      left join ${tx(tables.memberRoles)} mr
        on mr.org_id=${orgId}::uuid and mr.profile_id=c.profile_id
      order by c.profile_id,mr.role_key
    `;
    const roleKeys = authorityRoleKeys(rows, limit);
    const rules =
      roleKeys.length === 0
        ? []
        : await tx<CapabilityOverrideRow[]>`
            select role_key,module,can_view,can_create,can_edit,can_delete,
                   can_export,can_manage,if_owner,field_level
            from ${tx(tables.permissionRules)}
            where org_id=${orgId}::uuid and role_key in ${tx(roleKeys)}
          `;
    return buildFreshOrgAuthorizedMembers(rows, rules, module, action, limit);
  });
}

export async function resolveFreshOrgMemberWithCapability(
  orgId: string,
  profileId: string,
  module: Module,
  action: PermAction,
  tables: Readonly<FreshOrgAuthorityTables> = FRESH_ORG_AUTHORITY_TABLES,
): Promise<FreshOrgAuthorizedMember | null> {
  const pg = getPgClient();
  return pg.begin('isolation level repeatable read read only', async (tx) => {
    const rows = await tx<FreshOrgAuthorityRow[]>`
      select m.profile_id::text,m.role as legacy_role,p.role as profile_role,
             u.email as auth_email,u.email_confirmed_at,mr.role_key
      from ${tx(tables.organizationMembers)} m
      inner join ${tx(tables.organizations)} o on o.id=m.organization_id and o.status='active'
      inner join ${tx(tables.profiles)} p on p.id=m.profile_id
      left join ${tx(tables.authUsers)} u on u.id=m.profile_id
      left join ${tx(tables.memberRoles)} mr
        on mr.org_id=m.organization_id and mr.profile_id=m.profile_id
      where m.organization_id=${orgId}::uuid and m.profile_id=${profileId}::uuid
      order by mr.role_key
    `;
    const roleKeys = authorityRoleKeys(rows, 1);
    const rules =
      roleKeys.length === 0
        ? []
        : await tx<CapabilityOverrideRow[]>`
            select role_key,module,can_view,can_create,can_edit,can_delete,
                   can_export,can_manage,if_owner,field_level
            from ${tx(tables.permissionRules)}
            where org_id=${orgId}::uuid and role_key in ${tx(roleKeys)}
          `;
    return buildFreshOrgAuthorizedMembers(rows, rules, module, action, 1)[0] ?? null;
  });
}
