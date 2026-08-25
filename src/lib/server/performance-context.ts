import { AsyncLocalStorage } from 'node:async_hooks';
import type { CacheEvent } from '@minion-stack/cache';
import type {
  CachePerformanceSnapshot,
  DatabasePerformanceSnapshot,
} from '$lib/types/performance-monitor';

export interface RequestPerformanceContext {
  cache: Omit<CachePerformanceSnapshot, 'status'>;
  database: DatabasePerformanceSnapshot;
}

export function createPerformanceContext(): RequestPerformanceContext {
  return {
    cache: { hits: 0, staleHits: 0, misses: 0, errors: 0, lookupMs: 0 },
    database: { transactions: 0, acquireMs: 0, setupMs: 0, queryMs: 0, totalMs: 0 },
  };
}

const requestPerformance = new AsyncLocalStorage<RequestPerformanceContext>();

export function runWithPerformanceContext<T>(context: RequestPerformanceContext, work: () => T): T {
  return requestPerformance.run(context, work);
}

export function recordCacheEvent(event: Pick<CacheEvent, 'type' | 'ms'>): void {
  const context = requestPerformance.getStore();
  if (!context) return;
  if (event.type === 'hit') context.cache.hits += 1;
  else if (event.type === 'stale-hit') context.cache.staleHits += 1;
  else if (event.type === 'miss') context.cache.misses += 1;
  else if (event.type === 'error') context.cache.errors += 1;
  if (typeof event.ms === 'number' && Number.isFinite(event.ms)) {
    context.cache.lookupMs += Math.max(0, event.ms);
  }
}

export function recordDatabaseTiming(
  timing: Omit<DatabasePerformanceSnapshot, 'transactions'>,
): void {
  const context = requestPerformance.getStore();
  if (!context) return;
  context.database.transactions += 1;
  context.database.acquireMs += Math.max(0, timing.acquireMs);
  context.database.setupMs += Math.max(0, timing.setupMs);
  context.database.queryMs += Math.max(0, timing.queryMs);
  context.database.totalMs += Math.max(0, timing.totalMs);
}

function cacheStatus(
  cache: RequestPerformanceContext['cache'],
): CachePerformanceSnapshot['status'] {
  if (cache.errors > 0) return 'error';
  if (cache.misses > 0) return 'miss';
  if (cache.staleHits > 0) return 'stale';
  if (cache.hits > 0) return 'hit';
  return 'none';
}

export function currentPerformanceSnapshot(): {
  cache: CachePerformanceSnapshot;
  database: DatabasePerformanceSnapshot;
} {
  const context = requestPerformance.getStore() ?? createPerformanceContext();
  return {
    cache: { status: cacheStatus(context.cache), ...context.cache },
    database: { ...context.database },
  };
}
