import { eq, and, asc } from 'drizzle-orm';
import { agentGroups, agentGroupMembers } from '@minion-stack/db/pg';
import { cached, invalidateTags, keys, tags } from '@minion-stack/cache';
import { newId } from '$server/db/utils';
import type { CoreCtx } from '$server/auth/core-ctx';

// `userId` params below carry the Supabase profile id (profiles.id =
// user.supabaseId): agent_groups is keyed by profile_id in Postgres, not the
// legacy bridged user id.

export async function listGroups(ctx: CoreCtx, userId: string) {
  return cached(
    keys.hub('agent-groups', { t: ctx.tenantId, u: userId }),
    {
      ttl: '10m',
      swr: '60s',
      tags: [...tags.tenantDomain(ctx.tenantId, 'agent-groups'), ...tags.user(userId)],
    },
    async () => {
      const groups = await ctx.db
        .select()
        .from(agentGroups)
        .where(and(eq(agentGroups.profileId, userId), eq(agentGroups.tenantId, ctx.tenantId)))
        .orderBy(asc(agentGroups.sortOrder));

      const groupIds = groups.map((g) => g.id);
      let members: { groupId: string; agentId: string; sortOrder: number | null }[] = [];
      if (groupIds.length > 0) {
        members = await ctx.db
          .select()
          .from(agentGroupMembers)
          .orderBy(asc(agentGroupMembers.sortOrder));
        const groupIdSet = new Set(groupIds);
        members = members.filter((m) => groupIdSet.has(m.groupId));
      }

      return groups.map((g) => ({
        id: g.id,
        name: g.name,
        sortOrder: g.sortOrder ?? 0,
        memberAgentIds: members.filter((m) => m.groupId === g.id).map((m) => m.agentId),
      }));
    },
  );
}

export async function createGroup(ctx: CoreCtx, userId: string, name: string) {
  const id = newId();
  await ctx.db.insert(agentGroups).values({
    id,
    profileId: userId,
    tenantId: ctx.tenantId,
    name,
    sortOrder: 0,
  });
  await invalidateTags([
    ...tags.tenantDomain(ctx.tenantId, 'agent-groups'),
    ...tags.user(userId),
  ]);
  return { id, name, sortOrder: 0, memberAgentIds: [] as string[] };
}

export async function updateGroup(
  ctx: CoreCtx,
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
      and(
        eq(agentGroups.id, groupId),
        eq(agentGroups.profileId, userId),
        eq(agentGroups.tenantId, ctx.tenantId),
      ),
    );
  await invalidateTags([
    ...tags.tenantDomain(ctx.tenantId, 'agent-groups'),
    ...tags.user(userId),
    ...tags.entity('group', groupId),
  ]);
}

export async function deleteGroup(ctx: CoreCtx, userId: string, groupId: string) {
  await ctx.db
    .delete(agentGroups)
    .where(
      and(
        eq(agentGroups.id, groupId),
        eq(agentGroups.profileId, userId),
        eq(agentGroups.tenantId, ctx.tenantId),
      ),
    );
  await invalidateTags([
    ...tags.tenantDomain(ctx.tenantId, 'agent-groups'),
    ...tags.user(userId),
    ...tags.entity('group', groupId),
  ]);
}

export async function setGroupMembers(
  ctx: CoreCtx,
  userId: string,
  groupId: string,
  agentIds: string[],
) {
  // Verify the group belongs to this user
  const [group] = await ctx.db
    .select({ id: agentGroups.id })
    .from(agentGroups)
    .where(
      and(
        eq(agentGroups.id, groupId),
        eq(agentGroups.profileId, userId),
        eq(agentGroups.tenantId, ctx.tenantId),
      ),
    )
    .limit(1);
  if (!group) return;

  await ctx.db.delete(agentGroupMembers).where(eq(agentGroupMembers.groupId, groupId));

  if (agentIds.length > 0) {
    await ctx.db.insert(agentGroupMembers).values(
      agentIds.map((agentId, i) => ({
        groupId,
        agentId,
        sortOrder: i,
      })),
    );
  }

  await invalidateTags([
    ...tags.tenantDomain(ctx.tenantId, 'agent-groups'),
    ...tags.user(userId),
    ...tags.entity('group', groupId),
  ]);
}

export async function addAgentToGroup(
  ctx: CoreCtx,
  userId: string,
  groupId: string,
  agentId: string,
) {
  await ctx.db
    .insert(agentGroupMembers)
    .values({ groupId, agentId, sortOrder: 0 })
    .onConflictDoNothing();
  await invalidateTags([
    ...tags.tenantDomain(ctx.tenantId, 'agent-groups'),
    ...tags.user(userId),
    ...tags.entity('group', groupId),
  ]);
}

export async function removeAgentFromGroup(
  ctx: CoreCtx,
  userId: string,
  groupId: string,
  agentId: string,
) {
  await ctx.db
    .delete(agentGroupMembers)
    .where(and(eq(agentGroupMembers.groupId, groupId), eq(agentGroupMembers.agentId, agentId)));
  await invalidateTags([
    ...tags.tenantDomain(ctx.tenantId, 'agent-groups'),
    ...tags.user(userId),
    ...tags.entity('group', groupId),
  ]);
}

export async function moveAgentToGroup(
  ctx: CoreCtx,
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
