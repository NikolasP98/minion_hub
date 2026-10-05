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
  'noise_source' | 'recurring_failure' | 'health_regression' | 'cost_outlier' | 'reconnect_storm';

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

export interface InsightEventRow {
  event: string;
  category: string;
  severity: string;
  message: string;
  occurredAt: number;
  agentId: string | null;
  tokens: number | null;
}

export interface InsightMaterializedWindows {
  current: readonly InsightEventRow[];
  prior: readonly InsightEventRow[];
  fixed: readonly InsightEventRow[];
}

function hourBucket(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 13) + ':00';
}

function dayBucket(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** Compute every metric from three already-admitted relations in one database snapshot. */
export function computeInsightsFromRows(
  rows: InsightMaterializedWindows,
  window: { from: number; to: number },
  generatedAt = Date.now(),
): InsightsResult {
  const breakdownMap = new Map<
    string,
    { event: string; category: string; severity: string; n: number }
  >();
  const trendMap = new Map<string, { total: number; noise: number }>();
  const currentClusters = new Map<
    string,
    { event: string; msgKey: string; severity: string; n: number }
  >();
  const priorClusters = new Map<string, number>();
  const perAgentDay = new Map<string, { agentId: string; day: string; tokens: number }>();
  const reconnects = new Map<string, number>();

  for (const row of rows.current) {
    const breakdownKey = JSON.stringify([row.event, row.category, row.severity]);
    const breakdown = breakdownMap.get(breakdownKey) ?? { ...row, n: 0 };
    breakdown.n++;
    breakdownMap.set(breakdownKey, breakdown);

    const bucket = hourBucket(row.occurredAt);
    const trend = trendMap.get(bucket) ?? { total: 0, noise: 0 };
    trend.total++;
    if ((NOISE_SEVERITIES as readonly string[]).includes(row.severity)) trend.noise++;
    trendMap.set(bucket, trend);

    if ((SIGNAL_SEVERITIES as readonly string[]).includes(row.severity)) {
      const msgKey = row.message.slice(0, 80);
      const key = JSON.stringify([row.event, msgKey]);
      const cluster = currentClusters.get(key) ?? {
        event: row.event,
        msgKey,
        severity: row.severity,
        n: 0,
      };
      cluster.n++;
      currentClusters.set(key, cluster);
    }

    if (row.event === 'agent.llm.usage' && row.agentId && row.tokens !== null) {
      const day = dayBucket(row.occurredAt);
      const key = JSON.stringify([row.agentId, day]);
      const aggregate = perAgentDay.get(key) ?? { agentId: row.agentId, day, tokens: 0 };
      aggregate.tokens += row.tokens;
      perAgentDay.set(key, aggregate);
    }
    if (row.event === 'channel.disconnected') {
      reconnects.set(bucket, (reconnects.get(bucket) ?? 0) + 1);
    }
  }

  for (const row of rows.prior) {
    if (!(SIGNAL_SEVERITIES as readonly string[]).includes(row.severity)) continue;
    const key = JSON.stringify([row.event, row.message.slice(0, 80)]);
    priorClusters.set(key, (priorClusters.get(key) ?? 0) + 1);
  }

  const fixedCurrentFrom = window.to - MS_DAY;
  const fixedBaselineFrom = window.to - 8 * MS_DAY;
  const regressionCurrent = new Map<string, { total: number; errors: number }>();
  const regressionBaseline = new Map<string, { total: number; errors: number }>();
  for (const row of rows.fixed) {
    const target = row.occurredAt >= fixedCurrentFrom ? regressionCurrent : regressionBaseline;
    if (row.occurredAt < fixedBaselineFrom || row.occurredAt > window.to) continue;
    const aggregate = target.get(row.category) ?? { total: 0, errors: 0 };
    aggregate.total++;
    if ((SIGNAL_SEVERITIES as readonly string[]).includes(row.severity)) aggregate.errors++;
    target.set(row.category, aggregate);
  }

  const breakdown = [...breakdownMap.values()];
  const total = rows.current.length;
  const noise = breakdown
    .filter((row) => (NOISE_SEVERITIES as readonly string[]).includes(row.severity))
    .reduce((sum, row) => sum + row.n, 0);
  const signal = total - noise;

  const categoryCounts = new Map<string, number>();
  const eventCounts = new Map<string, { category: string; severity: string; n: number }>();
  for (const row of breakdown) {
    categoryCounts.set(row.category, (categoryCounts.get(row.category) ?? 0) + row.n);
    const previous = eventCounts.get(row.event);
    if (!previous || row.n > previous.n) {
      eventCounts.set(row.event, {
        category: row.category,
        severity: row.severity,
        n: (previous?.n ?? 0) + row.n,
      });
    } else {
      eventCounts.set(row.event, { ...previous, n: previous.n + row.n });
    }
  }
  const categoryVolume = [...categoryCounts]
    .map(([category, n]) => ({ category, n, pct: total ? n / total : 0 }))
    .sort((a, b) => b.n - a.n || a.category.localeCompare(b.category));
  if (categoryVolume.length > 2000) throw new Error('Reliability entity cap exceeded');

  const noiseTrend = [...trendMap]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, value]) => ({
      bucket,
      total: value.total,
      noise: value.noise,
      signal: value.total - value.noise,
    }));
  if (noiseTrend.length > 5000) throw new Error('Reliability series cap exceeded');

  const topClusters = [...currentClusters]
    .sort(([, a], [, b]) => b.n - a.n || a.event.localeCompare(b.event))
    .slice(0, 20)
    .map(([key, row]) => {
      const prevN = priorClusters.get(key) ?? 0;
      return { ...row, prevN, deltaPct: deltaPct(row.n, prevN) };
    });

  const healthRegressions = [...regressionCurrent]
    .filter(([, row]) => row.total >= REGRESSION_MIN_EVENTS)
    .flatMap(([category, currentRow]) => {
      const baselineRow = regressionBaseline.get(category);
      const current = currentRow.errors / currentRow.total;
      const baseline = baselineRow?.total ? baselineRow.errors / baselineRow.total : 0;
      if (baseline <= 0) return [];
      return [{ category, current, baseline, ratio: current / baseline }];
    })
    .filter((row) => row.ratio >= REGRESSION_RATIO && row.current > 0)
    .sort((a, b) => b.ratio - a.ratio || a.category.localeCompare(b.category));
  if (healthRegressions.length > 2000) throw new Error('Reliability entity cap exceeded');

  const costs = costOutliers([...perAgentDay.values()]);
  if (costs.length > 2000) throw new Error('Reliability entity cap exceeded');
  const reconnectStorms = [...reconnects]
    .filter(([, n]) => n > RECONNECT_PER_HR)
    .sort(([, a], [, b]) => b - a)
    .map(([bucket, n]) => ({ hourBucket: bucket, n }));
  if (reconnectStorms.length > 5000) throw new Error('Reliability series cap exceeded');

  const proposedActions = assembleActions(
    { total, noise, signal },
    [...eventCounts].map(([event, value]) => ({ event, ...value })),
    topClusters,
    healthRegressions,
    costs,
    reconnectStorms,
    generatedAt,
  );
  if (proposedActions.length > 2000) throw new Error('Reliability entity cap exceeded');

  return {
    window,
    signalToNoise: { total, signal, noise, noisePct: total ? noise / total : 0 },
    noiseTrend,
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
      const trend =
        c.deltaPct == null
          ? 'new this window'
          : c.deltaPct >= 0
            ? `up ${c.deltaPct}% vs prior window`
            : `down ${-c.deltaPct}% vs prior window`;
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
