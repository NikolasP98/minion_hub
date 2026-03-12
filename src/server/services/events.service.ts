import { eq, and, desc, gte, lte, sql } from 'drizzle-orm';
import { unifiedEvents } from '$server/db/schema';
import { nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

export interface UnifiedEventInput {
  localEventId: number;
  category: string;
  severity: string;
  event: string;
  message: string;
  agentId?: string;
  correlationId?: string;
  metadata?: string;
  occurredAt: number;
}

/**
 * Batch insert events using INSERT OR IGNORE for idempotent upsert.
 * Deduplication is on (tenantId, serverId, localEventId).
 */
export async function insertEventsBatch(
  ctx: TenantContext,
  serverId: string,
  events: UnifiedEventInput[],
): Promise<void> {
  if (events.length === 0) return;
  const now = nowMs();
  const CHUNK = 50;
  for (let i = 0; i < events.length; i += CHUNK) {
    const chunk = events.slice(i, i + CHUNK);
    await ctx.db
      .insert(unifiedEvents)
      .values(
        chunk.map((ev) => ({
          tenantId: ctx.tenantId,
          serverId,
          localEventId: ev.localEventId,
          category: ev.category,
          severity: ev.severity as 'critical' | 'high' | 'medium' | 'low' | 'info',
          event: ev.event,
          message: ev.message,
          agentId: ev.agentId ?? null,
          correlationId: ev.correlationId ?? null,
          metadata: ev.metadata ?? null,
          occurredAt: ev.occurredAt,
          createdAt: now,
        })),
      )
      .onConflictDoNothing();
  }
}

export interface ListEventsOptions {
  category?: string;
  severity?: string;
  agentId?: string;
  correlationId?: string;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
}

/**
 * Query unified events with optional filters.
 * Default limit: 100, max: 1000. Ordered by occurredAt DESC.
 */
export async function listEvents(
  ctx: TenantContext,
  serverId: string,
  opts: ListEventsOptions = {},
) {
  const conditions = [
    eq(unifiedEvents.tenantId, ctx.tenantId),
    eq(unifiedEvents.serverId, serverId),
  ];

  if (opts.category) conditions.push(eq(unifiedEvents.category, opts.category));
  if (opts.severity)
    conditions.push(
      eq(unifiedEvents.severity, opts.severity as 'critical' | 'high' | 'medium' | 'low' | 'info'),
    );
  if (opts.agentId) conditions.push(eq(unifiedEvents.agentId, opts.agentId));
  if (opts.correlationId) conditions.push(eq(unifiedEvents.correlationId, opts.correlationId));
  if (opts.since) conditions.push(gte(unifiedEvents.occurredAt, opts.since));
  if (opts.until) conditions.push(lte(unifiedEvents.occurredAt, opts.until));

  const limit = Math.min(opts.limit ?? 100, 1000);

  return ctx.db
    .select()
    .from(unifiedEvents)
    .where(and(...conditions))
    .orderBy(desc(unifiedEvents.occurredAt))
    .limit(limit)
    .offset(opts.offset ?? 0);
}

/**
 * Get a single event by its hub-local ID.
 */
export async function getEvent(ctx: TenantContext, eventId: number) {
  const rows = await ctx.db
    .select()
    .from(unifiedEvents)
    .where(and(eq(unifiedEvents.tenantId, ctx.tenantId), eq(unifiedEvents.id, eventId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Aggregate event counts by category and severity.
 */
export async function eventsSummary(
  ctx: TenantContext,
  serverId: string,
  opts?: { since?: number },
) {
  const conditions = [
    eq(unifiedEvents.tenantId, ctx.tenantId),
    eq(unifiedEvents.serverId, serverId),
  ];
  if (opts?.since) conditions.push(gte(unifiedEvents.occurredAt, opts.since));

  const where = and(...conditions);

  const byCategoryRows = await ctx.db
    .select({
      category: unifiedEvents.category,
      count: sql<number>`count(*)`.as('count'),
    })
    .from(unifiedEvents)
    .where(where)
    .groupBy(unifiedEvents.category);

  const bySeverityRows = await ctx.db
    .select({
      severity: unifiedEvents.severity,
      count: sql<number>`count(*)`.as('count'),
    })
    .from(unifiedEvents)
    .where(where)
    .groupBy(unifiedEvents.severity);

  const total = byCategoryRows.reduce((sum, r) => sum + r.count, 0);
  const byCategory = Object.fromEntries(byCategoryRows.map((r) => [r.category, r.count]));
  const bySeverity = Object.fromEntries(bySeverityRows.map((r) => [r.severity, r.count]));

  return { total, byCategory, bySeverity };
}
