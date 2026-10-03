import { getPgClient } from '$server/db/pg-pool';
import type postgres from 'postgres';
import {
  buildCapabilities,
  resolveMemberRoleKeys,
  type CapabilityOverrideRow,
} from './rbac.service';

const MAX_MEMBER_ROLES = 64;
const MAX_AUTHORITY_ROLE_BYTES = 256;
const MAX_AUTHORITY_MODULE_BYTES = 64;
const MAX_AUTHORITY_GATEWAY_URL_BYTES = 16_384;
const MAX_AUTHORITY_SERVER_ID_BYTES = 256;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const RELIABILITY_MEMBER_AUTHORITY_QUERY = `
  select
    case when m.role is null or octet_length(m.role)<=256 then m.role else null end as legacy_role,
    case when p.role is null or octet_length(p.role)<=256 then p.role else null end as profile_role,
    case when mr.role_key is null or octet_length(mr.role_key)<=256 then mr.role_key else null end as role_key,
    (
      coalesce(octet_length(m.role)>256,false) or
      coalesce(octet_length(p.role)>256,false) or
      coalesce(octet_length(mr.role_key)>256,false)
    ) as field_overflow
  from public.organization_members m
  inner join public.organizations o on o.id=m.organization_id and o.status='active'
  inner join public.profiles p on p.id=m.profile_id
  left join public.member_roles mr
    on mr.org_id=m.organization_id and mr.profile_id=m.profile_id
  where m.organization_id=$1::uuid and m.profile_id=$2::uuid
  order by mr.role_key
  limit 65
`;

export const RELIABILITY_TARGET_QUERY = `
  select id::text,
    case
      when legacy_server_id is null then null
      when octet_length(legacy_server_id)<=256 then legacy_server_id
      else null
    end as legacy_server_id,
    org_id::text,
    case when octet_length(url)<=16384 then url else null end as url,
    (
      coalesce(octet_length(legacy_server_id)>256,false) or
      octet_length(url)>16384
    ) as field_overflow
  from public.gateway
  where id::text=$1 or legacy_server_id=$1
  order by id
  limit 3
`;

export class ReliabilityReadAuthorityError extends Error {
  constructor(
    readonly status: 401 | 403 | 404,
    readonly code: string,
  ) {
    super('Reliability read unavailable');
    this.name = 'ReliabilityReadAuthorityError';
  }
}

interface MemberRow {
  legacy_role: string | null;
  profile_role: string | null;
  role_key: string | null;
  field_overflow: boolean;
}

interface GatewayRow {
  id: string;
  legacy_server_id: string | null;
  org_id: string;
  url: string | null;
  field_overflow: boolean;
}

interface BoundedCapabilityOverrideRow extends CapabilityOverrideRow {
  field_overflow: boolean;
}

export interface ReliabilityReadTarget {
  profileId: string;
  orgId: string;
  gatewayId: string;
  legacyServerId: string | null;
  gatewayUrl: string;
  globalAdmin: boolean;
}

async function freshMemberAuthority(
  tx: postgres.TransactionSql,
  input: { profileId: string; orgId: string },
): Promise<{ globalAdmin: boolean }> {
  const rows = await tx.unsafe<MemberRow[]>(RELIABILITY_MEMBER_AUTHORITY_QUERY, [
    input.orgId,
    input.profileId,
  ]);
  if (rows.length === 0) throw new ReliabilityReadAuthorityError(403, 'membership_required');
  if (rows.length > MAX_MEMBER_ROLES) {
    throw new ReliabilityReadAuthorityError(403, 'role_set_too_large');
  }
  if (
    rows.some(
      (row) =>
        row.field_overflow !== false ||
        (row.legacy_role !== null &&
          (typeof row.legacy_role !== 'string' ||
            Buffer.byteLength(row.legacy_role) > MAX_AUTHORITY_ROLE_BYTES)) ||
        (row.profile_role !== null &&
          (typeof row.profile_role !== 'string' ||
            Buffer.byteLength(row.profile_role) > MAX_AUTHORITY_ROLE_BYTES)) ||
        (row.role_key !== null &&
          (typeof row.role_key !== 'string' ||
            Buffer.byteLength(row.role_key) > MAX_AUTHORITY_ROLE_BYTES)),
    )
  ) {
    throw new ReliabilityReadAuthorityError(403, 'authority_projection_invalid');
  }
  const assigned = [...new Set(rows.flatMap((row) => (row.role_key ? [row.role_key] : [])))];
  const globalAdmin = rows[0]?.profile_role === 'admin';
  if (globalAdmin) return { globalAdmin: true };
  const roles = resolveMemberRoleKeys(assigned, rows[0]?.legacy_role ?? null);
  const boundedRules =
    roles.length === 0
      ? []
      : await tx<BoundedCapabilityOverrideRow[]>`
          select
            case when octet_length(role_key)<=${MAX_AUTHORITY_ROLE_BYTES} then role_key else null end as role_key,
            case when octet_length(module)<=${MAX_AUTHORITY_MODULE_BYTES} then module else null end as module,
            can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level,
            (
              octet_length(role_key)>${MAX_AUTHORITY_ROLE_BYTES} or
              octet_length(module)>${MAX_AUTHORITY_MODULE_BYTES}
            ) as field_overflow
          from public.permission_rules
          where org_id=${input.orgId}::uuid and role_key in ${tx(roles)}
            and module='reliability'
          limit ${MAX_MEMBER_ROLES + 1}
        `;
  if (
    boundedRules.length > MAX_MEMBER_ROLES ||
    boundedRules.some(
      (row) =>
        row.field_overflow !== false ||
        typeof row.role_key !== 'string' ||
        typeof row.module !== 'string',
    )
  ) {
    throw new ReliabilityReadAuthorityError(403, 'authority_projection_invalid');
  }
  const rules: CapabilityOverrideRow[] = boundedRules.map(({ field_overflow: _, ...row }) => row);
  if (!buildCapabilities(roles, rules).can('reliability', 'view')) {
    throw new ReliabilityReadAuthorityError(403, 'capability_required');
  }
  return { globalAdmin: false };
}

function validateIdentity(input: { profileId: string | null; orgId: string | null }): {
  profileId: string;
  orgId: string;
} {
  if (!input.profileId || !input.orgId || !UUID.test(input.profileId) || !UUID.test(input.orgId)) {
    throw new ReliabilityReadAuthorityError(401, 'identity_required');
  }
  return { profileId: input.profileId, orgId: input.orgId };
}

/** One fresh PG snapshot binds membership, capability, target and user_gateway ownership. */
export async function resolveReliabilityReadTarget(input: {
  profileId: string | null;
  orgId: string | null;
  serverId: string;
}): Promise<ReliabilityReadTarget> {
  const identity = validateIdentity(input);
  if (
    typeof input.serverId !== 'string' ||
    input.serverId.length === 0 ||
    Buffer.byteLength(input.serverId) > MAX_AUTHORITY_SERVER_ID_BYTES
  ) {
    throw new ReliabilityReadAuthorityError(404, 'target_unavailable');
  }
  const pg = getPgClient();
  return pg.begin('isolation level repeatable read read only', async (tx) => {
    await tx`select set_config('statement_timeout','15s',true)`;
    const { globalAdmin } = await freshMemberAuthority(tx, identity);
    const targets = await tx.unsafe<GatewayRow[]>(RELIABILITY_TARGET_QUERY, [input.serverId]);
    const target = targets.length === 1 ? targets[0]! : null;
    if (
      !target ||
      target.org_id !== identity.orgId ||
      target.field_overflow !== false ||
      typeof target.url !== 'string' ||
      target.url.length === 0 ||
      Buffer.byteLength(target.url) > MAX_AUTHORITY_GATEWAY_URL_BYTES ||
      (target.legacy_server_id !== null &&
        (typeof target.legacy_server_id !== 'string' ||
          Buffer.byteLength(target.legacy_server_id) > MAX_AUTHORITY_SERVER_ID_BYTES))
    ) {
      throw new ReliabilityReadAuthorityError(404, 'target_unavailable');
    }
    const gatewayUrl = target.url;
    if (!globalAdmin) {
      const links = await tx<{ linked: boolean }[]>`
				select exists(
					select 1 from public.user_gateway
					where profile_id=${identity.profileId}::uuid and gateway_id=${target.id}::uuid
				) as linked
			`;
      if (links[0]?.linked !== true) {
        throw new ReliabilityReadAuthorityError(404, 'target_unavailable');
      }
    }
    return {
      profileId: identity.profileId,
      orgId: identity.orgId,
      gatewayId: target.id,
      legacyServerId: target.legacy_server_id,
      gatewayUrl,
      globalAdmin,
    };
  });
}

/** Architecture has no target selector, but still needs fresh active membership and capability. */
export async function requireFreshReliabilityMember(input: {
  profileId: string | null;
  orgId: string | null;
}): Promise<{ profileId: string; orgId: string; globalAdmin: boolean }> {
  const identity = validateIdentity(input);
  const pg = getPgClient();
  return pg.begin('isolation level repeatable read read only', async (tx) => {
    await tx`select set_config('statement_timeout','15s',true)`;
    return { ...identity, ...(await freshMemberAuthority(tx, identity)) };
  });
}
