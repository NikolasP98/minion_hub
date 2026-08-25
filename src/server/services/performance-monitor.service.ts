import { randomUUID } from 'node:crypto';
import { env } from '$env/dynamic/private';
import type {
  PerformanceMonitorSnapshot,
  PerformanceSample,
  PerformanceTimelinePoint,
} from '$lib/types/performance-monitor';

const RETENTION_MS = 91 * 24 * 60 * 60_000;
const RETENTION_SECONDS = Math.ceil(RETENTION_MS / 1_000);
const MAX_READ_SAMPLES = 20_000;
const SLOW_MS = 3_000;

type RedisClient = {
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zremrangebyscore(key: string, min: number, max: number): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  zrevrangebyscore(
    key: string,
    min: number,
    max: number,
    limit: 'LIMIT',
    offset: number,
    count: number,
  ): Promise<string[]>;
};

let redisPromise: Promise<RedisClient | null> | null = null;

function monitorRedis(): Promise<RedisClient | null> {
  if (redisPromise) return redisPromise;
  redisPromise = (async () => {
    const url = env.VALKEY_URL?.trim();
    if (!url) return null;
    try {
      const mod = (await import('ioredis')) as unknown as {
        default: new (url: string, options?: unknown) => RedisClient;
      };
      return new mod.default(url, {
        password: env.VALKEY_PASSWORD?.trim() || undefined,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
    } catch {
      return null;
    }
  })();
  return redisPromise;
}

function monitorKey(orgId: string): string {
  return `hub:performance:v1:${orgId}`;
}

function isCold(sample: PerformanceSample): boolean {
  return sample.isolateCold || sample.cache.status === 'miss' || sample.cache.status === 'error';
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
  return Math.round(sorted[index]);
}

function timelineBucketMs(rangeMs: number): number {
  const target = Math.max(60_000, rangeMs / 48);
  const choices = [
    60_000,
    5 * 60_000,
    15 * 60_000,
    60 * 60_000,
    6 * 60 * 60_000,
    24 * 60 * 60_000,
    7 * 24 * 60 * 60_000,
  ];
  return choices.find((choice) => choice >= target) ?? choices[choices.length - 1];
}

function emptySnapshot(
  range: { from: number; to: number },
  available: boolean,
): PerformanceMonitorSnapshot {
  return {
    available,
    generatedAt: Date.now(),
    range,
    summary: {
      totalSamples: 0,
      coldSamples: 0,
      isolateColdSamples: 0,
      cacheMissSamples: 0,
      slowSamples: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      coldP95Ms: 0,
      dbP95Ms: 0,
    },
    cache: { hits: 0, staleHits: 0, misses: 0, errors: 0, hitRate: 0 },
    routes: [],
    timeline: [],
    recentSlow: [],
  };
}

export function aggregatePerformanceSamples(
  input: PerformanceSample[],
  range: { from: number; to: number },
  available = true,
): PerformanceMonitorSnapshot {
  const samples = input.filter(
    (sample) => sample.timestamp >= range.from && sample.timestamp <= range.to,
  );
  if (samples.length === 0) return emptySnapshot(range, available);

  const cold = samples.filter(isCold);
  const cacheMiss = samples.filter((sample) => sample.cache.misses > 0);
  const durations = samples.map((sample) => sample.durationMs);
  const databaseDurations = samples.map((sample) => sample.database.queryMs);
  const cache = samples.reduce(
    (total, sample) => ({
      hits: total.hits + sample.cache.hits,
      staleHits: total.staleHits + sample.cache.staleHits,
      misses: total.misses + sample.cache.misses,
      errors: total.errors + sample.cache.errors,
    }),
    { hits: 0, staleHits: 0, misses: 0, errors: 0 },
  );
  const cacheLookups = cache.hits + cache.staleHits + cache.misses;

  const byRoute = new Map<string, PerformanceSample[]>();
  for (const sample of samples) {
    const bucket = byRoute.get(sample.route) ?? [];
    bucket.push(sample);
    byRoute.set(sample.route, bucket);
  }
  const routes = [...byRoute.entries()]
    .map(([route, routeSamples]) => {
      const coldSamples = routeSamples.filter(isCold);
      const misses = routeSamples.filter((sample) => sample.cache.misses > 0);
      return {
        route,
        samples: routeSamples.length,
        coldSamples: coldSamples.length,
        isolateColdSamples: routeSamples.filter((sample) => sample.isolateCold).length,
        cacheMissSamples: misses.length,
        p50Ms: percentile(
          routeSamples.map((sample) => sample.durationMs),
          0.5,
        ),
        p95Ms: percentile(
          routeSamples.map((sample) => sample.durationMs),
          0.95,
        ),
        p99Ms: percentile(
          routeSamples.map((sample) => sample.durationMs),
          0.99,
        ),
        coldP95Ms: percentile(
          coldSamples.map((sample) => sample.durationMs),
          0.95,
        ),
        dbP95Ms: percentile(
          routeSamples.map((sample) => sample.database.queryMs),
          0.95,
        ),
        slowRate:
          routeSamples.filter((sample) => sample.durationMs >= SLOW_MS).length /
          routeSamples.length,
        cacheMissRate: misses.length / routeSamples.length,
        lastSeenAt: Math.max(...routeSamples.map((sample) => sample.timestamp)),
      };
    })
    .sort((a, b) => b.coldP95Ms - a.coldP95Ms || b.p95Ms - a.p95Ms || b.samples - a.samples);

  const bucketMs = timelineBucketMs(range.to - range.from);
  const timelineBuckets = new Map<number, PerformanceSample[]>();
  for (const sample of samples) {
    const timestamp = Math.floor(sample.timestamp / bucketMs) * bucketMs;
    const bucket = timelineBuckets.get(timestamp) ?? [];
    bucket.push(sample);
    timelineBuckets.set(timestamp, bucket);
  }
  const timeline: PerformanceTimelinePoint[] = [...timelineBuckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([timestamp, bucket]) => {
      const coldBucket = bucket.filter(isCold);
      return {
        timestamp,
        samples: bucket.length,
        coldSamples: coldBucket.length,
        p50Ms: percentile(
          bucket.map((sample) => sample.durationMs),
          0.5,
        ),
        p95Ms: percentile(
          bucket.map((sample) => sample.durationMs),
          0.95,
        ),
        coldP95Ms: percentile(
          coldBucket.map((sample) => sample.durationMs),
          0.95,
        ),
      };
    });

  return {
    available,
    generatedAt: Date.now(),
    range,
    summary: {
      totalSamples: samples.length,
      coldSamples: cold.length,
      isolateColdSamples: samples.filter((sample) => sample.isolateCold).length,
      cacheMissSamples: cacheMiss.length,
      slowSamples: samples.filter((sample) => sample.durationMs >= SLOW_MS).length,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      p99Ms: percentile(durations, 0.99),
      coldP95Ms: percentile(
        cold.map((sample) => sample.durationMs),
        0.95,
      ),
      dbP95Ms: percentile(databaseDurations, 0.95),
    },
    cache: {
      ...cache,
      hitRate: cacheLookups > 0 ? (cache.hits + cache.staleHits) / cacheLookups : 0,
    },
    routes,
    timeline,
    recentSlow: samples
      .filter((sample) => sample.durationMs >= SLOW_MS)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 20),
  };
}

/** Best-effort persistence. The caller schedules this with Vercel waitUntil so
 * telemetry never extends the measured response. */
export async function storePerformanceSample(
  orgId: string,
  sample: PerformanceSample,
): Promise<void> {
  const redis = await monitorRedis();
  if (!redis) return;
  const key = monitorKey(orgId);
  const member = JSON.stringify({ id: randomUUID(), ...sample });
  try {
    await Promise.all([
      redis.zadd(key, sample.timestamp, member),
      redis.zremrangebyscore(key, 0, Date.now() - RETENTION_MS),
      redis.expire(key, RETENTION_SECONDS),
    ]);
  } catch (error) {
    console.warn('[performance-monitor] sample persistence failed', error);
  }
}

export async function getPerformanceSnapshot(
  orgId: string,
  range: { from: number; to: number },
): Promise<PerformanceMonitorSnapshot> {
  const redis = await monitorRedis();
  if (!redis) return aggregatePerformanceSamples([], range, false);
  try {
    const rows = await redis.zrevrangebyscore(
      monitorKey(orgId),
      range.to,
      range.from,
      'LIMIT',
      0,
      MAX_READ_SAMPLES,
    );
    const samples = rows.flatMap((row): PerformanceSample[] => {
      try {
        const parsed = JSON.parse(row) as PerformanceSample;
        return typeof parsed.timestamp === 'number' && typeof parsed.route === 'string'
          ? [parsed]
          : [];
      } catch {
        return [];
      }
    });
    return aggregatePerformanceSamples(samples, range, true);
  } catch (error) {
    console.warn('[performance-monitor] snapshot read failed', error);
    return aggregatePerformanceSamples([], range, false);
  }
}
