// @vitest-environment happy-dom
/**
 * Spec 126 — the POS appointments PAGE owns three money-bearing surfaces: the direct Charge button, the
 * context menu and the stock chips. The real `PageBody` is mounted with the calendar swapped for a probe
 * that renders its `chips`/`actions` snippets and exposes the menu opener, so the matrix below proves the
 * PAGE's plumbing: nothing reaches the till from a denied, unavailable, stale, malformed or no-target
 * projection, a cached offer is never authority, and no raw cost money is rendered.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import { page } from '$app/state';
import {
  basicMember,
  facetsOf,
  wireDetail,
} from '$lib/components/scheduling/__fixtures__/detail-wire';
import { calendarWindowScope } from '$lib/components/scheduling/calendar-window';
import type {
  BookingProductFacets,
  CalendarProductFacets,
} from '$lib/components/scheduling/booking-product-facets';

const h = vi.hoisted(() => ({ handoff: vi.fn(), toasts: [] as string[] }));
vi.mock('$app/state', async (original) => {
  const actual = await original<typeof import('$app/state')>();
  const { reactivePage } =
    await import('$lib/components/scheduling/__fixtures__/reactive-page.svelte');
  return { ...actual, page: reactivePage({ ...actual.page }) };
});
vi.mock('$app/navigation', async (original) => ({
  ...(await original<typeof import('$app/navigation')>()),
  goto: vi.fn(async () => {}),
  invalidate: vi.fn(async () => {}),
}));
vi.mock('$lib/components/pos/sell-charge-handoff', () => ({
  dispatchSellChargeHandoff: (...a: unknown[]) => h.handoff(...a),
}));
vi.mock('$lib/state/ui/toast.svelte', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toastError: (title: string) => void h.toasts.push(title),
  toastSuccess: vi.fn(),
}));
vi.mock('$lib/components/scheduling/BookingCalendar.svelte', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  default: (await import('$lib/components/scheduling/__fixtures__/PosCalendarProbe.svelte'))
    .default,
}));
const { default: PageBody } = await import('./PageBody.svelte');

const TZ = 'America/Lima';
const scope = calendarWindowScope('org-a', TZ);
type Data = ComponentProps<typeof PageBody>['data'];

const pay = (paid = false): CalendarProductFacets['payment'] => ({
  state: 'available',
  value: { paid, funding: 'cash', tickets: paid ? [{ id: 't1', humanId: 'P-1' }] : [] },
});
const calFacets = (over: Partial<CalendarProductFacets> = {}): CalendarProductFacets => ({
  version: 1,
  sold: { state: 'empty' },
  payment: pay(),
  stock: { state: 'available', value: { anchorAccrual: null } },
  ...over,
});
const cb = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  resourceId: 'r1',
  eventTypeId: 'et1',
  start: '2026-09-08T14:00:00.000Z',
  end: '2026-09-08T15:00:00.000Z',
  status: 'completed',
  attendeeName: 'Ana',
  productFacets: calFacets(),
  ...over,
});

const data = (bookings: unknown[], overlay: unknown = { state: 'empty' }) =>
  ({
    day: '2026-09-08',
    orgTz: TZ,
    calendarScope: scope,
    view: 'week',
    pageView: 'week',
    tagOptions: [],
    productProjectionVersion: 1,
    ticketOverlay: overlay,
    bookings,
    resources: [{ id: 'r1', name: 'Leiva', color: null }],
    hours: {},
    eventTypes: [
      {
        id: 'et1',
        title: 'Consulta',
        productId: 'p-svc',
        active: true,
        length: 60,
        price: 100,
        currency: 'PEN',
        resourceIds: ['r1'],
        color: null,
        kindId: null,
      },
    ],
    kinds: [],
    categories: [],
    stockEnabled: true,
    pending: [],
  }) as unknown as Data;

/** What the detail GET answers per booking id; `undefined` entry = 404. */
let details: Record<string, unknown>;
let gets: { url: string; version: string | null }[];

beforeEach(() => {
  h.handoff.mockClear();
  h.toasts.length = 0;
  gets = [];
  details = {};
  page.data = {
    activeOrgId: 'org-a',
    user: { id: 'u1' },
    permissions: {
      permissions: [
        'pos:view',
        'pos:edit',
        'pos:create',
        'pos:manage',
        'scheduling:view',
        'scheduling:edit',
      ],
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/pos/appointments?'))
        return Response.json({
          calendarScope: scope,
          productProjectionVersion: 1,
          bookings: [],
          tagOptions: [],
          ticketOverlay: { state: 'empty' },
        });
      const id = url.split('/').pop()!;
      if (url.startsWith('/api/pos/appointments/')) {
        gets.push({
          url,
          version: new Headers(init?.headers).get('X-Minion-Booking-Products-Version'),
        });
        const d = details[id];
        if (d === 409) return Response.json({ error: 'refresh_required' }, { status: 409 });
        return d ? Response.json(d) : new Response(null, { status: 404 });
      }
      return new Response(null, { status: 404 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  page.data = {};
});

const chargeBtn = (view: { container: HTMLElement }, id: string) =>
  Array.from(view.container.querySelectorAll<HTMLButtonElement>(`[data-b="${id}"] button`)).find(
    (b) => b.textContent?.trim() === 'Charge',
  );

/** A detail whose anchor service is unpaid (chargeable) by default. */
const detailFor = (
  id: string,
  facets?: BookingProductFacets,
  booking: Record<string, unknown> = {},
) =>
  wireDetail(id, 'Ana', facets ?? facetsOf([basicMember(id, 0, { status: 'completed' })]), {
    status: 'completed',
    ...booking,
  });

describe('direct Charge (spec 126 T022)', () => {
  it('is offered only for a completed booking with an AVAILABLE payment facet', async () => {
    const view = render(PageBody, {
      data: data([
        cb('A'),
        cb('denied', { productFacets: calFacets({ payment: { state: 'denied' } }) }),
        cb('unavail', {
          productFacets: calFacets({ payment: { state: 'unavailable', reason: 'read_failed' } }),
        }),
        cb('malformed', {
          productFacets: calFacets({
            payment: { state: 'available', value: { paid: 'x' } } as never,
          }),
        }),
        cb('legacy', { productFacets: undefined }),
        cb('accepted', { status: 'accepted' }),
      ]),
    });
    expect(chargeBtn(view, 'A')).toBeTruthy();
    for (const id of ['denied', 'unavail', 'malformed', 'legacy', 'accepted'])
      expect(chargeBtn(view, id), id).toBeUndefined();
  });

  it('is offered even when the cached row reads paid (the guarded detail decides: products-only handoff)', async () => {
    const view = render(PageBody, {
      data: data([cb('A', { paid: true, productFacets: calFacets({ payment: pay(true) }) })]),
    });
    expect(chargeBtn(view, 'A')).toBeTruthy();
  });

  it('re-fetches the versioned detail and hands the till the guarded offer', async () => {
    details.A = detailFor('A');
    const view = render(PageBody, { data: data([cb('A')]) });
    await fireEvent.click(chargeBtn(view, 'A')!);
    await waitFor(() => expect(h.handoff).toHaveBeenCalledTimes(1));
    expect(gets).toEqual([{ url: '/api/pos/appointments/A', version: '1' }]);
    const input = h.handoff.mock.calls[0]![0].input;
    expect(input.lines).toEqual([{ bookingId: 'A', productId: 'p-svc', title: 'Consulta' }]);
    expect(input.planId).toBeNull();
  });

  it('a visit: the click is routed to the server anchor, never the clicked member', async () => {
    details['lead'] = detailFor(
      'lead',
      facetsOf(
        [
          basicMember('lead', 0, { status: 'completed' }),
          basicMember('two', 1, { status: 'completed' }),
        ],
        {},
        'g1',
      ),
    );
    const view = render(PageBody, {
      data: data([
        cb('two', { groupId: 'g1', groupSeq: 1 }),
        cb('lead', { groupId: 'g1', groupSeq: 0 }),
      ]),
    });
    await fireEvent.click(chargeBtn(view, 'two')!);
    await waitFor(() => expect(h.handoff).toHaveBeenCalledTimes(1));
    expect(gets.map((g) => g.url)).toEqual(['/api/pos/appointments/lead']);
    expect(
      h.handoff.mock.calls[0]![0].input.lines.map((l: { bookingId: string }) => l.bookingId),
    ).toEqual(['lead', 'two']);
  });

  it.each([
    [
      'payment denied now (a cached offer is not authority)',
      () =>
        detailFor(
          'A',
          facetsOf([basicMember('A', 0, { status: 'completed' })], {
            payment: { state: 'denied' },
          }),
        ),
    ],
    [
      'payment unavailable',
      () =>
        detailFor(
          'A',
          facetsOf([basicMember('A', 0, { status: 'completed' })], {
            payment: { state: 'unavailable', reason: 'read_failed' },
          }),
        ),
    ],
    [
      'payment empty for a nonempty visit',
      () =>
        detailFor(
          'A',
          facetsOf([basicMember('A', 0, { status: 'completed' })], { payment: { state: 'empty' } }),
        ),
    ],
    [
      'basic unavailable (no anchor)',
      () =>
        detailFor(
          'A',
          facetsOf([basicMember('A')], { basic: { state: 'unavailable', reason: 'read_failed' } }),
        ),
    ],
    ['old protocol (no productFacets)', () => ({ booking: { id: 'A' }, tickets: [], visit: null })],
    [
      'unsupported version',
      () => ({ ...detailFor('A'), productFacets: { ...detailFor('A').productFacets, version: 2 } }),
    ],
    ['409 refresh_required', () => 409],
  ])('opens nothing and fabricates no cart line on: %s', async (_n, build) => {
    details.A = build();
    const view = render(PageBody, { data: data([cb('A')]) });
    await fireEvent.click(chargeBtn(view, 'A')!);
    await waitFor(() => expect(h.toasts.length).toBeGreaterThan(0));
    expect(h.handoff).not.toHaveBeenCalled();
  });

  it('no target (everything paid, no unpaid product) hands off nothing, with its own message', async () => {
    const f = facetsOf([basicMember('A', 0, { status: 'completed' })]);
    if (f.payment.state === 'available')
      f.payment.value.services[0] = {
        ...f.payment.value.services[0]!,
        paid: true,
        paidAmount: 100,
      };
    details.A = detailFor('A', f);
    const view = render(PageBody, { data: data([cb('A')]) });
    await fireEvent.click(chargeBtn(view, 'A')!);
    await waitFor(() => expect(h.toasts).toContain('Nothing left to charge on this appointment.'));
    expect(h.handoff).not.toHaveBeenCalled();
  });

  it('a free (price 0) service is never charged, and products-only hand off with NO fabricated service', async () => {
    const f = facetsOf([basicMember('A', 0, { status: 'completed' })], {
      planned: {
        state: 'available',
        value: { rows: [{ productId: 'p1', name: 'Crema', qty: 2 }] },
      },
    });
    if (f.payment.state === 'available') {
      f.payment.value.services[0] = { ...f.payment.value.services[0]!, paid: true, price: 0 };
      f.payment.value.planned = [
        { productId: 'p1', name: 'Crema', unitPrice: 5, qty: 2, paid: false },
      ];
    }
    details.A = detailFor('A', f);
    const view = render(PageBody, { data: data([cb('A')]) });
    await fireEvent.click(chargeBtn(view, 'A')!);
    await waitFor(() => expect(h.handoff).toHaveBeenCalledTimes(1));
    const input = h.handoff.mock.calls[0]![0].input;
    expect(input.lines).toEqual([
      { bookingId: 'A', productId: 'p1', title: 'Crema', kind: 'product', qty: 2 },
    ]);
  });

  it('the verified open instalment plan keeps its fallback handoff and passes the plan id', async () => {
    const f = facetsOf([basicMember('A', 0, { status: 'completed' })]);
    if (f.payment.state === 'available') {
      f.payment.value.services[0] = { ...f.payment.value.services[0]!, funding: 'plan' };
      f.payment.value.plan = {
        plan: { id: 'plan-1', title: 'Plan', totalAmount: '300', currency: 'PEN', status: 'open' },
        paidToDate: 100,
        remaining: 200,
        isPaid: false,
        nextDue: null,
        scheduleIssue: null,
      };
    }
    details.A = detailFor('A', f);
    const view = render(PageBody, { data: data([cb('A')]) });
    await fireEvent.click(chargeBtn(view, 'A')!);
    await waitFor(() => expect(h.handoff).toHaveBeenCalledTimes(1));
    expect(h.handoff.mock.calls[0]![0].input.planId).toBe('plan-1');
  });
});

describe('context menu (spec 126 T021/T022)', () => {
  const open = async (
    view: { container: HTMLElement; findAllByRole: (r: 'menuitem') => Promise<HTMLElement[]> },
    id: string,
  ) => {
    await fireEvent.click(view.container.querySelector(`[data-ctx="${id}"]`)!);
    return (await view.findAllByRole('menuitem')).map((e) => e.textContent?.trim());
  };

  it('offers Charge and Delete from an available payment facet, and Charge runs the guarded handoff', async () => {
    details.A = detailFor('A', facetsOf([basicMember('A')]));
    const view = render(PageBody, { data: data([cb('A', { status: 'accepted' })]) });
    expect(await open(view, 'A')).toEqual(['Charge', 'Delete']);
    await fireEvent.click(await view.findByRole('menuitem', { name: 'Charge' }));
    await waitFor(() => expect(h.handoff).toHaveBeenCalledTimes(1));
  });

  it.each([
    ['denied', { state: 'denied' }],
    ['unavailable', { state: 'unavailable', reason: 'read_failed' }],
    ['not in slice', { state: 'unavailable', reason: 'not_in_slice' }],
  ])(
    '%s payment: no charge, sale, delete or cancel-paid is offered (only View details)',
    async (_n, payment) => {
      const view = render(PageBody, {
        data: data([
          cb('A', {
            status: 'accepted',
            paid: undefined,
            productFacets: calFacets({ payment: payment as never }),
          }),
        ]),
      });
      const items = await open(view, 'A');
      for (const forbidden of ['Charge', 'Delete', 'Cancel and void', 'Correct the sale'])
        expect(items).not.toContain(forbidden);
      expect(h.handoff).not.toHaveBeenCalled();
      expect(gets).toEqual([]);
    },
  );

  it('a menu opened on an available row whose detail later denies payment still opens no till', async () => {
    details.A = detailFor('A', facetsOf([basicMember('A')], { payment: { state: 'denied' } }));
    const view = render(PageBody, { data: data([cb('A', { status: 'accepted' })]) });
    await open(view, 'A');
    await fireEvent.click(await view.findByRole('menuitem', { name: 'Charge' }));
    await waitFor(() => expect(h.toasts.length).toBeGreaterThan(0));
    expect(h.handoff).not.toHaveBeenCalled();
  });
});

describe('stock chips and the ticket overlay (spec 126 T022)', () => {
  it('shows quantity-only counts on the visit lead, never an estimated/realized money chip', async () => {
    const stock = (open: number) =>
      calFacets({
        stock: {
          state: 'available',
          value: { anchorAccrual: { open, realized: 0, released: 0, realizedEntryId: null } },
        },
      });
    const view = render(PageBody, {
      data: data([
        cb('lead', { groupId: 'g', groupSeq: 0, productFacets: stock(2) }),
        cb('two', { groupId: 'g', groupSeq: 1, productFacets: stock(2) }),
      ]),
    });
    const text = (id: string) => view.container.querySelector(`[data-b="${id}"]`)!.textContent!;
    expect(text('lead')).toContain('2 to post');
    expect(text('two')).not.toContain('to post'); // the anchor's counts are not repeated on a member
    expect(view.container.textContent).not.toMatch(/S\/|PEN|committed|\d+\.\d{2}/);
  });

  it('denied, unavailable and missing stock facets show no chip and no zero', async () => {
    const view = render(PageBody, {
      data: data([
        cb('a', { productFacets: calFacets({ stock: { state: 'denied' } }) }),
        cb('b', {
          productFacets: calFacets({ stock: { state: 'unavailable', reason: 'capacity' } }),
        }),
        cb('c', { productFacets: undefined }),
      ]),
    });
    for (const id of ['a', 'b', 'c'])
      expect(view.container.querySelector(`[data-b="${id}"]`)!.textContent).not.toMatch(
        /post|posted|released/,
      );
  });

  it('the overlay prop is drawn only from an available or empty facet; denied/unavailable never become []', async () => {
    const row = {
      id: 't',
      humanId: null,
      at: '2026-09-08T14:00:00.000Z',
      total: 5,
      currency: 'PEN',
      customerName: null,
      lines: [],
    };
    const probe = (overlay: unknown) =>
      render(PageBody, { data: data([cb('A')], overlay) })
        .container.querySelector('[data-probe]')!
        .getAttribute('data-invoices');
    expect(probe({ state: 'available', value: { rows: [row] } })).toBe('1');
    cleanup();
    expect(probe({ state: 'empty' })).toBe('0');
    cleanup();
    expect(probe({ state: 'denied' })).toBe('none');
    cleanup();
    expect(probe({ state: 'unavailable', reason: 'capacity' })).toBe('none');
  });
});

describe('window fetches (spec 126 T022)', () => {
  it('sends the version header and refuses an old-protocol or legacy-key response (nothing cached)', async () => {
    const calls: (string | null)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).startsWith('/api/pos/appointments?')) {
          calls.push(new Headers(init?.headers).get('X-Minion-Booking-Products-Version'));
          return Response.json({
            calendarScope: scope,
            bookings: [cb('LEGACY')],
            tagOptions: [],
            invoices: [],
            accrualSummaries: [],
          });
        }
        return new Response(null, { status: 404 });
      }),
    );
    const view = render(PageBody, { data: data([cb('A')]) });
    await fireEvent.click(view.container.querySelector('[data-range]')!); // scroll to an unloaded week
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls.every((v) => v === '1')).toBe(true);
    expect(view.container.querySelector('[data-b="LEGACY"]')).toBeNull();
  });
});
