import { eq, and, desc } from 'drizzle-orm';
import { connectionEvents } from '$server/db/schema';
import { nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

export interface ConnectionEventInput {
  serverId: string;
  eventType: string;
  hostName?: string;
  hostUrl?: string;
  durationMs?: number;
  reason?: string;
}

export async function insertConnectionEvent(ctx: TenantContext, ev: ConnectionEventInput) {
  await ctx.db.insert(connectionEvents).values({
    tenantId: ctx.tenantId,
    serverId: ev.serverId,
    eventType: ev.eventType,
    hostName: ev.hostName ?? null,
    hostUrl: ev.hostUrl ?? null,
    durationMs: ev.durationMs ?? null,
    reason: ev.reason ?? null,
    occurredAt: nowMs(),
  });
}

export async function listConnectionEvents(
  ctx: TenantContext,
  serverId: string,
  limit = 100,
) {
  return ctx.db
    .select()
    .from(connectionEvents)
    .where(and(eq(connectionEvents.serverId, serverId), eq(connectionEvents.tenantId, ctx.tenantId)))
    .orderBy(desc(connectionEvents.occurredAt))
    .limit(limit);
}
