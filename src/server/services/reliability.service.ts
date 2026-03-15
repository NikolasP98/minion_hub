import { eq, and, desc, gte, lte, lt, sql } from 'drizzle-orm';
import { reliabilityEvents } from '$server/db/schema';
import { nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

export interface ReliabilityEventInput {
  serverId: string;
  agentId?: string;
  category: 'cron' | 'browser' | 'timezone' | 'general' | 'auth' | 'skill' | 'agent' | 'gateway';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'ok';
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
    conditions.push(eq(reliabilityEvents.severity, filters.severity as 'critical' | 'high' | 'medium' | 'low' | 'ok'));
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

  // ── Single-scan KPI query: total + byCategory + bySeverity ──────────────
  const [kpi] = await ctx.db
    .select({
      total: sql<number>`count(*)`,
      // Category counts
      cat_cron: sql<number>`sum(case when ${reliabilityEvents.category}='cron' then 1 else 0 end)`,
      cat_browser: sql<number>`sum(case when ${reliabilityEvents.category}='browser' then 1 else 0 end)`,
      cat_timezone: sql<number>`sum(case when ${reliabilityEvents.category}='timezone' then 1 else 0 end)`,
      cat_general: sql<number>`sum(case when ${reliabilityEvents.category}='general' then 1 else 0 end)`,
      cat_auth: sql<number>`sum(case when ${reliabilityEvents.category}='auth' then 1 else 0 end)`,
      cat_skill: sql<number>`sum(case when ${reliabilityEvents.category}='skill' then 1 else 0 end)`,
      cat_agent: sql<number>`sum(case when ${reliabilityEvents.category}='agent' then 1 else 0 end)`,
      cat_gateway: sql<number>`sum(case when ${reliabilityEvents.category}='gateway' then 1 else 0 end)`,
      // Severity counts
      sev_critical: sql<number>`sum(case when ${reliabilityEvents.severity}='critical' then 1 else 0 end)`,
      sev_high: sql<number>`sum(case when ${reliabilityEvents.severity}='high' then 1 else 0 end)`,
      sev_medium: sql<number>`sum(case when ${reliabilityEvents.severity}='medium' then 1 else 0 end)`,
      sev_low: sql<number>`sum(case when ${reliabilityEvents.severity}='low' then 1 else 0 end)`,
      sev_ok: sql<number>`sum(case when ${reliabilityEvents.severity}='ok' then 1 else 0 end)`,
    })
    .from(reliabilityEvents)
    .where(where);

  const total = Number(kpi.total) || 0;
  const byCategory: Record<string, number> = {};
  for (const cat of ['cron', 'browser', 'timezone', 'general', 'auth', 'skill', 'agent', 'gateway'] as const) {
    const v = Number(kpi[`cat_${cat}` as keyof typeof kpi]) || 0;
    if (v > 0) byCategory[cat] = v;
  }
  const bySeverity: Record<string, number> = {};
  for (const sev of ['critical', 'high', 'medium', 'low', 'ok'] as const) {
    const v = Number(kpi[`sev_${sev}` as keyof typeof kpi]) || 0;
    if (v > 0) bySeverity[sev] = v;
  }

  // ── Top events (separate query — needs GROUP BY + ORDER BY + LIMIT) ─────
  const topEventsRows = await ctx.db
    .select({
      event: reliabilityEvents.event,
      count: sql<number>`count(*)`.as('count'),
    })
    .from(reliabilityEvents)
    .where(where)
    .groupBy(reliabilityEvents.event)
    .orderBy(sql`count(*) desc`)
    .limit(20);

  // ── Timeseries (separate query — different GROUP BY dimensions) ─────────
  const from = filters.from ?? Date.now() - 7 * 86400000;
  const to = filters.to ?? Date.now();
  const rangeMs = to - from;
  const bucketMs = rangeMs <= 7 * 86400000 ? 3600000 : 86400000;

  const timeseriesRows = await ctx.db
    .select({
      bucket: sql<number>`(${reliabilityEvents.occurredAt} / ${bucketMs}) * ${bucketMs}`.as('bucket'),
      category: reliabilityEvents.category,
      severity: reliabilityEvents.severity,
      count: sql<number>`count(*)`.as('count'),
    })
    .from(reliabilityEvents)
    .where(where)
    .groupBy(sql`bucket`, reliabilityEvents.category, reliabilityEvents.severity)
    .orderBy(sql`bucket`);

  return {
    total,
    byCategory,
    bySeverity,
    topEvents: topEventsRows.map((r) => ({ event: r.event, count: r.count })),
    timeseries: timeseriesRows.map((r) => ({
      bucket: r.bucket,
      category: r.category,
      severity: r.severity,
      count: r.count,
    })),
    bucketMs,
  };
}

const PRUNE_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function pruneOldReliabilityEvents(
  ctx: TenantContext,
  maxAgeDays = 30,
): Promise<number> {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const result = await ctx.db
    .delete(reliabilityEvents)
    .where(
      and(
        eq(reliabilityEvents.tenantId, ctx.tenantId),
        lt(reliabilityEvents.occurredAt, cutoff),
      ),
    );
  return (result as any).rowsAffected ?? 0;
}
