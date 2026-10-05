// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import WindowCacheLifecycleHarness from './__fixtures__/WindowCacheLifecycleHarness.svelte';
import type { CalendarWindowCache, CalendarWindowFetchResult } from './window-cache.svelte';

type Week = string[];
type FetchResult = CalendarWindowFetchResult<Week>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

afterEach(cleanup);

describe('calendar window cache component lifecycle', () => {
  it('aborts and releases a never-settling owner when its component unmounts', () => {
    const request = deferred<FetchResult>();
    let signal: AbortSignal | undefined;
    let cache: CalendarWindowCache<Week> | undefined;
    const fetchWindow = vi.fn((_from: string, _to: string, ownerSignal: AbortSignal) => {
      signal = ownerSignal;
      return request.promise;
    });
    const view = render(WindowCacheLifecycleHarness, {
      props: { fetchWindow, expose: (value) => (cache = value) },
    });

    expect(view.getByTestId('busy').textContent).toBe('busy');
    expect(signal?.aborted).toBe(false);
    view.unmount();

    expect(signal?.aborted).toBe(true);
    expect(cache?.busy).toBe(false);
    expect(cache?.data).toEqual([]);
    expect(cache?.windows).toEqual([]);

    cache?.reconcile({
      activeScope: JSON.stringify(['org-b', 'Pacific/Kiritimati']),
      seedScope: JSON.stringify(['org-b', 'Pacific/Kiritimati']),
      seedRange: [],
      seed: new Map(),
    });
    cache?.setVisibleRange('2026-10-05', '2026-10-05', { prefetch: false });
    cache?.refetchVisible();
    cache?.retry('2026-10-05');
    expect(fetchWindow).toHaveBeenCalledOnce();
  });

  it('ignores a late fulfilled response after unmount', async () => {
    const request = deferred<FetchResult>();
    let cache: CalendarWindowCache<Week> | undefined;
    const onError = vi.fn();
    const view = render(WindowCacheLifecycleHarness, {
      props: {
        fetchWindow: () => request.promise,
        expose: (value) => (cache = value),
        onError,
      },
    });

    view.unmount();
    request.resolve({
      calendarScope: JSON.stringify(['org-a', 'America/Lima']),
      payload: ['late'],
    });
    await Promise.resolve();

    expect(cache?.data).toEqual([]);
    expect(cache?.windows).toEqual([]);
    expect(cache?.busy).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it('cancels a queued mutation replacement before its admission microtask', async () => {
    let cache: CalendarWindowCache<Week> | undefined;
    const fetchWindow = vi.fn(async () => ({
      calendarScope: JSON.stringify(['org-a', 'America/Lima']),
      payload: ['ready'],
    }));
    const view = render(WindowCacheLifecycleHarness, {
      props: { fetchWindow, expose: (value) => (cache = value) },
    });
    await vi.waitFor(() => expect(cache?.busy).toBe(false));

    cache?.refetchVisible();
    expect(cache?.busy).toBe(true);
    view.unmount();
    await Promise.resolve();

    expect(fetchWindow).toHaveBeenCalledOnce();
    expect(cache?.busy).toBe(false);
    expect(cache?.data).toEqual([]);
  });
});
