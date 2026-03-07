import { eq, and, asc } from 'drizzle-orm';
import { agentGroups, agentGroupMembers } from '$server/db/schema';
import { newId, nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

export async function listGroups(ctx: TenantContext, serverId: string) {
  const groups = await ctx.db
    .select()
    .from(agentGroups)
    .where(and(eq(agentGroups.serverId, serverId), eq(agentGroups.tenantId, ctx.tenantId)))
    .orderBy(asc(agentGroups.sortOrder));

  const members = await ctx.db
    .select()
    .from(agentGroupMembers)
    .where(eq(agentGroupMembers.serverId, serverId))
    .orderBy(asc(agentGroupMembers.sortOrder));

  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    sortOrder: g.sortOrder ?? 0,
    memberAgentIds: members.filter((m) => m.groupId === g.id).map((m) => m.agentId),
  }));
}

export async function createGroup(ctx: TenantContext, serverId: string, name: string) {
  const id = newId();
  const now = nowMs();
  await ctx.db.insert(agentGroups).values({
    id,
    serverId,
    tenantId: ctx.tenantId,
    name,
    sortOrder: 0,
    createdAt: now,
  });
  return { id, name, sortOrder: 0, memberAgentIds: [] as string[] };
}

export async function updateGroup(
  ctx: TenantContext,
  serverId: string,
  groupId: string,
  data: { name?: string; sortOrder?: number },
) {
  const set: Record<string, unknown> = {};
  if (data.name !== undefined) set.name = data.name;
  if (data.sortOrder !== undefined) set.sortOrder = data.sortOrder;
  if (Object.keys(set).length === 0) return;

  await ctx.db
    .update(agentGroups)
    .set(set)
    .where(
      and(eq(agentGroups.id, groupId), eq(agentGroups.serverId, serverId), eq(agentGroups.tenantId, ctx.tenantId)),
    );
}

export async function deleteGroup(ctx: TenantContext, serverId: string, groupId: string) {
  await ctx.db
    .delete(agentGroups)
    .where(
      and(eq(agentGroups.id, groupId), eq(agentGroups.serverId, serverId), eq(agentGroups.tenantId, ctx.tenantId)),
    );
}

export async function setGroupMembers(ctx: TenantContext, serverId: string, groupId: string, agentIds: string[]) {
  await ctx.db
    .delete(agentGroupMembers)
    .where(and(eq(agentGroupMembers.groupId, groupId), eq(agentGroupMembers.serverId, serverId)));

  if (agentIds.length === 0) return;

  await ctx.db.insert(agentGroupMembers).values(
    agentIds.map((agentId, i) => ({
      groupId,
      agentId,
      serverId,
      sortOrder: i,
    })),
  );
}

export async function addAgentToGroup(ctx: TenantContext, serverId: string, groupId: string, agentId: string) {
  await ctx.db
    .insert(agentGroupMembers)
    .values({ groupId, agentId, serverId, sortOrder: 0 })
    .onConflictDoNothing();
}

export async function removeAgentFromGroup(ctx: TenantContext, serverId: string, groupId: string, agentId: string) {
  await ctx.db
    .delete(agentGroupMembers)
    .where(
      and(
        eq(agentGroupMembers.groupId, groupId),
        eq(agentGroupMembers.agentId, agentId),
        eq(agentGroupMembers.serverId, serverId),
      ),
    );
}

export async function moveAgentToGroup(
  ctx: TenantContext,
  serverId: string,
  agentId: string,
  fromGroupId: string | null,
  toGroupId: string | null,
) {
  if (fromGroupId) {
    await removeAgentFromGroup(ctx, serverId, fromGroupId, agentId);
  }
  if (toGroupId) {
    await addAgentToGroup(ctx, serverId, toGroupId, agentId);
  }
}
