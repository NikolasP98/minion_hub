import { and, eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { builtAgents, builtChapterEdges, builtChapters, builtSkills } from '@minion-stack/db/pg';
import { requireAuth } from '$server/auth/authorize';
import { getServerCtx } from '$server/auth/core-ctx';
import { requireOrgCapability, type PermAction } from '$server/services/rbac.service';
import type { CoreCtx } from '$server/auth/core-ctx';
import { resolveGatewayId, resolveServerId } from '$server/services/gateway.pg.service';

export type BuilderResource = 'agent' | 'skill';
export type BuilderSkillChild = 'chapter' | 'edge';

export function builderOwner(locals: App.Locals): { id: string; isAdmin: boolean } {
  const user = requireAuth(locals);
  return { id: user.id, isAdmin: user.role === 'admin' };
}

export async function requireBuilderCapability(locals: App.Locals, action: PermAction) {
  return requireOrgCapability(locals, 'agents', action);
}

/**
 * Verify a builder operation may target the selected gateway. Admins inherit
 * the same all-gateways visibility used by the host picker; everyone else must
 * have a current user_gateway link. This check is repeated when publishing so
 * a draft cannot retain access after its gateway assignment is revoked.
 */
export async function requireBuilderServerAccess(
  locals: App.Locals,
  serverId: string,
): Promise<void> {
  if (!(await resolveGatewayId(serverId))) throw error(404, 'Gateway not found.');
  if (builderOwner(locals).isAdmin) return;
  if (!(await getServerCtx(locals, serverId))) {
    throw error(403, 'You do not have access to that gateway.');
  }
}

export async function requireBuilderGatewayAccess(
  locals: App.Locals,
  gatewayId: string,
): Promise<void> {
  if (builderOwner(locals).isAdmin) return;
  await requireBuilderServerAccess(locals, await resolveServerId(gatewayId));
}

/** Tenant + owner check. Non-owned IDs deliberately resolve as 404. */
export async function requireBuilderOwnership(
  locals: App.Locals,
  ctx: CoreCtx,
  resource: BuilderResource,
  id: string,
) {
  const actor = builderOwner(locals);
  const table = resource === 'agent' ? builtAgents : builtSkills;
  const [record] = await ctx.db
    .select({ id: table.id, createdBy: table.createdBy })
    .from(table)
    .where(and(eq(table.id, id), eq(table.tenantId, ctx.tenantId)))
    .limit(1);
  if (!record || (!actor.isAdmin && record.createdBy !== actor.id)) {
    throw error(404, resource === 'agent' ? 'Agent not found' : 'Skill not found');
  }
  return record;
}

/** Parent-bound child lookup prevents chapter/edge IDs crossing skill owners. */
export async function requireBuilderSkillChild(
  ctx: CoreCtx,
  skillId: string,
  resource: BuilderSkillChild,
  id: string,
): Promise<void> {
  const table = resource === 'chapter' ? builtChapters : builtChapterEdges;
  const [record] = await ctx.db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), eq(table.skillId, skillId)))
    .limit(1);
  if (!record) throw error(404, resource === 'chapter' ? 'Chapter not found' : 'Edge not found');
}
