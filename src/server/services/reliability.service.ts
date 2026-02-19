import { eq, and, desc, gte, lte, sql } from 'drizzle-orm';
import { reliabilityEvents } from '$server/db/schema';
import { nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

export interface ReliabilityEventInput {
  serverId: string;
  agentId?: string;
  category: 'cron' | 'browser' | 'timezone' | 'general' | 'auth' | 'skill' | 'agent' | 'gateway';
  severity: 'critical' | 'high' | 'medium' | 'low';
  event: string;
  message: string;
  metadata?: string;
  occurredAt: number;
}

export async function insertReliabilityEvents(
  ctx: TenantContext,
  events: ReliabilityEventInput[],
) {
  if (events.length === 0) return;
  const now = nowMs();
  await ctx.db.insert(reliabilityEvents).values(
    events.map((ev) => ({
      tenantId: ctx.tenantId,
      serverId: ev.serverId,
      agentId: ev.agentId ?? null,
      category: ev.category,
      severity: ev.severity,
      event: ev.event,
      message: ev.message,
      metadata: ev.metadata ?? null,
      occurredAt: ev.occurredAt,
      createdAt: now,
    })),
  );
}

export async function listReliabilityEvents(
  ctx: TenantContext,
  filters: {
    serverId?: string;
    category?: string;
    severity?: string;
    from?: number;
    to?: number;
    limit?: number;
    offset?: number;
  } = {},
) {
  const conditions = [eq(reliabilityEvents.tenantId, ctx.tenantId)];

  if (filters.serverId) conditions.push(eq(reliabilityEvents.serverId, filters.serverId));
  if (filters.category)
    conditions.push(eq(reliabilityEvents.category, filters.category as 'cron' | 'browser' | 'timezone' | 'general' | 'auth' | 'skill' | 'agent' | 'gateway'));
  if (filters.severity)
    conditions.push(eq(reliabilityEvents.severity, filters.severity as 'critical' | 'high' | 'medium' | 'low'));
  if (filters.from) conditions.push(gte(reliabilityEvents.occurredAt, filters.from));
  if (filters.to) conditions.push(lte(reliabilityEvents.occurredAt, filters.to));

  return ctx.db
    .select()
    .from(reliabilityEvents)
    .where(and(...conditions))
    .orderBy(desc(reliabilityEvents.occurredAt))
    .limit(filters.limit ?? 200)
    .offset(filters.offset ?? 0);
}

export async function getReliabilitySummary(
  ctx: TenantContext,
  filters: {
    serverId?: string;
    from?: number;
    to?: number;
  } = {},
) {
  const conditions = [eq(reliabilityEvents.tenantId, ctx.tenantId)];

  if (filters.serverId) conditions.push(eq(reliabilityEvents.serverId, filters.serverId));
  if (filters.from) conditions.push(gte(reliabilityEvents.occurredAt, filters.from));
  if (filters.to) conditions.push(lte(reliabilityEvents.occurredAt, filters.to));

  const where = and(...conditions);

  // Per-category counts
  const byCategoryRows = await ctx.db
    .select({
      category: reliabilityEvents.category,
      count: sql<number>`count(*)`.as('count'),
    })
    .from(reliabilityEvents)
    .where(where)
    .groupBy(reliabilityEvents.category);

  // Per-severity counts
  const bySeverityRows = await ctx.db
    .select({
      severity: reliabilityEvents.severity,
      count: sql<number>`count(*)`.as('count'),
    })
    .from(reliabilityEvents)
    .where(where)
    .groupBy(reliabilityEvents.severity);

  // Per-event counts (top events)
  const byEventRows = await ctx.db
    .select({
      event: reliabilityEvents.event,
      count: sql<number>`count(*)`.as('count'),
    })
    .from(reliabilityEvents)
    .where(where)
    .groupBy(reliabilityEvents.event)
    .orderBy(sql`count(*) desc`)
    .limit(20);

  // Time series — bucket by hour
  const from = filters.from ?? Date.now() - 7 * 86400000;
  const to = filters.to ?? Date.now();
  const rangeMs = to - from;
  // Use hourly buckets for ranges ≤7 days, daily for longer
  const bucketMs = rangeMs <= 7 * 86400000 ? 3600000 : 86400000;

  const timeseriesRows = await ctx.db
    .select({
      bucket: sql<number>`(${reliabilityEvents.occurredAt} / ${bucketMs}) * ${bucketMs}`.as('bucket'),
      category: reliabilityEvents.category,
      count: sql<number>`count(*)`.as('count'),
    })
    .from(reliabilityEvents)
    .where(where)
    .groupBy(sql`bucket`, reliabilityEvents.category)
    .orderBy(sql`bucket`);

  const total = byCategoryRows.reduce((sum, r) => sum + r.count, 0);
  const byCategory = Object.fromEntries(byCategoryRows.map((r) => [r.category, r.count]));
  const bySeverity = Object.fromEntries(bySeverityRows.map((r) => [r.severity, r.count]));
  const topEvents = byEventRows.map((r) => ({ event: r.event, count: r.count }));

  return {
    total,
    byCategory,
    bySeverity,
    topEvents,
    timeseries: timeseriesRows.map((r) => ({
      bucket: r.bucket,
      category: r.category,
      count: r.count,
    })),
    bucketMs,
  };
}
