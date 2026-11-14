// @vitest-environment happy-dom
/**
 * Spec 116 slice 1 (FR-008, FR-012b) — the drawer acts only on the booking it
 * shows. Mounts the real `BookingDetailDrawer` over a stubbed `fetch` whose
 * detail reads can be HELD, then proves:
 *   1. switching A → B while B's read is held renders the loading state and
 *      leaves nothing that writes (no footer verb, no notes field, no A data);
 *   2. a mutation on A whose reload resolves after the switch never replaces
 *      B's detail;
 *   3. completing a visit hands the dialog only its live members.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';

vi.mock('$app/state', async (original) => {
  const actual = await original<typeof import('$app/state')>();
  const { reactivePage } = await import('./__fixtures__/reactive-page.svelte');
  return { ...actual, page: reactivePage({ ...actual.page }) };
});
const { default: BookingDetailDrawer } = await import('./BookingDetailDrawer.svelte');

const TZ = 'America/Lima';
const detailOf = (id: string, attendeeName: string, extra: Record<string, unknown> = {}) => ({
  booking: {
    id,
    status: 'accepted',
    title: null,
    eventTypeId: 'et1',
    resourceId: 'r1',
    productId: null,
    partyId: null,
    startTime: '2026-10-07T14:00:00.000Z',
    endTime: '2026-10-07T15:00:00.000Z',
    attendeeName,
    attendeeEmail: null,
    attendeePhone: null,
    crmContactId: null,
    notes: `${attendeeName} note`,
    clientNote: null,
    updatedAt: '2026-10-07T00:00:00.000Z',
  },
  eventType: { id: 'et1', title: 'Consulta' },
  resource: { id: 'r1', name: 'Leiva', profileId: null },
  contact: null,
  statusHistory: [],
  grant: null,
  plan: null,
  series: null,
  accrual: null,
  tickets: [],
  tags: { own: [], contact: [], service: [] },
  visit: null,
  products: [],
  ...extra,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

interface Net {
  details: Record<string, unknown>;
  /** A held detail read: the next GET of that id waits for `release`. */
  hold: Record<string, ReturnType<typeof deferred<void>>>;
  writes: string[];
  gets: string[];
}
let net: Net;

beforeEach(() => {
  net = { details: {}, hold: {}, writes: [], gets: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method !== 'GET') {
        net.writes.push(`${method} ${url}`);
        return Response.json({ ok: true });
      }
      net.gets.push(url);
      if (url.startsWith('/api/tags')) return Response.json({ tags: [] });
      if (url.startsWith('/api/stock/accruals')) return Response.json({ accruals: [] });
      if (url.startsWith('/api/stock/consumption')) return Response.json([]);
      const id = url.split('/').pop()!;
      const held = net.hold[id];
      if (held) {
        delete net.hold[id];
        await held.promise;
      }
      const d = net.details[id];
      return d ? Response.json(d) : new Response(null, { status: 404 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const props = (bookingId: string) => ({
  bookingId,
  canEdit: true,
  timeZone: TZ,
  mutationScope: 'scheduling:org-a',
  onclose: () => {},
});

describe('BookingDetailDrawer acts on the booking it shows (spec 116 FR-008)', () => {
  it('while B loads: loading state, no writer reachable, no write sent', async () => {
    net.details.A = detailOf('A', 'Ana');
    net.details.B = detailOf('B', 'Beto');
    const view = render(BookingDetailDrawer, props('A'));
    await view.findByRole('button', { name: 'Mark no-show' });

    const holdB = deferred<void>();
    net.hold.B = holdB;
    await view.rerender(props('B'));

    // Whatever is still on screen, nothing may write A while B is selected.
    const noShow = view.queryByRole('button', { name: 'Mark no-show' });
    if (noShow) await fireEvent.click(noShow);
    expect(net.writes).toEqual([]);
    expect(noShow).toBeNull();
    expect(view.container.querySelector('textarea')).toBeNull();
    expect(view.container.textContent).not.toContain('Ana');

    holdB.resolve();
    await waitFor(() => expect(view.container.textContent).toContain('Beto'));
    expect(view.getByRole('button', { name: 'Mark no-show' })).toBeTruthy();
    expect(net.writes).toEqual([]);
  });

  it("a reload of A that lands after the switch never replaces B's detail", async () => {
    net.details.A = detailOf('A', 'Ana');
    net.details.B = detailOf('B', 'Beto');
    const view = render(BookingDetailDrawer, props('A'));
    const noShow = await view.findByRole('button', { name: 'Mark no-show' });

    const reloadA = deferred<void>();
    net.hold.A = reloadA;
    await fireEvent.click(noShow);
    await waitFor(() => expect(net.writes).toEqual(['PATCH /api/scheduling/bookings/A']));
    // A's post-write reload is now in flight; the user moves on to B.
    await waitFor(() => expect(net.gets.filter((u) => u.endsWith('/A'))).toHaveLength(2));
    await view.rerender(props('B'));
    await waitFor(() => expect(view.container.textContent).toContain('Beto'));

    reloadA.resolve();
    await new Promise((r) => setTimeout(r, 0));
    await waitFor(() => expect(view.container.textContent).toContain('Beto'));
    expect(view.container.textContent).not.toContain('Ana');
  });

  it('completing a visit leaves no-show and completed members alone (FR-012b)', async () => {
    const member = (id: string, seq: number, status: string) => ({
      id,
      seq,
      eventTypeId: `et-${id}`,
      eventTypeTitle: `Service ${id}`,
      productId: null,
      minutes: 30,
      status,
      paid: false,
      price: null,
      paidAmount: 0,
      currency: null,
      funding: 'cash',
      ticketIds: [],
      referenced: [],
    });
    net.details.V1 = detailOf('V1', 'Ana', {
      visit: {
        groupId: 'g1',
        members: [
          member('V1', 0, 'accepted'),
          member('V2', 1, 'no_show'),
          member('V3', 2, 'completed'),
          member('V4', 3, 'cancelled'),
        ],
      },
    });
    const view = render(BookingDetailDrawer, props('V1'));
    await fireEvent.click(await view.findByRole('button', { name: 'Mark completed' }));
    await waitFor(() =>
      expect(net.gets.some((u) => u.startsWith('/api/stock/accruals'))).toBe(true),
    );
    const read = net.gets
      .filter((u) => u.startsWith('/api/stock/accruals'))
      .map((u) => new URL(u, 'http://x').searchParams.get('sourceId'));
    expect(read).toEqual(['V1']);
  });
});
