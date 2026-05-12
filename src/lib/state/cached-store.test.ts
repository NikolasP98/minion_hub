// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCachedStore } from './cached-store.svelte';

beforeEach(() => {
  sessionStorage.clear();
});

describe('createCachedStore — minimal', () => {
  it('runs fetcher once on mount and exposes data', async () => {
    const fetcher = vi.fn(async () => ({ groups: [{ id: 'a' }] }));
    const store = createCachedStore({
      key: 'hub:v1:agent-groups:t=t1:u=u1',
      tags: ['t:t1:agent-groups'],
      fetcher,
    });
    expect(store.data).toBeNull();
    expect(store.loading).toBe(true);
    await store.refresh();
    expect(store.data).toEqual({ groups: [{ id: 'a' }] });
    expect(store.loading).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('initial seeds data synchronously and skips first fetch', async () => {
    const fetcher = vi.fn(async () => ({ groups: [] }));
    const seed = { groups: [{ id: 'seed' }] };
    const store = createCachedStore({
      key: 'k',
      tags: ['t'],
      fetcher,
      initial: seed,
    });
    expect(store.data).toEqual(seed);
    expect(store.loading).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('invalidate() drops data and forces next refresh to fetch', async () => {
    const fetcher = vi.fn(async () => 1);
    const store = createCachedStore({ key: 'k', tags: ['t'], fetcher });
    await store.refresh();
    expect(fetcher).toHaveBeenCalledTimes(1);
    store.invalidate();
    expect(store.data).toBeNull();
    await store.refresh();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('createCachedStore — sessionStorage', () => {
  it('reads existing fresh entry from sessionStorage on mount', () => {
    const seed = { groups: [{ id: 'persisted' }] };
    const now = Date.now();
    sessionStorage.setItem(
      'hub:cache:v1:k',
      JSON.stringify({ value: seed, expiresAt: now + 60_000, staleUntil: now + 120_000 }),
    );
    const store = createCachedStore({
      key: 'k', tags: ['t'], fetcher: async () => ({ groups: [] }),
      ttl: 60_000, swr: 60_000,
    });
    expect(store.data).toEqual(seed);
    expect(store.stale).toBe(false);
  });

  it('marks stale when sessionStorage entry is past TTL but within SWR', () => {
    const seed = 'stale-value';
    const now = Date.now();
    sessionStorage.setItem(
      'hub:cache:v1:k',
      JSON.stringify({ value: seed, expiresAt: now - 1_000, staleUntil: now + 60_000 }),
    );
    const store = createCachedStore({
      key: 'k', tags: ['t'], fetcher: async () => 'fresh',
      ttl: 60_000, swr: 60_000,
    });
    expect(store.data).toEqual(seed);
    expect(store.stale).toBe(true);
  });

  it('writes back to sessionStorage on successful refresh', async () => {
    const store = createCachedStore({
      key: 'k', tags: ['t'], fetcher: async () => 'fresh',
      ttl: 60_000, swr: 60_000,
    });
    await store.refresh();
    const raw = sessionStorage.getItem('hub:cache:v1:k');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.value).toBe('fresh');
    expect(typeof parsed.expiresAt).toBe('number');
    expect(typeof parsed.staleUntil).toBe('number');
  });

  it('ignores corrupted sessionStorage entry', () => {
    sessionStorage.setItem('hub:cache:v1:k', 'not-json');
    const store = createCachedStore({
      key: 'k', tags: ['t'], fetcher: async () => 'fresh',
    });
    expect(store.data).toBeNull();
    expect(store.loading).toBe(true);
  });
});

describe('createCachedStore — quota eviction', () => {
  it('evicts old entries on QuotaExceededError until write succeeds', async () => {
    // Pre-populate storage with 3 entries; mock storage to throw QuotaExceeded on first write.
    sessionStorage.setItem('hub:cache:v1:a', JSON.stringify({ value: 1, expiresAt: 1, staleUntil: 2 }));
    sessionStorage.setItem('hub:cache:v1:b', JSON.stringify({ value: 2, expiresAt: 3, staleUntil: 4 }));
    sessionStorage.setItem('hub:cache:v1:__index', JSON.stringify(['a', 'b']));

    let throws = 1;
    const realSetItem = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage, k: string, v: string,
    ) {
      if (k === 'hub:cache:v1:c' && throws > 0) {
        throws--;
        const err = new Error('quota');
        (err as any).name = 'QuotaExceededError';
        throw err;
      }
      realSetItem.call(this, k, v);
    });

    const store = createCachedStore({
      key: 'c', tags: ['t'], fetcher: async () => 'value-c',
    });
    await store.refresh();
    expect(store.data).toBe('value-c');
    expect(sessionStorage.getItem('hub:cache:v1:c')).not.toBeNull();
    spy.mockRestore();
  });
});
