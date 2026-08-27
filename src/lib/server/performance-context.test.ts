import { describe, expect, it } from 'vitest';
import {
  createPerformanceContext,
  currentPerformanceSnapshot,
  recordCacheEvent,
  recordCacheLookup,
  recordDatabaseTiming,
  runWithPerformanceContext,
} from './performance-context';

describe('request performance context', () => {
  it('classifies a cache miss as a cold-path signal and accumulates database stages', async () => {
    const snapshot = await runWithPerformanceContext(createPerformanceContext(), async () => {
      recordCacheEvent({ type: 'miss' });
      recordCacheLookup(6);
      recordCacheEvent({ type: 'set' });
      recordDatabaseTiming({ acquireMs: 7, setupMs: 4, queryMs: 21, totalMs: 32 });
      return currentPerformanceSnapshot();
    });

    expect(snapshot.cache).toEqual({
      status: 'miss',
      hits: 0,
      staleHits: 0,
      misses: 1,
      errors: 0,
      lookupMs: 6,
    });
    expect(snapshot.database).toEqual({
      transactions: 1,
      acquireMs: 7,
      setupMs: 4,
      queryMs: 21,
      totalMs: 32,
    });
  });

  it('keeps concurrent request measurements isolated', async () => {
    const [hit, stale] = await Promise.all([
      runWithPerformanceContext(createPerformanceContext(), async () => {
        recordCacheEvent({ type: 'hit', ms: 3 });
        recordCacheLookup(3);
        await Promise.resolve();
        return currentPerformanceSnapshot().cache;
      }),
      runWithPerformanceContext(createPerformanceContext(), async () => {
        recordCacheEvent({ type: 'stale-hit', ms: 8 });
        recordCacheLookup(8);
        await Promise.resolve();
        return currentPerformanceSnapshot().cache;
      }),
    ]);

    expect(hit).toMatchObject({ status: 'hit', hits: 1, staleHits: 0, lookupMs: 3 });
    expect(stale).toMatchObject({ status: 'stale', hits: 0, staleHits: 1, lookupMs: 8 });
  });

  it('does nothing outside a request context', () => {
    recordCacheEvent({ type: 'miss' });
    recordDatabaseTiming({ acquireMs: 1, setupMs: 2, queryMs: 3, totalMs: 6 });
    expect(currentPerformanceSnapshot()).toMatchObject({
      cache: { status: 'none', misses: 0 },
      database: { transactions: 0, totalMs: 0 },
    });
  });
});
