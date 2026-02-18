import { eq, and } from 'drizzle-orm';
import { agents } from '$server/db/schema';
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

export async function upsertAgents(ctx: TenantContext, serverId: string, items: AgentInput[]) {
  if (items.length === 0) return;
  const now = nowMs();

  for (const a of items) {
    await ctx.db
      .insert(agents)
      .values({
        id: a.id,
        serverId,
        tenantId: ctx.tenantId,
        name: a.name ?? null,
        emoji: a.emoji ?? null,
        description: a.description ?? null,
        model: a.model ?? null,
        rawJson: JSON.stringify(a),
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [agents.id, agents.serverId],
        set: {
          name: a.name ?? null,
          emoji: a.emoji ?? null,
          description: a.description ?? null,
          model: a.model ?? null,
          rawJson: JSON.stringify(a),
          lastSeenAt: now,
        },
      });
  }
}

export async function listAgents(ctx: TenantContext, serverId: string) {
  const rows = await ctx.db
    .select({ rawJson: agents.rawJson })
    .from(agents)
    .where(and(eq(agents.serverId, serverId), eq(agents.tenantId, ctx.tenantId)));

  return rows.map((r) => JSON.parse(r.rawJson));
}
