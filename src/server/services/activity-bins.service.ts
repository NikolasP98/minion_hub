import { eq, and, gte, lt, sql } from 'drizzle-orm';
import { activityBins } from '$server/db/schema';
import type { TenantContext } from './base';

export interface ActivityBinItem {
  agentId: string;
  binTs: number;
  count: number;
}

export async function getActivityBins(ctx: TenantContext, serverId: string, since: number): Promise<ActivityBinItem[]> {
  return ctx.db
    .select({ agentId: activityBins.agentId, binTs: activityBins.binTs, count: activityBins.count })
    .from(activityBins)
    .where(
      and(
        eq(activityBins.tenantId, ctx.tenantId),
        eq(activityBins.serverId, serverId),
        gte(activityBins.binTs, since),
      ),
    );
}

const BATCH_SIZE = 100;

export async function upsertActivityBins(ctx: TenantContext, serverId: string, items: ActivityBinItem[]): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    await ctx.db
      .insert(activityBins)
      .values(
        batch.map((item) => ({
          id: crypto.randomUUID(),
          tenantId: ctx.tenantId,
          serverId,
          agentId: item.agentId,
          binTs: item.binTs,
          count: item.count,
        })),
      )
      .onConflictDoUpdate({
        target: [activityBins.serverId, activityBins.agentId, activityBins.binTs],
        set: { count: sql`MAX(${activityBins.count}, excluded.count)` },
      });
  }
}

export async function pruneOldActivityBins(ctx: TenantContext, serverId: string, olderThan: number): Promise<void> {
  await ctx.db
    .delete(activityBins)
    .where(
      and(
        eq(activityBins.tenantId, ctx.tenantId),
        eq(activityBins.serverId, serverId),
        lt(activityBins.binTs, olderThan),
      ),
    );
}
