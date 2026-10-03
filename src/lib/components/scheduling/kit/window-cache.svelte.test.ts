import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCalendarWindowCache,
  type CalendarWindowCache,
  type CalendarWindowFetchResult,
  type CalendarWindowSnapshot,
} from './window-cache.svelte';

type Week = string[];
type FetchResult = CalendarWindowFetchResult<Week>;

const SCOPE_A = JSON.stringify(['org-a', 'America/Lima']);
const SCOPE_B = JSON.stringify(['org-b', 'Pacific/Kiritimati']);
const SCOPE_A_LORD_HOWE = JSON.stringify(['org-a', 'Australia/Lord_Howe']);
const merge = (parts: Week[]) => parts.flat().sort();
const response = (payload: Week, calendarScope: string | null = SCOPE_A): FetchResult => ({
  calendarScope,
  payload,
});

function snapshot(
  overrides: Partial<CalendarWindowSnapshot<Week>> = {},
): CalendarWindowSnapshot<Week> {
  return {
    activeScope: SCOPE_A,
    seedScope: SCOPE_A,
    seedRange: [],
    seed: new Map(),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function settled(cache: CalendarWindowCache<Week>): Promise<void> {
  await vi.waitFor(() => expect(cache.busy).toBe(false));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createCalendarWindowCache', () => {
  it('renders a matching authoritative seed immediately without reading neighbours', () => {
    const fetchWindow = vi.fn();
    const cache = createCalendarWindowCache<Week>({ fetchWindow, merge });

    cache.reconcile(
      snapshot({
        seedRange: ['2026-09-21'],
        seed: new Map([['2026-09-21', ['seed']]]),
      }),
    );
    cache.setVisibleRange('2026-09-21', '2026-09-21', { prefetch: false });

    expect(cache.data).toEqual(['seed']);
    expect(cache.windows).toEqual([
      {
        key: '2026-09-21',
        from: '2026-09-21',
        to: '2026-09-27',
        status: 'ready',
        hasData: true,
      },
    ]);
    expect(cache.busy).toBe(false);
    expect(fetchWindow).not.toHaveBeenCalled();
  });

  it('prefetches one neighbour per side and deduplicates an identical settle', async () => {
    const fetchWindow = vi.fn(async (from: string) => response([`f:${from}`]));
    const cache = createCalendarWindowCache<Week>({ fetchWindow, merge });
    cache.reconcile(
      snapshot({
        seedRange: ['2026-09-21'],
        seed: new Map([['2026-09-21', ['seed']]]),
      }),
    );

    cache.setVisibleRange('2026-09-21', '2026-09-27', { prefetch: true });
    cache.setVisibleRange('2026-09-21', '2026-09-27', { prefetch: true });
    expect(cache.busy).toBe(true);
    expect(fetchWindow.mock.calls.map((call) => call[0]).sort()).toEqual([
      '2026-09-14',
      '2026-09-28',
    ]);

    await settled(cache);
    expect(cache.data).toEqual(['f:2026-09-14', 'f:2026-09-28', 'seed']);
    expect(cache.windows).toHaveLength(1);
  });

  it('reconciles a supplier-only scope and seed change without a range callback', () => {
    const fetchWindow = vi.fn();
    const cache = createCalendarWindowCache<Week>({ fetchWindow, merge });
    cache.reconcile(
      snapshot({
        seedRange: ['2026-09-21'],
        seed: new Map([['2026-09-21', ['org-a']]]),
      }),
    );
    expect(cache.data).toEqual(['org-a']);

    cache.reconcile(
      snapshot({
        activeScope: SCOPE_B,
        seedScope: SCOPE_B,
        seedRange: ['2026-10-05'],
        seed: new Map([['2026-10-05', ['org-b']]]),
      }),
    );

    expect(cache.data).toEqual(['org-b']);
    expect(cache.windows).toEqual([]);
    expect(fetchWindow).not.toHaveBeenCalled();
  });

  it('admits a replacement even when the invalidated transport never settles', async () => {
    const requests: Array<ReturnType<typeof deferred<FetchResult>>> = [];
    const fetchWindow = vi.fn(() => {
      const request = deferred<FetchResult>();
      requests.push(request);
      return request.promise;
    });
    const cache = createCalendarWindowCache<Week>({ fetchWindow, merge });
    cache.reconcile(snapshot());
    cache.setVisibleRange('2026-09-21', '2026-09-21', { prefetch: false });
    expect(fetchWindow).toHaveBeenCalledTimes(1);

    cache.refetchVisible();
    expect(cache.busy).toBe(true);
    await Promise.resolve();
    expect(fetchWindow).toHaveBeenCalledTimes(2);

    requests[1]!.resolve(response(['current']));
    await settled(cache);
    expect(cache.data).toEqual(['current']);
    expect(cache.busy).toBe(false);

    requests[0]!.resolve(response(['late-pre-mutation']));
    await Promise.resolve();
    expect(cache.data).toEqual(['current']);
    expect(cache.windows[0]).toMatchObject({ status: 'ready', hasData: true });
    expect(cache.busy).toBe(false);
  });

  it('coalesces repeated invalidations and never publishes false during owner replacement', async () => {
    const requests: Array<ReturnType<typeof deferred<FetchResult>>> = [];
    const fetchWindow = vi.fn(() => {
      const request = deferred<FetchResult>();
      requests.push(request);
      return request.promise;
    });
    const cache = createCalendarWindowCache<Week>({ fetchWindow, merge });
    cache.reconcile(snapshot());
    cache.setVisibleRange('2026-09-21', '2026-09-21', { prefetch: false });
    const busyHistory = [cache.busy];

    cache.refetchVisible();
    busyHistory.push(cache.busy);
    cache.refetchVisible();
    busyHistory.push(cache.busy);
    cache.refetchVisible();
    busyHistory.push(cache.busy);
    await Promise.resolve();
    busyHistory.push(cache.busy);

    expect(fetchWindow).toHaveBeenCalledTimes(2);
    expect(busyHistory).toEqual([true, true, true, true, true]);
    requests[1]!.resolve(response(['replacement']));
    await settled(cache);
    busyHistory.push(cache.busy);
    expect(busyHistory).toEqual([true, true, true, true, true, false]);
  });

  it('rejects an evicted owner after same-scope re-entry', async () => {
    const requests: Array<
      { from: string; signal: AbortSignal } & ReturnType<typeof deferred<FetchResult>>
    > = [];
    const fetchWindow = vi.fn((from: string, _to: string, signal: AbortSignal) => {
      const request = deferred<FetchResult>();
      requests.push({ from, signal, ...request });
      return request.promise;
    });
    const cache = createCalendarWindowCache<Week>({ fetchWindow, merge, keepWeeks: 0 });
    cache.reconcile(snapshot());

    cache.setVisibleRange('2026-09-21', '2026-09-21', { prefetch: false });
    cache.setVisibleRange('2026-11-02', '2026-11-02', { prefetch: false });
    cache.setVisibleRange('2026-09-21', '2026-09-21', { prefetch: false });
    expect(requests).toHaveLength(3);
    expect(requests[0]!.signal.aborted).toBe(true);
    expect(requests[1]!.signal.aborted).toBe(true);

    requests[2]!.resolve(response(['new-owner']));
    await settled(cache);
    requests[0]!.resolve(response(['late-old-owner']));
    await Promise.resolve();
    expect(cache.data).toEqual(['new-owner']);
    expect(cache.windows[0]?.status).toBe('ready');
    expect(cache.busy).toBe(false);
  });

  it('fences old-tenant fulfillment and rejection from a new scope', async () => {
    const onError = vi.fn();
    const requests: Array<ReturnType<typeof deferred<FetchResult>>> = [];
    const fetchWindow = vi.fn(() => {
      const request = deferred<FetchResult>();
      requests.push(request);
      return request.promise;
    });
    const cache = createCalendarWindowCache<Week>({ fetchWindow, merge, onError });
    cache.reconcile(snapshot());
    cache.setVisibleRange('2026-09-21', '2026-09-21', { prefetch: false });

    cache.reconcile(snapshot({ activeScope: SCOPE_B, seedScope: SCOPE_B }));
    expect(requests).toHaveLength(2);
    requests[1]!.resolve(response(['org-b'], SCOPE_B));
    await settled(cache);
    requests[0]!.reject(new Error('late org-a failure'));
    await Promise.resolve();

    expect(cache.data).toEqual(['org-b']);
    expect(onError).not.toHaveBeenCalled();
  });

  it('fences a prior timezone while retaining the same organization', async () => {
    const onError = vi.fn();
    const requests: Array<ReturnType<typeof deferred<FetchResult>>> = [];
    const fetchWindow = vi.fn(() => {
      const request = deferred<FetchResult>();
      requests.push(request);
      return request.promise;
    });
    const cache = createCalendarWindowCache<Week>({ fetchWindow, merge, onError });
    cache.reconcile(snapshot());
    cache.setVisibleRange('2026-09-21', '2026-09-21', { prefetch: false });

    cache.reconcile(snapshot({ activeScope: SCOPE_A_LORD_HOWE, seedScope: SCOPE_A_LORD_HOWE }));
    expect(requests).toHaveLength(2);
    requests[1]!.resolve(response(['lord-howe'], SCOPE_A_LORD_HOWE));
    await settled(cache);
    requests[0]!.reject(new Error('late Lima failure'));
    await Promise.resolve();

    expect(cache.data).toEqual(['lord-howe']);
    expect(onError).not.toHaveBeenCalled();
  });

  it.each([
    ['another organization', SCOPE_B],
    ['a new timezone in the same organization', SCOPE_A_LORD_HOWE],
  ])('rejects a response echoed from %s before the UI scope catches up', async (_label, echo) => {
    const onError = vi.fn();
    const fetchWindow = vi.fn(async () => response(['wrong-authority'], echo));
    const cache = createCalendarWindowCache<Week>({ fetchWindow, merge, onError });
    cache.reconcile(snapshot());
    cache.setVisibleRange('2026-09-21', '2026-09-21', { prefetch: false });
    await settled(cache);

    expect(cache.data).toEqual([]);
    expect(cache.windows[0]).toMatchObject({ status: 'error', hasData: false });
    expect(onError).toHaveBeenCalledOnce();
  });

  it('lets matching seed supersede an in-flight and hidden fetched copy', async () => {
    const request = deferred<FetchResult>();
    const fetchWindow = vi.fn(() => request.promise);
    const cache = createCalendarWindowCache<Week>({ fetchWindow, merge });
    cache.reconcile(snapshot());
    cache.setVisibleRange('2026-09-21', '2026-09-21', { prefetch: false });

    cache.reconcile(
      snapshot({
        seedRange: ['2026-09-21'],
        seed: new Map([['2026-09-21', ['authoritative-seed']]]),
      }),
    );
    expect(cache.data).toEqual(['authoritative-seed']);
    expect(cache.busy).toBe(false);
    request.resolve(response(['late-fetch']));
    await Promise.resolve();
    expect(cache.data).toEqual(['authoritative-seed']);
  });

  it('does not reveal an older fetched copy after an authoritative seed moves', async () => {
    const requests: Array<ReturnType<typeof deferred<FetchResult>>> = [];
    const fetchWindow = vi.fn(() => {
      const request = deferred<FetchResult>();
      requests.push(request);
      return request.promise;
    });
    const cache = createCalendarWindowCache<Week>({ fetchWindow, merge });
    cache.reconcile(snapshot());
    cache.setVisibleRange('2026-09-21', '2026-09-21', { prefetch: false });
    requests[0]!.resolve(response(['old-fetched-copy']));
    await settled(cache);

    cache.reconcile(
      snapshot({
        seedRange: ['2026-09-21'],
        seed: new Map([['2026-09-21', ['authoritative-seed']]]),
      }),
    );
    expect(cache.data).toEqual(['authoritative-seed']);

    cache.reconcile(
      snapshot({
        seedRange: ['2026-09-28'],
        seed: new Map([['2026-09-28', ['next-seed']]]),
      }),
    );
    expect(requests).toHaveLength(2);
    expect(cache.data).toEqual(['next-seed']);
    expect(cache.data).not.toContain('old-fetched-copy');

    requests[1]!.resolve(response(['current-fetched-copy']));
    await settled(cache);
    expect(cache.data).toEqual(['current-fetched-copy', 'next-seed']);
  });

  it('excludes a mismatched seed and fails closed without an active organization', () => {
    const fetchWindow = vi.fn(() => new Promise<FetchResult>(() => {}));
    const cache = createCalendarWindowCache<Week>({ fetchWindow, merge });
    cache.reconcile(
      snapshot({
        seedScope: SCOPE_B,
        seedRange: ['2026-09-21'],
        seed: new Map([['2026-09-21', ['wrong-scope']]]),
      }),
    );
    cache.setVisibleRange('2026-09-21', '2026-09-21', { prefetch: false });
    expect(cache.data).toEqual([]);
    expect(fetchWindow).toHaveBeenCalledTimes(1);

    cache.reconcile(
      snapshot({
        activeScope: null,
        seedScope: SCOPE_A,
        seedRange: ['2026-09-21'],
        seed: new Map([['2026-09-21', ['must-not-render']]]),
      }),
    );
    cache.setVisibleRange('2026-09-21', '2026-09-21', { prefetch: false });
    expect(cache.data).toEqual([]);
    expect(cache.windows).toEqual([]);
    expect(cache.busy).toBe(false);
    expect(fetchWindow).toHaveBeenCalledTimes(1);
  });

  it('keeps a cold failure stable until an exact retry', async () => {
    const retryRequest = deferred<FetchResult>();
    const onError = vi.fn();
    const fetchWindow = vi
      .fn<(...args: [string, string, AbortSignal]) => Promise<FetchResult>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(() => retryRequest.promise);
    const cache = createCalendarWindowCache<Week>({ fetchWindow, merge, onError });
    cache.reconcile(snapshot());
    cache.setVisibleRange('2026-09-21', '2026-09-21', { prefetch: false });
    await settled(cache);

    expect(cache.windows[0]).toMatchObject({ status: 'error', hasData: false });
    expect(onError).toHaveBeenCalledTimes(1);
    cache.setVisibleRange('2026-09-21', '2026-09-21', { prefetch: false });
    expect(fetchWindow).toHaveBeenCalledTimes(1);

    for (const invalid of [
      ' 2026-09-21',
      '2026-09-21 ',
      '2026-02-30',
      '2026-09-20',
      '2026-09-14',
      '2026-9-21',
    ])
      cache.retry(invalid);
    expect(fetchWindow).toHaveBeenCalledTimes(1);

    cache.retry('2026-09-21');
    cache.retry('2026-09-21');
    expect(fetchWindow).toHaveBeenCalledTimes(2);
    expect(cache.windows[0]?.status).toBe('loading');
    retryRequest.resolve(response([]));
    await settled(cache);
    expect(cache.windows[0]).toMatchObject({ status: 'ready', hasData: true });
    cache.retry('2026-09-21');
    expect(fetchWindow).toHaveBeenCalledTimes(2);
  });

  it('keeps a failed retry explicit and retryable', async () => {
    const onError = vi.fn();
    const fetchWindow = vi
      .fn<(...args: [string, string, AbortSignal]) => Promise<FetchResult>>()
      .mockRejectedValueOnce(new Error('cold failure'))
      .mockRejectedValueOnce(new Error('retry failure'));
    const cache = createCalendarWindowCache<Week>({ fetchWindow, merge, onError });
    cache.reconcile(snapshot());
    cache.setVisibleRange('2026-09-21', '2026-09-21', { prefetch: false });
    await settled(cache);

    cache.retry('2026-09-21');
    await settled(cache);
    expect(fetchWindow).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(cache.windows[0]).toMatchObject({ status: 'error', hasData: false });
  });

  it('contains an optional error observer that throws', async () => {
    const fetchWindow = vi.fn(async () => {
      throw new Error('read failed');
    });
    const cache = createCalendarWindowCache<Week>({
      fetchWindow,
      merge,
      onError: () => {
        throw new Error('observer failed');
      },
    });
    cache.reconcile(snapshot());
    cache.setVisibleRange('2026-09-21', '2026-09-21', { prefetch: false });
    await settled(cache);

    expect(cache.windows[0]).toMatchObject({ status: 'error', hasData: false });
  });

  it('retains prior data and labels a failed refresh as stale', async () => {
    const fetchWindow = vi
      .fn<(...args: [string, string, AbortSignal]) => Promise<FetchResult>>()
      .mockResolvedValueOnce(response(['old-data']))
      .mockRejectedValueOnce(new Error('refresh failed'));
    const cache = createCalendarWindowCache<Week>({ fetchWindow, merge });
    cache.reconcile(snapshot());
    cache.setVisibleRange('2026-09-21', '2026-09-21', { prefetch: false });
    await settled(cache);
    expect(cache.data).toEqual(['old-data']);

    cache.refetchVisible();
    await settled(cache);
    expect(cache.data).toEqual(['old-data']);
    expect(cache.windows[0]).toMatchObject({ status: 'error', hasData: true });
  });

  it('turns a current read deadline into one retryable error', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const fetchWindow = vi.fn(() => new Promise<FetchResult>(() => {}));
    const cache = createCalendarWindowCache<Week>({
      fetchWindow,
      merge,
      onError,
      requestTimeoutMs: 25,
    });
    cache.reconcile(snapshot());
    cache.setVisibleRange('2026-09-21', '2026-09-21', { prefetch: false });

    await vi.advanceTimersByTimeAsync(25);
    expect(cache.busy).toBe(false);
    expect(cache.windows[0]).toMatchObject({ status: 'error', hasData: false });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('does not expose or directly retry a prefetch-only failure', async () => {
    const fetchWindow = vi.fn(async (from: string) => {
      if (from === '2026-09-14') throw new Error('prefetch failed');
      return response([`f:${from}`]);
    });
    const cache = createCalendarWindowCache<Week>({ fetchWindow, merge });
    cache.reconcile(
      snapshot({
        seedRange: ['2026-09-21'],
        seed: new Map([['2026-09-21', ['seed']]]),
      }),
    );
    cache.setVisibleRange('2026-09-21', '2026-09-27', { prefetch: true });
    await settled(cache);

    expect(cache.windows).toEqual([
      {
        key: '2026-09-21',
        from: '2026-09-21',
        to: '2026-09-27',
        status: 'ready',
        hasData: true,
      },
    ]);
    cache.retry('2026-09-14');
    expect(fetchWindow).toHaveBeenCalledTimes(2);
  });

  it('clears nonvisible errors on week-to-day and restores normal padding on return', async () => {
    const attempts = new Map<string, number>();
    const fetchWindow = vi.fn(async (from: string) => {
      const attempt = (attempts.get(from) ?? 0) + 1;
      attempts.set(from, attempt);
      if (from === '2026-09-28' && attempt === 1) throw new Error('week hole');
      return response([`f:${from}:${attempt}`]);
    });
    const cache = createCalendarWindowCache<Week>({ fetchWindow, merge });
    cache.reconcile(
      snapshot({
        seedRange: ['2026-09-21'],
        seed: new Map([['2026-09-21', ['seed']]]),
      }),
    );
    cache.setVisibleRange('2026-09-21', '2026-10-04', { prefetch: true });
    await settled(cache);
    expect(cache.windows.find((window) => window.key === '2026-09-28')?.status).toBe('error');

    cache.setVisibleRange('2026-09-21', '2026-09-21', { prefetch: false });
    expect(cache.windows.map((window) => window.key)).toEqual(['2026-09-21']);
    expect(cache.windows.some((window) => window.status === 'error')).toBe(false);

    const callsBeforeReturn = fetchWindow.mock.calls.length;
    cache.setVisibleRange('2026-09-21', '2026-09-27', { prefetch: true });
    await settled(cache);
    expect(fetchWindow.mock.calls.length).toBeGreaterThan(callsBeforeReturn);
    expect(attempts.get('2026-09-28')).toBe(2);
  });

  it('rejects invalid, reversed, and unbounded visibility ranges without dispatching', () => {
    const fetchWindow = vi.fn(() => new Promise<FetchResult>(() => {}));
    const cache = createCalendarWindowCache<Week>({ fetchWindow, merge });
    cache.reconcile(snapshot());

    cache.setVisibleRange('2026-02-30', '2026-03-01', { prefetch: true });
    cache.setVisibleRange('2026-09-28', '2026-09-21', { prefetch: true });
    cache.setVisibleRange('2026-01-01', '2028-01-01', { prefetch: true });

    expect(fetchWindow).not.toHaveBeenCalled();
    expect(cache.windows).toEqual([]);
    expect(cache.busy).toBe(false);
  });
});
