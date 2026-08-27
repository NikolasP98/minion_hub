import type { CacheBackend, CacheEntry } from '@minion-stack/cache';
import { recordCacheLookup } from './performance-context';

/** Decorate a cache backend so every get/mget outcome contributes lookup time.
 * The package logger currently supplies duration only for hit outcomes. */
export function instrumentCacheBackend(
  backend: CacheBackend,
  now: () => number = () => performance.now(),
): CacheBackend {
  const measure = async <T>(work: () => Promise<T>): Promise<T> => {
    const startedAt = now();
    try {
      return await work();
    } finally {
      recordCacheLookup(now() - startedAt);
    }
  };
  return {
    name: backend.name,
    get: <T>(key: string) => measure(() => backend.get<T>(key)),
    set: <T>(key: string, entry: CacheEntry<T>) => backend.set<T>(key, entry),
    del: (keys: string[]) => backend.del(keys),
    delByTag: (tags: string[]) => backend.delByTag(tags),
    mget: <T>(keys: string[]) => measure(() => backend.mget<T>(keys)),
    close: backend.close ? () => backend.close!() : undefined,
  };
}
