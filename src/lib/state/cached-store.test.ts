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
