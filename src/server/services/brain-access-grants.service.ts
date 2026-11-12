import { error } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { withOrgCoreTransaction, type CoreTx } from '$server/db/with-org-core';
import { brains, brainAccess, type Brain, type BrainAccessRow } from '$server/db/pg-schema/brains';
import { lockNavigationPolicy } from './nav-policy-lock';
import {
  parseOrganizationRolePolicy,
  type OrganizationRolePolicy,
} from './organization-role-policy';
import { resolveFreshCapabilitiesInTransaction, type Capabilities } from './rbac.service';
import type { AccessPrincipal } from './brains.service';

interface WriteContext {
  tx: CoreTx;
  brain: Brain;
  policy: OrganizationRolePolicy;
  profileId: string;
}
function objectWrite(
  brain: Brain,
  rows: BrainAccessRow[],
  profileId: string,
  roles: string[],
  caps: Capabilities,
  policy: OrganizationRolePolicy,
  agentId?: string | null,
): boolean {
  if (brain.createdBy === profileId) return true;
  if (policy.roleModel === 'legacy' && roles.some((role) => role === 'owner' || role === 'admin'))
    return true;
  if (
    policy.roleModel === 'organization' &&
    caps.can('brains', 'view') &&
    caps.can('brains', 'manage')
  )
    return true;
  return rows.some(
    (row) =>
      row.level === 'write' &&
      ((row.principalType === 'user' && row.principalId === profileId) ||
        (row.principalType === 'role' && roles.includes(row.principalId)) ||
        (row.principalType === 'agent' && !!agentId && row.principalId === agentId)),
  );
}
/** Serialize all user-initiated ACL/visibility grants with current role and object authority. */
export async function withBrainWriteAuthority<T>(
  ctx: CoreCtx,
  brainId: string,
  principal: AccessPrincipal,
  fn: (scope: WriteContext) => Promise<T>,
  validate?: (scope: WriteContext) => Promise<void>,
  options: { requireManage?: boolean } = {},
): Promise<T> {
  const profileId = ctx.profileId ?? principal.profileId;
  if (!profileId || (principal.profileId && principal.profileId !== profileId))
    throw error(403, 'Authenticated brain grantor required');
  return ctx.db.transaction(async (tx) => {
    await lockNavigationPolicy(tx, ctx.tenantId);
    const [brain] = await tx
      .select()
      .from(brains)
      .where(and(eq(brains.id, brainId), eq(brains.orgId, ctx.tenantId)))
      .for('update');
    if (!brain) throw error(404, 'Brain not found');
    const [profile] = await tx.execute<{ deletion_pending: boolean }>(
      sql`select coalesce((to_jsonb(p)->>'deletion_pending')::boolean,false) as deletion_pending from profiles p where id=${profileId}::uuid for share`,
    );
    if (!profile || profile.deletion_pending) throw error(403, 'Active brain grantor required');
    const authority = await resolveFreshCapabilitiesInTransaction(tx, ctx.tenantId, profileId);
    for (const caps of [authority.realCapabilities, authority.capabilities])
      if (
        !caps.can('brains', 'view') ||
        !caps.can('brains', 'edit') ||
        (options.requireManage && !caps.can('brains', 'manage')) ||
        (caps.ownerScoped('brains') && brain.createdBy !== profileId)
      )
        throw error(403, 'Brain write permission required');
    const [org] = await tx.execute<{ role_model: string | null; default_role_key: string | null }>(
      sql`select to_jsonb(o)->>'role_model' as role_model,to_jsonb(o)->>'default_role_key' as default_role_key from organizations o where id=${ctx.tenantId}::uuid and status='active' for share`,
    );
    const policy = parseOrganizationRolePolicy(org);
    const access = await tx
      .select()
      .from(brainAccess)
      .where(and(eq(brainAccess.brainId, brainId), eq(brainAccess.orgId, ctx.tenantId)));
    if (
      !objectWrite(
        brain,
        access,
        profileId,
        authority.realRoles,
        authority.realCapabilities,
        policy,
        principal.agentId,
      ) ||
      !objectWrite(
        brain,
        access,
        profileId,
        authority.roles,
        authority.capabilities,
        policy,
        principal.agentId,
      )
    )
      throw error(403, 'No current write access to this brain');
    await validate?.({ tx, brain, policy, profileId });
    return withOrgCoreTransaction({ ...ctx, profileId }, tx, async (scoped) =>
      fn({ tx: scoped, brain, policy, profileId }),
    );
  });
}

export interface BrainGrant {
  principalType: 'role' | 'user' | 'agent';
  principalId: string;
  level: 'read' | 'write';
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Recipient references must belong to the exact same organization as the asset. */
export async function validateBrainGrantRecipients(
  tx: CoreTx,
  orgId: string,
  policy: OrganizationRolePolicy,
  rows: readonly BrainGrant[],
): Promise<void> {
  if (rows.length > 256) throw error(400, 'At most 256 brain access grants are supported');
  const seen = new Set<string>();
  for (const row of rows) {
    if (
      !['read', 'write'].includes(row.level) ||
      !row.principalId ||
      seen.has(row.principalType + ':' + row.principalId)
    )
      throw error(400, 'Invalid or duplicate brain access grant');
    seen.add(row.principalType + ':' + row.principalId);
    let valid = false;
    if (row.principalType === 'role') {
      if (policy.roleModel === 'organization' && !row.principalId.startsWith('custom-'))
        throw error(400, 'Organization-local recipient role required');
      const local = await tx.execute(
        sql`select 1 from org_roles where org_id=${orgId} and key=${row.principalId} for share`,
      );
      const global =
        policy.roleModel === 'legacy'
          ? await tx.execute(
              sql`select 1 from permission_roles where key=${row.principalId} for share`,
            )
          : [];
      valid = local.length > 0 || global.length > 0;
    } else if (row.principalType === 'user') {
      if (!UUID.test(row.principalId)) throw error(400, 'Valid recipient profile required');
      const member = await tx.execute(
        sql`select 1 from organization_members m join profiles p on p.id=m.profile_id where m.organization_id=${orgId}::uuid and m.profile_id=${row.principalId}::uuid and not coalesce((to_jsonb(p)->>'deletion_pending')::boolean,false) for share of m,p`,
      );
      valid = member.length > 0;
    } else if (row.principalType === 'agent') {
      const brainAgent = await tx.execute(
        sql`select 1 from brains where org_id=${orgId} and agent_id=${row.principalId} for share`,
      );
      const builtAgent = brainAgent.length
        ? []
        : await tx.execute(
            sql`select 1 from built_agents where tenant_id=${orgId}::uuid and (runtime_agent_id=${row.principalId} or id=${row.principalId}) for share`,
          );
      const personalAgent =
        brainAgent.length || builtAgent.length
          ? []
          : await tx.execute(
              sql`select 1 from personal_agents a join gateway g on g.id=a.gateway_id join organization_members m on m.profile_id=a.profile_id and m.organization_id=${orgId}::uuid where g.org_id=${orgId}::uuid and a.agent_id=${row.principalId} for share of a,g,m`,
            );
      const userAgent =
        brainAgent.length || builtAgent.length || personalAgent.length
          ? []
          : await tx.execute(
              sql`select 1 from user_agents a join gateway g on g.id=a.gateway_id join organization_members m on m.profile_id=a.user_id and m.organization_id=${orgId}::uuid where g.org_id=${orgId}::uuid and a.agent_id=${row.principalId} for share of a,g,m`,
            );
      valid = brainAgent.length + builtAgent.length + personalAgent.length + userAgent.length > 0;
    }
    if (!valid) throw error(400, 'Brain recipient does not belong to this organization');
  }
}
