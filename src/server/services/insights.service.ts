/**
 * Reliability INSIGHTS — derives actionable signal from the raw `unified_events`
 * telemetry corpus (215k+ rows, ~99.7% info/low noise). Read-only aggregates over
 * the hub-owned Turso copy (same table events.service.ts writes/reads), following
 * the /api/metrics/connection-events precedent: no gateway RPC, no redeploy.
 *
 * The point of this service is the user's stated goal — "we hold a lot of data
 * points but no action": turn the corpus into a small set of ranked, evidence-
 * backed PROPOSED ACTIONS. v1 detectors are deterministic SQL+JS heuristics; the
 * ProposedAction shape is deliberately what a future log-reading agent would also
 * emit, so the UI feed doesn't change when a real agent replaces the heuristics.
 */
import { and, eq, gte, lte, lt, inArray, sql, desc } from 'drizzle-orm';
import { unifiedEvents } from '@minion-stack/db/schema';
import type { TenantContext } from './base';

const SIGNAL_SEVERITIES = ['high', 'critical'] as const;
const NOISE_SEVERITIES = ['info', 'low'] as const;

// Detector thresholds (named so they're tunable in one place).
const RECURRING_MIN = 10; // same failure ≥N times in the window → recurring
const NOISE_SOURCE_PCT = 0.15; // one event ≥15% of all volume → noise-source
const REGRESSION_RATIO = 1.5; // category error-rate ≥1.5× its baseline → regression
const REGRESSION_MIN_EVENTS = 50; // ignore tiny-sample categories
const COST_MULT = 3; // agent's peak day ≥ 3× its median day → cost outlier
const COST_FLOOR = 50_000; // …and the peak is ≥ this many tokens (ignore trivial spikes)
const RECONNECT_PER_HR = 20; // channel disconnects/hr above this → reconnect storm
const MS_DAY = 86_400_000;

export type DetectorKind =
  | 'noise_source'
  | 'recurring_failure'
  | 'health_regression'
  | 'cost_outlier'
  | 'reconnect_storm';

export interface ProposedAction {
  /** Stable id (detector + key) so localStorage accept/dismiss survives reload. */
  id: string;
  detector: DetectorKind;
  /** status-token ramp, NOT accent — 'critical'|'warning'|'info'. */
  severity: 'critical' | 'warning' | 'info';
  title: string;
  evidence: string;
  suggestedFix: string;
  metricRef?: { event?: string; category?: string; agentId?: string };
  generatedAt: number;
}

export interface InsightsResult {
  window: { from: number; to: number };
  signalToNoise: { total: number; signal: number; noise: number; noisePct: number };
  noiseTrend: { bucket: string; total: number; noise: number; signal: number }[];
  categoryVolume: { category: string; n: number; pct: number }[];
  topClusters: {
    event: string;
    msgKey: string;
    severity: string;
    n: number;
    prevN: number;
    deltaPct: number | null;
  }[];
  healthRegressions: { category: string; current: number; baseline: number; ratio: number }[];
  costOutliers: { agentId: string; tokens: number; baseline: number; ratio: number }[];
  reconnectStorms: { hourBucket: string; n: number }[];
  proposedActions: ProposedAction[];
  generatedAt: number;
}

// ── Pure math (unit-tested without a DB) ───────────────────────────────────

/** Median of a numeric series (robust centre for heavy-tailed token/cost data). */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Percent change prev→cur; null when prev is 0 (no baseline to compare). */
export function deltaPct(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

/**
 * Per-agent daily-token outliers. Token spend is heavy-tailed and multiplicative,
 * and with only ~1–2 weeks of daily points a z-score against population σ can't
 * exceed ~√(n−1) — a 3σ gate is literally unreachable for a young agent. So this
 * uses a robust MEDIAN-MULTIPLE: flag an agent's peak day when it's ≥`mult`× its
 * own median day AND above an absolute floor (ignore trivial spikes). Needs ≥3
 * days so the median means something.
 */
export function costOutliers(
  perAgentDaily: { agentId: string; day: string; tokens: number }[],
  mult = COST_MULT,
  floor = COST_FLOOR,
): InsightsResult['costOutliers'] {
  const byAgent = new Map<string, { day: string; tokens: number }[]>();
  for (const r of perAgentDaily) {
    if (!r.agentId) continue;
    let arr = byAgent.get(r.agentId);
    if (!arr) {
      arr = [];
      byAgent.set(r.agentId, arr);
    }
    arr.push(r);
  }
  const out: InsightsResult['costOutliers'] = [];
  for (const [agentId, days] of byAgent) {
    if (days.length < 3) continue;
    const med = median(days.map((d) => d.tokens));
    if (med <= 0) continue;
    const peak = days.reduce((m, d) => (d.tokens > m.tokens ? d : m));
    const ratio = peak.tokens / med;
    if (ratio >= mult && peak.tokens >= floor) {
      out.push({ agentId, tokens: peak.tokens, baseline: Math.round(med), ratio });
    }
  }
  return out.sort((a, b) => b.ratio - a.ratio);
}

// ── Orchestration ──────────────────────────────────────────────────────────

export async function computeInsights(
  ctx: TenantContext,
  serverId: string,
  window: { from: number; to: number },
): Promise<InsightsResult> {
  const { from, to } = window;
  const scope = and(
    eq(unifiedEvents.tenantId, ctx.tenantId),
    eq(unifiedEvents.serverId, serverId),
    gte(unifiedEvents.occurredAt, from),
    lte(unifiedEvents.occurredAt, to),
  );

  const hourBucket = sql<string>`strftime('%Y-%m-%dT%H:00', ${unifiedEvents.occurredAt} / 1000, 'unixepoch')`;
  const msgKey = sql<string>`substr(${unifiedEvents.message}, 1, 80)`;
  const dayBucket = sql<string>`date(${unifiedEvents.occurredAt} / 1000, 'unixepoch')`;
  const tokenSum = sql<number>`sum(cast(json_extract(${unifiedEvents.metadata}, '$.tokens.total') as integer))`;

  // Regression looks at a fixed recent-24h vs prior-7d, independent of the picker.
  const cur24From = to - MS_DAY;
  const base7From = to - 8 * MS_DAY;

  const [
    breakdown,
    trend,
    clustersCur,
    clustersPrev,
    regCurRows,
    regBaseRows,
    costRows,
    reconnectRows,
  ] = await Promise.all([
    // 1. event × severity × category breakdown (drives S/N, categoryVolume, noise_source)
    ctx.db
      .select({
        event: unifiedEvents.event,
        category: unifiedEvents.category,
        severity: unifiedEvents.severity,
        n: sql<number>`count(*)`,
      })
      .from(unifiedEvents)
      .where(scope)
      .groupBy(unifiedEvents.event, unifiedEvents.category, unifiedEvents.severity),
    // 2. hourly noise/signal trend
    ctx.db
      .select({
        bucket: hourBucket,
        total: sql<number>`count(*)`,
        noise: sql<number>`sum(case when ${unifiedEvents.severity} in ('info','low') then 1 else 0 end)`,
      })
      .from(unifiedEvents)
      .where(scope)
      .groupBy(hourBucket)
      .orderBy(hourBucket),
    // 3. top signal clusters (current window)
    ctx.db
      .select({ event: unifiedEvents.event, msgKey, severity: unifiedEvents.severity, n: sql<number>`count(*)` })
      .from(unifiedEvents)
      .where(and(scope, inArray(unifiedEvents.severity, [...SIGNAL_SEVERITIES])))
      .groupBy(unifiedEvents.event, msgKey, unifiedEvents.severity)
      .orderBy(desc(sql`count(*)`))
      .limit(20),
    // 4. same clusters over the immediately-prior window of equal width (for trend arrows)
    ctx.db
      .select({ event: unifiedEvents.event, msgKey, n: sql<number>`count(*)` })
      .from(unifiedEvents)
      .where(
        and(
          eq(unifiedEvents.tenantId, ctx.tenantId),
          eq(unifiedEvents.serverId, serverId),
          gte(unifiedEvents.occurredAt, from - (to - from)),
          lt(unifiedEvents.occurredAt, from),
          inArray(unifiedEvents.severity, [...SIGNAL_SEVERITIES]),
        ),
      )
      .groupBy(unifiedEvents.event, msgKey),
    // 5. health regression — recent 24h per-category error rate
    ctx.db
      .select({
        category: unifiedEvents.category,
        total: sql<number>`count(*)`,
        errors: sql<number>`sum(case when ${unifiedEvents.severity} in ('high','critical') then 1 else 0 end)`,
      })
      .from(unifiedEvents)
      .where(
        and(
          eq(unifiedEvents.tenantId, ctx.tenantId),
          eq(unifiedEvents.serverId, serverId),
          gte(unifiedEvents.occurredAt, cur24From),
          lte(unifiedEvents.occurredAt, to),
        ),
      )
      .groupBy(unifiedEvents.category),
    // 6. health regression — prior-7d baseline per-category error rate
    ctx.db
      .select({
        category: unifiedEvents.category,
        total: sql<number>`count(*)`,
        errors: sql<number>`sum(case when ${unifiedEvents.severity} in ('high','critical') then 1 else 0 end)`,
      })
      .from(unifiedEvents)
      .where(
        and(
          eq(unifiedEvents.tenantId, ctx.tenantId),
          eq(unifiedEvents.serverId, serverId),
          gte(unifiedEvents.occurredAt, base7From),
          lt(unifiedEvents.occurredAt, cur24From),
        ),
      )
      .groupBy(unifiedEvents.category),
    // 7. per-agent per-day token sums (cost outlier proxy — real $ lives gateway-side)
    ctx.db
      .select({ agentId: unifiedEvents.agentId, day: dayBucket, tokens: tokenSum })
      .from(unifiedEvents)
      .where(and(scope, eq(unifiedEvents.event, 'agent.llm.usage')))
      .groupBy(unifiedEvents.agentId, dayBucket),
    // 8. channel reconnect storms — disconnects/hr above bar
    ctx.db
      .select({ hourBucket, n: sql<number>`count(*)` })
      .from(unifiedEvents)
      .where(and(scope, eq(unifiedEvents.event, 'channel.disconnected')))
      .groupBy(hourBucket)
      .having(sql`count(*) > ${RECONNECT_PER_HR}`)
      .orderBy(desc(sql`count(*)`)),
  ]);

  const generatedAt = Date.now();

  // ── S/N + category volume + noise-source ────────────────────────────────
  const total = breakdown.reduce((s, r) => s + r.n, 0);
  const noise = breakdown
    .filter((r) => (NOISE_SEVERITIES as readonly string[]).includes(r.severity))
    .reduce((s, r) => s + r.n, 0);
  const signal = total - noise;

  const catMap = new Map<string, number>();
  const evMap = new Map<string, { category: string; severity: string; n: number }>();
  for (const r of breakdown) {
    catMap.set(r.category, (catMap.get(r.category) ?? 0) + r.n);
    const prev = evMap.get(r.event);
    // an event can span severities; keep the dominant severity + summed count
    if (!prev || r.n > prev.n) evMap.set(r.event, { category: r.category, severity: r.severity, n: (prev?.n ?? 0) + r.n });
    else evMap.set(r.event, { ...prev, n: prev.n + r.n });
  }
  const categoryVolume = [...catMap.entries()]
    .map(([category, n]) => ({ category, n, pct: total ? n / total : 0 }))
    .sort((a, b) => b.n - a.n);

  // ── clusters with trend ─────────────────────────────────────────────────
  const prevMap = new Map(clustersPrev.map((r) => [`${r.event}|${r.msgKey}`, r.n]));
  const topClusters = clustersCur.map((r) => {
    const prevN = prevMap.get(`${r.event}|${r.msgKey}`) ?? 0;
    return { event: r.event, msgKey: r.msgKey, severity: r.severity, n: r.n, prevN, deltaPct: deltaPct(r.n, prevN) };
  });

  // ── health regressions ──────────────────────────────────────────────────
  const baseRate = new Map(
    regBaseRows.map((r) => [r.category, r.total ? r.errors / r.total : 0]),
  );
  const healthRegressions = regCurRows
    .filter((r) => r.total >= REGRESSION_MIN_EVENTS)
    .map((r) => {
      const current = r.total ? r.errors / r.total : 0;
      const baseline = baseRate.get(r.category) ?? 0;
      return { category: r.category, current, baseline, ratio: baseline ? current / baseline : current > 0 ? Infinity : 0 };
    })
    .filter((r) => r.ratio >= REGRESSION_RATIO && r.current > 0)
    .sort((a, b) => b.ratio - a.ratio);

  // ── cost outliers ───────────────────────────────────────────────────────
  const costs = costOutliers(
    costRows.map((r) => ({ agentId: r.agentId ?? '', day: r.day, tokens: Number(r.tokens ?? 0) })),
  );

  const reconnectStorms = reconnectRows.map((r) => ({ hourBucket: r.hourBucket, n: r.n }));

  // ── assemble ranked proposed actions ────────────────────────────────────
  const proposedActions = assembleActions(
    { total, noise, signal },
    [...evMap.entries()].map(([event, v]) => ({ event, ...v })),
    topClusters,
    healthRegressions,
    costs,
    reconnectStorms,
    generatedAt,
  );

  return {
    window,
    signalToNoise: { total, signal, noise, noisePct: total ? noise / total : 0 },
    noiseTrend: trend.map((r) => ({ bucket: r.bucket, total: r.total, noise: r.noise, signal: r.total - r.noise })),
    categoryVolume,
    topClusters,
    healthRegressions,
    costOutliers: costs,
    reconnectStorms,
    proposedActions,
    generatedAt,
  };
}

const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;
const fmtN = (x: number) => new Intl.NumberFormat('en-US').format(Math.round(x));

/**
 * Turn the raw aggregates into a ranked ProposedAction[]. Pure — the DB layer
 * hands it plain arrays, so it's unit-testable and mirrors what an agent emits.
 */
export function assembleActions(
  sn: { total: number; noise: number; signal: number },
  events: { event: string; category: string; severity: string; n: number }[],
  clusters: InsightsResult['topClusters'],
  regressions: InsightsResult['healthRegressions'],
  costs: InsightsResult['costOutliers'],
  storms: InsightsResult['reconnectStorms'],
  generatedAt: number,
): ProposedAction[] {
  const actions: ProposedAction[] = [];
  const SEV_RANK = { critical: 0, warning: 1, info: 2 } as const;

  // noise_source — a single event dominates the corpus and isn't actionable signal
  for (const e of events) {
    const share = sn.total ? e.n / sn.total : 0;
    if (share >= NOISE_SOURCE_PCT && (NOISE_SEVERITIES as readonly string[]).includes(e.severity)) {
      actions.push({
        id: `noise_source:${e.event}`,
        detector: 'noise_source',
        severity: 'info',
        title: `${e.event} is ${pct1(share)} of all telemetry`,
        evidence: `${fmtN(e.n)} of ${fmtN(sn.total)} events, severity “${e.severity}”.`,
        suggestedFix: `Reduce this event's cadence, sample it, or downgrade its severity — it's high-volume, low-signal and drowns actionable events. (Gateway emit site for "${e.event}".)`,
        metricRef: { event: e.event, category: e.category },
        generatedAt,
      });
    }
  }

  // recurring_failure — the same signal cluster fires many times
  for (const c of clusters) {
    if (c.n >= RECURRING_MIN) {
      const trend = c.deltaPct == null ? 'new this window' : c.deltaPct >= 0 ? `up ${c.deltaPct}% vs prior window` : `down ${-c.deltaPct}% vs prior window`;
      actions.push({
        id: `recurring_failure:${c.event}:${c.msgKey}`,
        detector: 'recurring_failure',
        severity: c.severity === 'critical' ? 'critical' : 'warning',
        title: `${c.event} recurring ${fmtN(c.n)}×`,
        evidence: `“${c.msgKey.trim()}” — ${fmtN(c.n)} occurrences (${trend}).`,
        suggestedFix: `Investigate ${c.event}: a repeated ${c.severity} failure usually points at a config/credential/upstream issue. Check recent changes touching this path.`,
        metricRef: { event: c.event },
        generatedAt,
      });
    }
  }

  // health_regression — a category's error rate jumped vs its 7-day baseline
  for (const r of regressions) {
    actions.push({
      id: `health_regression:${r.category}`,
      detector: 'health_regression',
      severity: r.ratio >= 3 ? 'critical' : 'warning',
      title: `${r.category} error rate regressed`,
      evidence: `${pct1(r.current)} in the last 24h vs ${pct1(r.baseline)} 7-day baseline (${r.ratio === Infinity ? 'new' : `${r.ratio.toFixed(1)}×`}).`,
      suggestedFix: `Review recent changes affecting the “${r.category}” subsystem — its failure rate is materially above its own baseline.`,
      metricRef: { category: r.category },
      generatedAt,
    });
  }

  // cost_outlier — an agent's daily token burn is a statistical outlier
  for (const c of costs) {
    actions.push({
      id: `cost_outlier:${c.agentId}`,
      detector: 'cost_outlier',
      severity: 'warning',
      title: `${c.agentId} token usage is an outlier`,
      evidence: `Peak day ${fmtN(c.tokens)} tokens vs its ${fmtN(c.baseline)} median day (${c.ratio.toFixed(1)}×).`,
      suggestedFix: `Review ${c.agentId}'s recent runs for a prompt loop or oversized context — its spend is far above its typical pattern.`,
      metricRef: { agentId: c.agentId },
      generatedAt,
    });
  }

  // reconnect_storm — a channel is flapping
  if (storms.length) {
    const worst = storms[0];
    actions.push({
      id: `reconnect_storm:${worst.hourBucket}`,
      detector: 'reconnect_storm',
      severity: 'warning',
      title: `Channel reconnect storm`,
      evidence: `${fmtN(worst.n)} channel disconnects in one hour (${storms.length} hour(s) over ${RECONNECT_PER_HR}/hr).`,
      suggestedFix: `A channel is flapping — check its credentials or the upstream provider's status. Persistent reconnects waste quota and bury real errors.`,
      metricRef: { category: 'channel' },
      generatedAt,
    });
  }

  return actions.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
}
