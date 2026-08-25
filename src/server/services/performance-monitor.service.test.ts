import { describe, expect, it } from 'vitest';
import type { PerformanceSample } from '$lib/types/performance-monitor';
import { aggregatePerformanceSamples } from './performance-monitor.service';

const FROM = Date.UTC(2026, 7, 25, 12);
const TO = FROM + 60 * 60_000;

function sample(overrides: Partial<PerformanceSample>): PerformanceSample {
  return {
    timestamp: FROM,
    route: '/(app)/home',
    method: 'GET',
    status: 200,
    durationMs: 100,
    isolateCold: false,
    requestOrdinal: 10,
    instanceAgeMs: 20_000,
    cache: { status: 'hit', hits: 1, staleHits: 0, misses: 0, errors: 0, lookupMs: 2 },
    database: { transactions: 1, acquireMs: 4, setupMs: 3, queryMs: 30, totalMs: 37 },
    region: 'iad1',
    deploymentId: 'deployment',
    commitSha: 'sha',
    ...overrides,
  };
}

describe('aggregatePerformanceSamples', () => {
  it('reports cold, slow, cache, database and per-route percentiles', () => {
    const snapshot = aggregatePerformanceSamples(
      [
        sample({ timestamp: FROM + 1_000, durationMs: 100 }),
        sample({
          timestamp: FROM + 2_000,
          route: '/(app)/crm/insights',
          durationMs: 4_000,
          cache: { status: 'miss', hits: 0, staleHits: 0, misses: 2, errors: 0, lookupMs: 5 },
          database: { transactions: 2, acquireMs: 20, setupMs: 10, queryMs: 3_200, totalMs: 3_230 },
        }),
        sample({
          timestamp: FROM + 3_000,
          route: '/(app)/crm/insights',
          durationMs: 6_000,
          isolateCold: true,
          requestOrdinal: 1,
          cache: { status: 'none', hits: 0, staleHits: 0, misses: 0, errors: 0, lookupMs: 0 },
          database: {
            transactions: 1,
            acquireMs: 800,
            setupMs: 100,
            queryMs: 4_500,
            totalMs: 5_400,
          },
        }),
      ],
      { from: FROM, to: TO },
      true,
    );

    expect(snapshot.summary).toMatchObject({
      totalSamples: 3,
      coldSamples: 2,
      isolateColdSamples: 1,
      cacheMissSamples: 1,
      slowSamples: 2,
      p50Ms: 4_000,
      p95Ms: 6_000,
      p99Ms: 6_000,
      coldP95Ms: 6_000,
      dbP95Ms: 4_500,
    });
    expect(snapshot.cache).toMatchObject({ hits: 1, misses: 2, hitRate: 1 / 3 });
    expect(snapshot.routes[0]).toMatchObject({
      route: '/(app)/crm/insights',
      samples: 2,
      coldSamples: 2,
      p95Ms: 6_000,
      dbP95Ms: 4_500,
      slowRate: 1,
    });
    expect(snapshot.recentSlow).toHaveLength(2);
  });

  it('returns a stable empty payload when the backing monitor is unavailable', () => {
    const snapshot = aggregatePerformanceSamples([], { from: FROM, to: TO }, false);
    expect(snapshot.available).toBe(false);
    expect(snapshot.summary.totalSamples).toBe(0);
    expect(snapshot.routes).toEqual([]);
    expect(snapshot.timeline).toEqual([]);
  });
});
