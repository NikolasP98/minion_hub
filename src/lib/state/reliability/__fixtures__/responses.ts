/** Synthetic wire replies matching the Gateway's public reliability projections. */
export function reliabilityReply(method: string, n = 4): unknown {
  const totals = { input: n, output: n, cacheRead: 0, total: n * 2, calls: n, costMicroUsd: n };
  const snapshot = {
    ts: n,
    windowMs: 60_000,
    requests: n,
    throughputPerSec: n / 60,
    errorRate: 0,
    latencyMs: { p50: 1, p95: 2, p99: 3, max: 4 },
    slowestMethods: [],
    eventLoopDelayMs: { mean: 1, p50: 1, p99: 2, max: 3 },
  };
  switch (method) {
    case 'reliability.summary':
      return { total: n, byCategory: { tool: n }, bySeverity: { high: n } };
    case 'reliability.events':
      return {
        events: [
          {
            timestamp: n,
            category: 'tool',
            severity: 'high',
            event: 'tool.completed',
            message: 'Synthetic event',
          },
        ],
      };
    case 'reliability.timeline':
      return { buckets: [{ bucket: n, category: 'tool', count: n }], bucketMs: 1000 };
    case 'reliability.flow':
      return { rows: [{ event: 'tool.completed', category: 'tool', severity: 'high', count: n }] };
    case 'reliability.usage':
      return { buckets: [], timeline: [], total: totals, eventCount: n, generatedAt: n };
    case 'reliability.activity':
      return {
        memory: { created: n, updated: 0, deleted: 0, reads: 0, total: n, byType: [], lastTs: n },
        heartbeat: { ok: n, failed: 0, skipped: 0, sent: 0, total: n, lastTs: n, lastStatus: 'ok' },
        tools: { ok: n, err: 0, total: n, top: [] },
        proactivity: { proactive: 0, reactive: n, interAgent: 0, other: 0, total: n },
        generatedAt: n,
      };
    case 'reliability.perf':
      return { snapshots: [snapshot], latest: snapshot };
    default:
      throw new Error('Unexpected fixture method');
  }
}
