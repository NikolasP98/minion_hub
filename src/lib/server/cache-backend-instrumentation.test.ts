import { describe, expect, it } from 'vitest';
import type { CacheBackend } from '@minion-stack/cache';
import {
  createPerformanceContext,
  currentPerformanceSnapshot,
  runWithPerformanceContext,
} from './performance-context';
import { instrumentCacheBackend } from './cache-backend-instrumentation';

describe('instrumentCacheBackend', () => {
  it('records elapsed backend time even when a lookup misses', async () => {
    const backend: CacheBackend = {
      name: 'noop',
      get: async () => null,
      set: async () => {},
      del: async () => {},
      delByTag: async () => {},
      mget: async (keys) => keys.map(() => null),
    };
    const ticks = [10, 17];
    const instrumented = instrumentCacheBackend(backend, () => ticks.shift() ?? 17);

    const lookupMs = await runWithPerformanceContext(createPerformanceContext(), async () => {
      await instrumented.get('missing');
      return currentPerformanceSnapshot().cache.lookupMs;
    });

    expect(lookupMs).toBe(7);
  });
});
