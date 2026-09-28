/**
 * The payload type `T` is kept trivial here (`string[]`) — the merge/eviction/
 * inflight machinery under test doesn't care what a "week" contains.
 *
 * NOT wrapped in `$effect.root`: this factory only uses `$state`/`$derived`
 * (no bare `$effect`), and both read correctly via plain getters with no
 * owning effect/root needed — confirmed empirically against this repo's
 * bun+vitest+svelte-plugin setup, where `$effect.root(fn)` silently never
 * invokes `fn` (any assertion placed only inside a `$effect.root` callback
 * passes vacuously without exercising anything — reproduced against this
 * file's own factories AND against the shipped `createAsyncResource` in
 * `src/lib/state/async.svelte.ts`/`.test.ts`). See the TODO(handoff) on
 * `settled-day.svelte.test.ts` for the full writeup and the ledger entry.
 *
 * All dates below sit on `2026-09-21` (a Monday, confirmed via
 * `new Date('2026-09-21T00:00:00Z').getUTCDay() === 1`), so
 * `weekKeysAround('2026-09-21', '2026-09-21')` is exactly
 * `['2026-09-14', '2026-09-21', '2026-09-28']`.
 */
import { describe, it, expect, vi } from 'vitest';
import { createCalendarWindowCache } from './window-cache.svelte';

type Week = string[];
const merge = (parts: Week[]) => parts.flat().sort();

describe('createCalendarWindowCache', () => {
  it('renders the seeded weeks immediately, without fetching', () => {
    const fetchWindow = vi.fn();
    const cache = createCalendarWindowCache<Week>({
      seedRange: () => ['2026-09-21'],
      seed: () => new Map([['2026-09-21', ['seed-1']]]),
      fetchWindow,
      merge,
    });
    expect(cache.data).toEqual(['seed-1']);
    expect(fetchWindow).not.toHaveBeenCalled();
    expect(cache.busy).toBe(false);
  });

  it('onRange fetches only the missing neighbour weeks, not the already-seeded one', async () => {
    const fetchWindow = vi.fn(async (from: string) => [`fetched:${from}`]);
    const cache = createCalendarWindowCache<Week>({
      seedRange: () => ['2026-09-21'],
      seed: () => new Map([['2026-09-21', ['seed-1']]]),
      fetchWindow,
      merge,
    });

    cache.onRange('2026-09-21', '2026-09-21');
    expect(cache.busy).toBe(true); // set synchronously, before the fetches resolve

    await vi.waitFor(() => expect(cache.busy).toBe(false));

    expect(fetchWindow.mock.calls.map((c) => c[0]).sort()).toEqual(['2026-09-14', '2026-09-28']);
    expect(cache.data).toEqual(['fetched:2026-09-14', 'fetched:2026-09-28', 'seed-1']);
  });

  it('does not double-fetch a week already in flight', () => {
    let resolveFetch!: (v: Week) => void;
    const fetchWindow = vi.fn(() => new Promise<Week>((resolve) => (resolveFetch = resolve)));
    const cache = createCalendarWindowCache<Week>({
      seedRange: () => [],
      seed: () => new Map(),
      fetchWindow,
      merge,
    });

    cache.onRange('2026-09-21', '2026-09-21'); // queues 09-14, 09-21, 09-28
    cache.onRange('2026-09-21', '2026-09-21'); // same range again, before any resolves

    expect(fetchWindow).toHaveBeenCalledTimes(3); // not 6 — the second onRange found everything in flight
    resolveFetch([]);
  });

  it('evicts a fetched week once it falls outside keepWeeks of the new visible range', async () => {
    const fetchWindow = vi.fn(async (from: string) => [`f:${from}`]);
    const cache = createCalendarWindowCache<Week>({
      seedRange: () => [],
      seed: () => new Map(),
      fetchWindow,
      merge,
      keepWeeks: 1,
    });

    cache.onRange('2026-09-21', '2026-09-21');
    await vi.waitFor(() => expect(cache.busy).toBe(false));
    expect(cache.data).toContain('f:2026-09-14');

    // Scroll far ahead — 09-14 is now well outside keepWeeks=1 of the visible range.
    cache.onRange('2026-11-02', '2026-11-02');
    await vi.waitFor(() => expect(cache.busy).toBe(false));
    expect(cache.data).not.toContain('f:2026-09-14');
  });

  it('refetchVisible re-fetches on-screen weeks NOT covered by the current seed (post-mutation refresh)', async () => {
    const fetchWindow = vi.fn(async (from: string) => [`f:${from}`]);
    const cache = createCalendarWindowCache<Week>({
      // The caller's own reload window (e.g. `calendarLoadWindow`) only ever
      // covers a few weeks around the focused date, NOT everything the runway
      // has on screen — 09-21 stays seeded across the whole test.
      seedRange: () => ['2026-09-21'],
      seed: () => new Map([['2026-09-21', ['seed-1']]]),
      fetchWindow,
      merge,
    });

    cache.onRange('2026-09-21', '2026-09-21');
    await vi.waitFor(() => expect(cache.busy).toBe(false));
    fetchWindow.mockClear();

    // A mutation's `refresh()` re-ran the caller's load, which still only
    // covers 09-21 — every OTHER visible week (09-14, 09-28) may now be stale
    // (a box could have moved into or out of it), so refetchVisible re-fetches
    // them; 09-21 stays seeded and is skipped.
    cache.refetchVisible();
    await vi.waitFor(() => expect(cache.busy).toBe(false));

    expect(fetchWindow.mock.calls.map((c) => c[0]).sort()).toEqual(['2026-09-14', '2026-09-28']);
  });

  it('refetchVisible is a no-op before onRange has ever settled', () => {
    const fetchWindow = vi.fn();
    const cache = createCalendarWindowCache<Week>({
      seedRange: () => [],
      seed: () => new Map(),
      fetchWindow,
      merge,
    });
    cache.refetchVisible();
    expect(fetchWindow).not.toHaveBeenCalled();
  });

  it('a failed fetch calls onError, clears busy, and leaves the key unloaded to retry', async () => {
    const onError = vi.fn();
    let attempt = 0;
    const fetchWindow = vi.fn(async (from: string) => {
      attempt += 1;
      if (attempt === 1) throw new Error('boom');
      return [`f:${from}`];
    });
    const cache = createCalendarWindowCache<Week>({
      seedRange: () => [],
      seed: () => new Map(),
      fetchWindow,
      merge,
      onError,
    });

    cache.onRange('2026-09-21', '2026-09-21');
    await vi.waitFor(() => expect(cache.busy).toBe(false));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
    expect(cache.data).not.toContain('f:2026-09-14'); // the failed week never landed

    // The next settle over the same range retries the still-unloaded key.
    cache.onRange('2026-09-21', '2026-09-21');
    await vi.waitFor(() => expect(cache.busy).toBe(false));
    expect(cache.data).toContain('f:2026-09-14');
  });
});
