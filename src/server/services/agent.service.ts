import { eq, and, sql } from 'drizzle-orm';
import { agents, userAgents } from '@minion-stack/db/schema';
import { cached, invalidateTags, keys, tags } from '@minion-stack/cache';
import { nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

export interface AgentInput {
  id: string;
  name?: string | null;
  emoji?: string | null;
  description?: string | null;
  model?: string | null;
  [key: string]: unknown;
}

const BATCH_SIZE = 100;

export async function upsertAgents(ctx: TenantContext, serverId: string, items: AgentInput[]) {
  if (items.length === 0) return;
  const now = nowMs();

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    await ctx.db
      .insert(agents)
      .values(
        batch.map((a) => ({
          id: a.id,
          serverId,
          tenantId: ctx.tenantId,
          name: a.name ?? null,
          emoji: a.emoji ?? null,
          description: a.description ?? null,
          model: a.model ?? null,
          rawJson: JSON.stringify(a),
          lastSeenAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [agents.id, agents.serverId],
        set: {
          name: sql`excluded.name`,
          emoji: sql`excluded.emoji`,
          description: sql`excluded.description`,
          model: sql`excluded.model`,
          rawJson: sql`excluded.raw_json`,
          lastSeenAt: now,
        },
      });
  }

  await invalidateTags(tags.tenantDomain(ctx.tenantId, 'agents'));
}

export async function listAgents(ctx: TenantContext, serverId: string) {
  return cached(
    keys.hub('agents', { t: ctx.tenantId, d: { serverId } }),
    {
      ttl: '30m',
      swr: '5m',
      tags: tags.tenantDomain(ctx.tenantId, 'agents'),
    },
    async () => {
      const rows = await ctx.db
        .select({ rawJson: agents.rawJson })
        .from(agents)
        .where(and(eq(agents.serverId, serverId), eq(agents.tenantId, ctx.tenantId)));

      return rows.map((r) => JSON.parse(r.rawJson));
    },
  );
}

export async function listAgentsForUser(
  ctx: TenantContext,
  serverId: string,
  userId: string,
  userRole: string,
) {
  if (userRole === 'admin') return listAgents(ctx, serverId);

  return cached(
    keys.hub('agents', { t: ctx.tenantId, u: userId, d: { serverId } }),
    {
      ttl: '30m',
      swr: '5m',
      tags: [...tags.tenantDomain(ctx.tenantId, 'agents'), ...tags.user(userId)],
    },
    async () => {
      const rows = await ctx.db
        .select({ rawJson: agents.rawJson })
        .from(agents)
        .innerJoin(
          userAgents,
          and(
            eq(userAgents.agentId, agents.id),
            eq(userAgents.serverId, agents.serverId),
            eq(userAgents.userId, userId),
          ),
        )
        .where(and(eq(agents.serverId, serverId), eq(agents.tenantId, ctx.tenantId)));

      return rows.map((r) => JSON.parse(r.rawJson));
    },
  );
}
