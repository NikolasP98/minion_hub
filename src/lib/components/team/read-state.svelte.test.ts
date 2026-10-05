// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReadHarness from './__fixtures__/ReadHarness.svelte';
import type { createTeamRead } from './latest-read.svelte';
import type { Timeline } from './timeline.svelte';
import type { TeamBooking } from './types';

type Mounted = { read: ReturnType<typeof createTeamRead<{ balance: number }>>; timeline: Timeline };
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
async function mount() {
  let value: Mounted | undefined;
  const owned = vi.fn();
  const view = render(ReadHarness, {
    props: {
      ready: (result) => {
        value = result;
      },
      owned,
    },
  });
  await tick();
  expect(owned).toHaveBeenCalledOnce();
  expect(value).toBeDefined();
  return { ...value!, view };
}
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const booking = (id: string, start = '2026-10-03T15:00:00Z'): TeamBooking => ({
  id,
  resourceId: 'r1',
  eventTypeId: 'e1',
  start,
  end: '2026-10-03T16:00:00Z',
  status: 'accepted',
  attendeeName: 'Synthetic',
});
const scroller = () => Object.assign(document.createElement('div'), { scrollLeft: 0 });

describe('Team read states', () => {
  it('shows a denied balance as an alert, then retry loads the actual balance', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ message: 'scheduling: view required' }, { status: 403 }),
      )
      .mockResolvedValueOnce(Response.json({ balance: 8 }));
    vi.stubGlobal('fetch', fetch);
    const { read, view } = await mount();
    await read.load('/api/scheduling/hr/leave-requests?balance=1');
    await tick();
    expect(within(view.getByTestId('read')).getByRole('alert').textContent).toContain(
      'scheduling: view required',
    );
    expect(read.data).toBeNull();
    await fireEvent.click(within(view.getByTestId('read')).getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(read.data).toEqual({ balance: 8 }));
    await tick();
    expect(within(view.getByTestId('read')).queryByRole('alert')).toBeNull();
    expect(within(view.getByTestId('read')).getByText('8')).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('ignores older balance replies and a reply after scope reset even if fetch ignores abort', async () => {
    const a = deferred(),
      b = deferred(),
      c = deferred();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockReturnValueOnce(a.promise)
        .mockReturnValueOnce(b.promise)
        .mockReturnValueOnce(c.promise),
    );
    const { read } = await mount();
    const first = read.load('/balance?employee=a'),
      second = read.load('/balance?employee=b');
    b.resolve(Response.json({ balance: 9 }));
    await second;
    a.resolve(Response.json({ balance: 999 }));
    await first;
    expect(read.data).toEqual({ balance: 9 });
    const last = read.load('/balance?employee=c');
    read.reset();
    c.resolve(Response.json({ balance: 555 }));
    await last;
    expect(read.data).toBeNull();
    expect(read.loading).toBe(false);
    expect(read.error).toBeNull();
  });
  it('exposes network failure instead of a zero or missing balance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    const { read, view } = await mount();
    await read.load('/balance');
    await tick();
    expect(within(view.getByTestId('read')).getByRole('alert').textContent).toContain(
      'Network request failed',
    );
    expect(read.data).toBeNull();
  });
  it('keeps the failed first timeline range retryable and replaces it with canonical records', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: 'permission denied' }, { status: 403 }))
      .mockResolvedValueOnce(
        Response.json({
          bookings: [
            {
              id: 'new',
              resourceId: 'r1',
              eventTypeId: 'e1',
              startTime: '2026-10-03T15:00:00Z',
              endTime: '2026-10-03T16:00:00Z',
              status: 'accepted',
              attendeeName: 'Synthetic',
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetch);
    const { timeline, view } = await mount();
    timeline.start = '2026-10-01';
    timeline.count = 5;
    const detach = timeline.attach(scroller());
    const firstUrl = new URL(String(fetch.mock.calls[0][0]), 'http://fixture.test');
    expect(firstUrl.searchParams.get('from')).toBe('2026-10-01T05:00:00.000Z');
    expect(firstUrl.searchParams.get('to')).toBe('2026-10-06T04:59:59.999Z');
    await vi.waitFor(() => expect(timeline.errors).toHaveLength(1));
    await tick();
    expect(within(view.getByTestId('timeline')).getByRole('alert').textContent).toContain(
      'permission denied',
    );
    await fireEvent.click(
      within(view.getByTestId('timeline')).getByRole('button', { name: 'Retry' }),
    );
    await vi.waitFor(() =>
      expect(timeline.bookingsAt('r1', '2026-10-03').map((row) => row.id)).toEqual(['new']),
    );
    expect(timeline.errors).toHaveLength(0);
    expect(fetch.mock.calls[0][0]).toBe(fetch.mock.calls[1][0]);
    detach();
  });
  it('prevents a previous organization reply or error from replacing fresh SSR records', async () => {
    const old = deferred(),
      fresh = deferred();
    const fetch = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    vi.stubGlobal('fetch', fetch);
    const { timeline } = await mount();
    timeline.replaceSource('org-a', [booking('old-seed')], 'America/Lima');
    const detach = timeline.attach(scroller());
    timeline.replaceSource('org-b', [booking('fresh-seed')], 'America/Lima');
    expect((fetch.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    old.resolve(Response.json({ error: 'late deny' }, { status: 403 }));
    await tick();
    await Promise.resolve();
    expect(timeline.errors).toHaveLength(0);
    expect(timeline.bookingsAt('r1', '2026-10-03').map((row) => row.id)).toEqual(['fresh-seed']);
    detach();
    fresh.resolve(Response.json({ bookings: [] }));
    await tick();
    await Promise.resolve();
    expect(timeline.bookingsAt('r1', '2026-10-03').map((row) => row.id)).toEqual(['fresh-seed']);
    expect(timeline.loading).toBe(0);
  });
  it('stops a multi-range retry when its source scope is replaced', async () => {
    const retry = deferred();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: 'first unavailable' }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ error: 'second unavailable' }, { status: 503 }))
      .mockReturnValueOnce(retry.promise)
      .mockResolvedValue(Response.json({ bookings: [] }));
    vi.stubGlobal('fetch', fetch);
    const { timeline } = await mount();
    timeline.replaceSource('org-a', [], 'America/Lima');
    const element = scroller();
    const detach = timeline.attach(element);
    await vi.waitFor(() => expect(timeline.errors).toHaveLength(1));
    element.scrollLeft = 0;
    timeline.onScroll();
    await vi.waitFor(() => expect(timeline.errors).toHaveLength(2));
    const secondOldRange = fetch.mock.calls[1][0];
    const running = timeline.retry();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    timeline.replaceSource('org-b', [], 'America/Lima');
    await tick();
    expect(element.scrollLeft).toBe(timeline.offset);
    expect(timeline.offset).toBeGreaterThan(0);
    retry.resolve(Response.json({ bookings: [] }));
    await running;
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls.slice(2).some(([url]) => url === secondOldRange)).toBe(false);
    expect(timeline.errors).toHaveLength(0);
    detach();
  });
  it('reprojects seeded booking days when the organization timezone changes', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { timeline } = await mount();
    const source = [booking('boundary', '2026-10-02T10:30:00Z')];

    timeline.replaceSource('org-a', source, 'Pacific/Kiritimati');
    expect(timeline.bookingsAt('r1', '2026-10-03').map((row) => row.id)).toEqual(['boundary']);

    timeline.replaceSource('org-a', source, 'Pacific/Honolulu');
    expect(timeline.bookingsAt('r1', '2026-10-03')).toEqual([]);
    expect(timeline.bookingsAt('r1', '2026-10-02').map((row) => row.id)).toEqual(['boundary']);
  });
});
