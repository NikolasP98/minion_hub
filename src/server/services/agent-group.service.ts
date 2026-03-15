import { eq, and, asc } from 'drizzle-orm';
import { agentGroups, agentGroupMembers } from '$server/db/schema';
import { newId, nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

export async function listGroups(ctx: TenantContext, userId: string) {
  const groups = await ctx.db
    .select()
    .from(agentGroups)
    .where(and(eq(agentGroups.userId, userId), eq(agentGroups.tenantId, ctx.tenantId)))
    .orderBy(asc(agentGroups.sortOrder));

  const groupIds = groups.map((g) => g.id);
  let members: { groupId: string; agentId: string; sortOrder: number | null }[] = [];
  if (groupIds.length > 0) {
    members = await ctx.db
      .select()
      .from(agentGroupMembers)
      .orderBy(asc(agentGroupMembers.sortOrder));
    // Filter to only members of these groups
    const groupIdSet = new Set(groupIds);
    members = members.filter((m) => groupIdSet.has(m.groupId));
  }

  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    sortOrder: g.sortOrder ?? 0,
    memberAgentIds: members.filter((m) => m.groupId === g.id).map((m) => m.agentId),
  }));
}

export async function createGroup(ctx: TenantContext, userId: string, name: string) {
  const id = newId();
  const now = nowMs();
  await ctx.db.insert(agentGroups).values({
    id,
    userId,
    tenantId: ctx.tenantId,
    name,
    sortOrder: 0,
    createdAt: now,
  });
  return { id, name, sortOrder: 0, memberAgentIds: [] as string[] };
}

export async function updateGroup(
  ctx: TenantContext,
  userId: string,
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
      and(eq(agentGroups.id, groupId), eq(agentGroups.userId, userId), eq(agentGroups.tenantId, ctx.tenantId)),
    );
}

export async function deleteGroup(ctx: TenantContext, userId: string, groupId: string) {
  await ctx.db
    .delete(agentGroups)
    .where(
      and(eq(agentGroups.id, groupId), eq(agentGroups.userId, userId), eq(agentGroups.tenantId, ctx.tenantId)),
    );
}

export async function setGroupMembers(ctx: TenantContext, userId: string, groupId: string, agentIds: string[]) {
  // Verify the group belongs to this user
  const [group] = await ctx.db
    .select({ id: agentGroups.id })
    .from(agentGroups)
    .where(and(eq(agentGroups.id, groupId), eq(agentGroups.userId, userId), eq(agentGroups.tenantId, ctx.tenantId)))
    .limit(1);
  if (!group) return;

  await ctx.db
    .delete(agentGroupMembers)
    .where(eq(agentGroupMembers.groupId, groupId));

  if (agentIds.length === 0) return;

  await ctx.db.insert(agentGroupMembers).values(
    agentIds.map((agentId, i) => ({
      groupId,
      agentId,
      sortOrder: i,
    })),
  );
}

export async function addAgentToGroup(ctx: TenantContext, userId: string, groupId: string, agentId: string) {
  await ctx.db
    .insert(agentGroupMembers)
    .values({ groupId, agentId, sortOrder: 0 })
    .onConflictDoNothing();
}

export async function removeAgentFromGroup(ctx: TenantContext, userId: string, groupId: string, agentId: string) {
  await ctx.db
    .delete(agentGroupMembers)
    .where(
      and(
        eq(agentGroupMembers.groupId, groupId),
        eq(agentGroupMembers.agentId, agentId),
      ),
    );
}

export async function moveAgentToGroup(
  ctx: TenantContext,
  userId: string,
  agentId: string,
  fromGroupId: string | null,
  toGroupId: string | null,
) {
  if (fromGroupId) {
    await removeAgentFromGroup(ctx, userId, fromGroupId, agentId);
  }
  if (toGroupId) {
    await addAgentToGroup(ctx, userId, toGroupId, agentId);
  }
}
