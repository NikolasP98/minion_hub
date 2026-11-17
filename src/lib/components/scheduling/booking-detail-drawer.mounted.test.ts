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
import { page } from '$app/state';
import { basicMember, facetsOf, wireDetail } from './__fixtures__/detail-wire';
import type {
  BasicVisitMember,
  BookingProductFacets,
  SoldProductBasic,
} from './booking-product-facets';
const { default: BookingDetailDrawer } = await import('./BookingDetailDrawer.svelte');

const TZ = 'America/Lima';
/** `extra.facets` overrides facets; `extra.booking` overrides booking fields. */
const detailOf = (
  id: string,
  attendeeName: string,
  extra: {
    facets?: Partial<BookingProductFacets>;
    booking?: Record<string, unknown>;
    members?: BasicVisitMember[];
    groupId?: string;
  } = {},
) =>
  wireDetail(
    id,
    attendeeName,
    facetsOf(extra.members ?? [basicMember(id)], extra.facets, extra.groupId ?? null),
    extra.booking,
  );

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
    const member = (id: string, seq: number, status: string) =>
      basicMember(id, seq, {
        eventTypeId: `et-${id}`,
        eventTypeTitle: `Service ${id}`,
        minutes: 30,
        status,
      });
    net.details.V1 = detailOf('V1', 'Ana', {
      groupId: 'g1',
      members: [
        member('V1', 0, 'accepted'),
        member('V2', 1, 'no_show'),
        member('V3', 2, 'completed'),
        member('V4', 3, 'cancelled'),
      ],
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

describe('BookingDetailDrawer sold facet (spec 126)', () => {
  const soldRow = (over: Partial<SoldProductBasic> = {}): SoldProductBasic => ({
    ticketId: 't1',
    lineId: 'l1',
    productId: 'p-faja',
    bookingId: null,
    ticketHumanId: 'POS-7',
    description: 'Faja M',
    qty: 1,
    relation: 'co_ticket_unassigned',
    gift: true,
    ...over,
  });

  it('shows the unassigned Faja M as SOLD on its sale, never as planned, with the gift label', async () => {
    net.details.A = detailOf('A', 'Ana', {
      facets: { sold: { state: 'available', value: { rows: [soldRow()] } } },
    });
    const view = render(BookingDetailDrawer, props('A'));
    await view.findByText('Sold with this visit');
    const text = view.container.textContent!;
    expect(text).toContain('1 × Faja M');
    expect(text).toContain('(gift)');
    expect(text).toContain('Sale POS-7');
    expect(text).toContain('not assigned to a service');
    // The planned section stays its own, empty list.
    expect(text).toContain('Products are optional');
  });

  it('keeps two same-description lines, and hides the gift label when the server sent null', async () => {
    net.details.A = detailOf('A', 'Ana', {
      facets: {
        sold: {
          state: 'available',
          value: {
            rows: [
              soldRow({ gift: null }),
              soldRow({ lineId: 'l2', gift: null, relation: 'direct' }),
            ],
          },
        },
      },
    });
    const view = render(BookingDetailDrawer, props('A'));
    await view.findByText('Sold with this visit');
    expect(view.container.querySelectorAll('.sold-row')).toHaveLength(2);
    expect(view.container.textContent).not.toContain('(gift)');
  });

  it.each([
    ['empty', { state: 'empty' }, 'No products were sold on the linked sale.'],
    ['denied', { state: 'denied' }, 'cannot see the sales linked'],
    ['unavailable', { state: 'unavailable', reason: 'read_failed' }, 'could not be loaded'],
    ['missing', undefined, 'could not be loaded'],
    ['malformed', { state: 'available', value: { rows: [{}] } }, 'could not be loaded'],
  ])('renders %s as its own state, not as an empty list', async (_n, sold, expected) => {
    net.details.A = detailOf('A', 'Ana', { facets: { sold: sold as never } });
    const view = render(BookingDetailDrawer, props('A'));
    await view.findByText('Sold with this visit');
    expect(view.container.textContent).toContain(expected);
    expect(view.container.querySelectorAll('.sold-row')).toHaveLength(0);
  });
});

const recoveryStock = (recovery: unknown) =>
  ({ state: 'available', value: { anchorAccrual: null, recovery } }) as never;

describe('BookingDetailDrawer stock recovery action (spec 126 US2)', () => {
  const member = (bookingId: string, over: Record<string, unknown> = {}) => ({
    bookingId,
    status: 'completed',
    openCount: 0,
    realizedCount: 0,
    releasedCount: 0,
    sourceEntry: null,
    eligibility: 'not_needed',
    confirmation: null,
    ...over,
  });
  const saved = member('A', {
    eligibility: 'retry_saved',
    sourceEntry: { id: 'entry-1', status: 'draft' },
  });
  const recoverBtn = (view: {
    queryByRole: (r: 'button', o: { name: string }) => HTMLElement | null;
  }) => view.queryByRole('button', { name: 'Recover stock' });

  it('offers the action after a reload from persisted facts, and retries without touching the status', async () => {
    net.details.A = detailOf('A', 'Ana', {
      booking: { status: 'completed' },
      members: [basicMember('A', 0, { status: 'completed' })],
      facets: { stock: recoveryStock({ state: 'available', value: [saved] }) },
    });
    const view = render(BookingDetailDrawer, props('A'));
    await fireEvent.click(await view.findByRole('button', { name: 'Recover stock' }));
    await view.findByRole('button', { name: 'Retry stock posting' });
    await waitFor(() =>
      expect(
        (view.getByRole('button', { name: 'Retry stock posting' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    await fireEvent.click(view.getByRole('button', { name: 'Retry stock posting' }));
    await waitFor(() => expect(net.writes).toEqual(['POST /api/scheduling/bookings/A/complete']));
    // The visit status endpoint (PATCH) was never called, and the detail was re-read.
    expect(net.writes.some((w) => w.startsWith('PATCH'))).toBe(false);
    expect(net.gets.filter((u) => u.endsWith('/A')).length).toBeGreaterThan(2);
  });

  it.each([
    ['nothing to recover', { state: 'available', value: [member('A', { realizedCount: 1 })] }],
    ['denied', { state: 'denied' }],
    ['unavailable', { state: 'unavailable', reason: 'read_failed' }],
    ['missing', undefined],
    ['malformed', { state: 'available', value: [{ bookingId: 'A' }] }],
    [
      'manual review only',
      { state: 'available', value: [member('A', { eligibility: 'manual_review' })] },
    ],
  ])('offers no action for %s', async (_n, stockRecovery) => {
    net.details.A = detailOf('A', 'Ana', { facets: { stock: recoveryStock(stockRecovery) } });
    const view = render(BookingDetailDrawer, props('A'));
    await view.findByText('Sold with this visit');
    expect(recoverBtn(view)).toBeNull();
  });

  it('confirm_open needs stock:manage: hidden without it, offered with it', async () => {
    const open = member('A', {
      eligibility: 'confirm_open',
      openCount: 1,
      confirmation: {
        state: 'available',
        value: {
          openCount: 1,
          expectedOpenFingerprint: 'a'.repeat(64),
          rows: [
            {
              accrualId: 'acc1',
              itemId: 'item1',
              itemName: 'Serum',
              uom: 'bottle',
              consumptionUom: 'ml',
              unitsPerStockUom: 50,
              subunitsPerStockUom: null,
              diagramEnabled: false,
              qty: 0.2,
              qtyConsumption: 10,
            },
          ],
        },
      },
    });
    net.details.A = detailOf('A', 'Ana', {
      booking: { status: 'completed' },
      members: [basicMember('A', 0, { status: 'completed' })],
      facets: { stock: recoveryStock({ state: 'available', value: [open] }) },
    });
    const saveData = page.data;
    try {
      page.data = { ...saveData, permissions: { permissions: ['scheduling:edit'] } };
      const noManage = render(BookingDetailDrawer, props('A'));
      await noManage.findByText('Sold with this visit');
      expect(recoverBtn(noManage)).toBeNull();
      cleanup();
      page.data = {
        ...saveData,
        permissions: { permissions: ['scheduling:edit', 'stock:manage'] },
      };
      const withManage = render(BookingDetailDrawer, props('A'));
      await withManage.findByRole('button', { name: 'Recover stock' });
    } finally {
      page.data = saveData;
    }
  });

  it('offers no action to a viewer who cannot edit', async () => {
    net.details.A = detailOf('A', 'Ana', {
      facets: { stock: recoveryStock({ state: 'available', value: [saved] }) },
    });
    const view = render(BookingDetailDrawer, { ...props('A'), canEdit: false });
    await view.findByText('Sold with this visit');
    expect(recoverBtn(view)).toBeNull();
  });
});

describe('BookingDetailDrawer versioned wire and payment facet (spec 126)', () => {
  const paid = {
    state: 'available',
    value: {
      services: [
        {
          bookingId: 'A',
          paid: true,
          price: 100,
          paidAmount: 100,
          currency: 'PEN',
          funding: 'cash',
          ticketIds: ['t1'],
        },
      ],
      planned: [],
      soldTotals: [],
      tickets: [],
      bookingInvoiceId: null,
      grant: null,
      plan: null,
      accrualCost: { state: 'empty' },
    },
  } as never;

  it('sends the version header on every detail GET', async () => {
    const seen: (string | null)[] = [];
    net.details.A = detailOf('A', 'Ana');
    const inner = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/A'))
        seen.push(new Headers(init?.headers).get('X-Minion-Booking-Products-Version'));
      return inner(input, init);
    });
    const view = render(BookingDetailDrawer, props('A'));
    await view.findByText('Sold with this visit');
    expect(seen).toEqual(['1']);
  });

  it('shows the real money and paid badge only from an available payment facet', async () => {
    net.details.A = detailOf('A', 'Ana', { facets: { payment: paid } });
    const view = render(BookingDetailDrawer, props('A'));
    await view.findByText('Sold with this visit');
    expect(view.container.querySelector('.svc-money')!.textContent).toContain('100');
    expect(view.container.textContent).toContain('Paid');
  });

  it.each([
    ['denied', { state: 'denied' }, 'cannot see the payment details'],
    ['unavailable', { state: 'unavailable', reason: 'read_failed' }, 'could not be loaded'],
    ['empty for a nonempty visit', { state: 'empty' }, 'could not be loaded'],
    ['malformed', { state: 'available', value: { services: [] } }, 'could not be loaded'],
  ])(
    '%s payment: no money, no paid/unpaid badge, no charge, structure intact',
    async (_n, payment, text) => {
      net.details.A = detailOf('A', 'Ana', { facets: { payment: payment as never } });
      const view = render(BookingDetailDrawer, { ...props('A'), onpay: vi.fn() });
      await view.findByText('Sold with this visit');
      const t = view.container.textContent!;
      expect(t).toContain(text);
      expect(view.container.querySelector('.svc-money')!.textContent!.trim()).toBe('');
      expect(t).not.toContain('Unpaid');
      expect(t).not.toContain('Take payment');
      expect(t).toContain('Consulta'); // basic names stay
    },
  );

  it('an old protocol answer (409) shows nothing of the source and no writer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'refresh_required' }, { status: 409 })),
    );
    const view = render(BookingDetailDrawer, props('A'));
    await waitFor(() => expect(view.container.textContent).not.toContain('Ana'));
    expect(view.queryByRole('button', { name: 'Mark no-show' })).toBeNull();
    // The reason is the translated refresh message, never the raw code.
    await waitFor(() => expect(view.container.textContent).toContain('out of date'));
    expect(view.container.textContent).not.toContain('refresh_required');
  });
});
