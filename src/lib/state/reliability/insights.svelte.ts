/** Owner-fenced historical reliability insights over the Hub HTTP API. */
import { createAsyncResource } from '../async.svelte';
import type {
  InsightsResult,
  ProposedAction,
  DetectorKind,
} from '$server/services/insights.service';
import { finite, integer, record, rows, string } from './decode-primitives';
import { fetchReliabilityJson } from './http-read';
import { createReadFailureMonitor } from './read-monitor';
import type { ReliabilityHttpOwner } from './view-owner';

export type {
  InsightsResult,
  ProposedAction,
  DetectorKind,
} from '$server/services/insights.service';

const DETECTORS = new Set<DetectorKind>([
  'noise_source',
  'recurring_failure',
  'health_regression',
  'cost_outlier',
  'reconnect_storm',
]);

function ratio(raw: unknown): number {
  const value = finite(raw);
  if (value < 0) throw new Error('Invalid reliability ratio');
  return value;
}

function decodeAction(raw: unknown): ProposedAction {
  const value = record(raw);
  const detector = string(value.detector) as DetectorKind;
  if (!DETECTORS.has(detector)) throw new Error('Invalid insight detector');
  const severity = string(value.severity);
  if (severity !== 'critical' && severity !== 'warning' && severity !== 'info') {
    throw new Error('Invalid insight severity');
  }
  let metricRef: ProposedAction['metricRef'];
  if (value.metricRef !== undefined) {
    const metric = record(value.metricRef);
    metricRef = {
      ...(metric.event === undefined ? {} : { event: string(metric.event) }),
      ...(metric.category === undefined ? {} : { category: string(metric.category) }),
      ...(metric.agentId === undefined ? {} : { agentId: string(metric.agentId) }),
    };
  }
  return {
    id: string(value.id),
    detector,
    severity,
    title: string(value.title, 16_384),
    evidence: string(value.evidence, 16_384),
    suggestedFix: string(value.suggestedFix, 16_384),
    ...(metricRef ? { metricRef } : {}),
    generatedAt: integer(value.generatedAt),
  };
}

export function decodeInsightsResult(
  raw: unknown,
  expected: { from: number; to: number },
): InsightsResult {
  const value = record(raw);
  const window = record(value.window);
  const from = integer(window.from);
  const to = integer(window.to);
  if (from !== expected.from || to !== expected.to || from > to) {
    throw new Error('Invalid insights window');
  }
  const signalToNoise = record(value.signalToNoise);
  const total = integer(signalToNoise.total);
  const signal = integer(signalToNoise.signal);
  const noise = integer(signalToNoise.noise);
  const noisePct = ratio(signalToNoise.noisePct);
  if (signal + noise !== total || noisePct > 1) throw new Error('Invalid insight totals');

  const proposedActions = rows(value.proposedActions, decodeAction, 2000);
  if (new Set(proposedActions.map((action) => action.id)).size !== proposedActions.length) {
    throw new Error('Duplicate insight action');
  }

  return {
    window: { from, to },
    signalToNoise: { total, signal, noise, noisePct },
    noiseTrend: rows(
      value.noiseTrend,
      (rawRow) => {
        const row = record(rawRow);
        const rowTotal = integer(row.total);
        const rowNoise = integer(row.noise);
        const rowSignal = integer(row.signal);
        if (rowNoise + rowSignal !== rowTotal) throw new Error('Invalid insight trend total');
        return { bucket: string(row.bucket), total: rowTotal, noise: rowNoise, signal: rowSignal };
      },
      5000,
    ),
    categoryVolume: rows(
      value.categoryVolume,
      (rawRow) => {
        const row = record(rawRow);
        const pct = ratio(row.pct);
        if (pct > 1) throw new Error('Invalid category percentage');
        return { category: string(row.category), n: integer(row.n), pct };
      },
      2000,
    ),
    topClusters: rows(
      value.topClusters,
      (rawRow) => {
        const row = record(rawRow);
        return {
          event: string(row.event),
          msgKey: string(row.msgKey, 16_384),
          severity: string(row.severity),
          n: integer(row.n),
          prevN: integer(row.prevN),
          deltaPct: row.deltaPct === null ? null : finite(row.deltaPct),
        };
      },
      2000,
    ),
    healthRegressions: rows(
      value.healthRegressions,
      (rawRow) => {
        const row = record(rawRow);
        return {
          category: string(row.category),
          current: ratio(row.current),
          baseline: ratio(row.baseline),
          ratio: ratio(row.ratio),
        };
      },
      2000,
    ),
    costOutliers: rows(
      value.costOutliers,
      (rawRow) => {
        const row = record(rawRow);
        return {
          agentId: string(row.agentId),
          tokens: integer(row.tokens),
          baseline: integer(row.baseline),
          ratio: ratio(row.ratio),
        };
      },
      2000,
    ),
    reconnectStorms: rows(
      value.reconnectStorms,
      (rawRow) => {
        const row = record(rawRow);
        return { hourBucket: string(row.hourBucket), n: integer(row.n) };
      },
      5000,
    ),
    proposedActions,
    generatedAt: integer(value.generatedAt),
  };
}

export function createInsightsState(owner: () => ReliabilityHttpOwner | null) {
  const monitor = createReadFailureMonitor('insights');
  let controller: AbortController | null = null;
  let last: [string, number, number] | null = null;
  const resource = createAsyncResource<
    InsightsResult,
    [ReliabilityHttpOwner | null, string, number, number, AbortSignal]
  >(
    async (captured, serverId, from, to, signal) => {
      if (!captured) throw new Error('Insights unavailable');
      let phase: 'transport' | 'decode' = 'transport';
      try {
        const params = new URLSearchParams({ serverId, from: String(from), to: String(to) });
        const raw = await fetchReliabilityJson(`/api/reliability/insights?${params}`, signal);
        phase = 'decode';
        const envelope = record(raw);
        const insights = decodeInsightsResult(envelope.insights, { from, to });
        return insights;
      } catch (error) {
        if (captured.current()) monitor.failed(captured.token, phase);
        throw error;
      }
    },
    {
      initialLoading: true,
      formatError: () => 'Insights could not be refreshed.',
      owner: (captured) => captured,
      key: (_captured, serverId, from, to) => JSON.stringify([serverId, from, to]),
      beforePublish: (_insights, captured) => captured && monitor.ready(),
    },
  );

  async function load(serverId: string, from: number, to: number): Promise<void> {
    last = [serverId, from, to];
    controller?.abort();
    controller = new AbortController();
    await resource.load(owner(), serverId, from, to, controller.signal);
  }
  function reset(): void {
    controller?.abort();
    controller = null;
    resource.reset();
  }
  return {
    get snapshot() {
      return resource.data;
    },
    get loading() {
      return resource.loading;
    },
    get error() {
      return resource.error;
    },
    get status() {
      return resource.status;
    },
    load,
    retry: () => (last ? load(...last) : Promise.resolve()),
    reset,
  };
}
