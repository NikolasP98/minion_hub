/**
 * HC-020 — the window payload carries the product category NAME next to its
 * colour, resolved through the same product (own, else the service's) so the
 * calendar can subdivide by category, not only colour by it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The first import loads the real visit grouping (a large module): give it room.
vi.setConfig({ testTimeout: 30_000 });

const state = vi.hoisted(() => ({
  bookings: [] as Array<Record<string, unknown>>,
  categories: new Map<string, { name: string; color: string }>(),
  categoryCalls: [] as string[][],
  ticketLinks: new Map<string, { id: string; humanId: string | null; products?: unknown[] }[]>(),
  ticketLinkCalls: [] as string[][],
}));

vi.mock('$server/services/rbac.service', () => ({
  shouldMaskSensitive: () => Promise.resolve(false),
}));
vi.mock('$server/services/scheduling-bookings.service', async (importOriginal) => ({
  // The real pure visit grouping, so hover and detail agree on direct vs group.
  visitsOfBookings: (await importOriginal<typeof import('./scheduling-bookings.service')>())
    .visitsOfBookings,
  listBookings: () => Promise.resolve(state.bookings),
}));
vi.mock('$server/services/finance-products.service', () => ({
  categoryColorsForProducts: (_ctx: unknown, ids: string[]) => {
    state.categoryCalls.push(ids);
    return Promise.resolve(state.categories);
  },
}));
vi.mock('$server/services/stock-accruals.service', () => ({
  accrualSummaryForSources: () => Promise.resolve([]),
}));
vi.mock('$server/services/tag-links.service', () => ({
  getTagLinks: () => Promise.resolve(new Map()),
  getContactTagsBulk: () => Promise.resolve(new Map()),
}));
vi.mock('$server/services/crm-contacts.service', () => ({
  listTags: () => Promise.resolve([]),
}));
vi.mock('$server/services/pos-accounts.service', () => ({
  listTicketsForCalendar: () => Promise.resolve([]),
  bookingTicketLinks: (_ctx: unknown, ids: string[]) => {
    state.ticketLinkCalls.push(ids);
    return Promise.resolve(state.ticketLinks);
  },
}));

const booking = (id: string, patch: Record<string, unknown>) => ({
  id,
  resourceId: 'r1',
  eventTypeId: 'e-plain',
  startTime: new Date('2026-09-08T13:00:00Z'),
  endTime: new Date('2026-09-08T13:30:00Z'),
  status: 'accepted',
  attendeeName: 'A',
  attendeePhone: null,
  partyId: null,
  productId: null,
  notes: null,
  metadata: null,
  kindId: null,
  crmContactId: null,
  packageGrantId: null,
  paymentPlanId: null,
  ...patch,
});

const ctx = { db: {}, tenantId: 'org-1' } as never;
const locals = {} as App.Locals;
const eventTypes = [
  { id: 'e-plain', productId: null, kindId: null },
  { id: 'e-svc', productId: 'p-service', kindId: null },
];

beforeEach(() => {
  state.bookings = [];
  state.categories = new Map();
  state.categoryCalls = [];
  state.ticketLinks = new Map();
  state.ticketLinkCalls = [];
});

const window = { from: new Date('2026-09-07T05:00:00Z'), to: new Date('2026-09-14T05:00:00Z') };

describe('loadCalendarWindow paid/funding/tickets (spec 2026-10-13 D3)', () => {
  it('marks a booking paid from ONE ticket-link query over the window ids, with its tickets', async () => {
    const { loadCalendarWindow } = await import('./calendar-window.service');
    state.bookings = [
      booking('b-paid', {}),
      booking('b-free', {}),
      booking('b-grant', { packageGrantId: 'g1' }),
      booking('b-plan', { paymentPlanId: 'pl1' }),
    ];
    state.ticketLinks = new Map([['b-paid', [{ id: 't1', humanId: 'POS-0001', products: [] }]]]);
    const { bookings } = await loadCalendarWindow(ctx, locals, {
      ...window,
      eventTypes,
      pos: true,
    });
    expect(Object.fromEntries(bookings.map((b) => [b.id, [b.paid, b.funding, b.tickets]]))).toEqual(
      {
        'b-paid': [true, 'cash', [{ id: 't1', humanId: 'POS-0001' }]],
        'b-free': [false, 'cash', []],
        'b-grant': [false, 'grant', []],
        'b-plan': [false, 'plan', []],
      },
    );
    expect(state.ticketLinkCalls).toEqual([['b-paid', 'b-free', 'b-grant', 'b-plan']]);
  });

  it('never reads tickets for the scheduling calendar (pos: false)', async () => {
    const { loadCalendarWindow } = await import('./calendar-window.service');
    state.bookings = [booking('b1', {})];
    state.ticketLinks = new Map([['b1', [{ id: 't1', humanId: null, products: [] }]]]);
    const { bookings } = await loadCalendarWindow(ctx, locals, {
      ...window,
      eventTypes,
      pos: false,
    });
    expect(bookings[0]).toMatchObject({ paid: false, tickets: [] });
    expect(state.ticketLinkCalls).toEqual([]);
  });

  it('fails soft when the ticket-link read throws: unpaid, calendar still answers', async () => {
    const { loadCalendarWindow } = await import('./calendar-window.service');
    state.bookings = [booking('b1', {})];
    state.ticketLinks = {
      then: (_ok: unknown, fail: (e: Error) => unknown) => fail(new Error('pos off')),
    } as never;
    const { bookings } = await loadCalendarWindow(ctx, locals, {
      ...window,
      eventTypes,
      pos: true,
    });
    expect(bookings[0]).toMatchObject({ id: 'b1', paid: false, tickets: [] });
  });
});

describe('loadCalendarWindow category payload (HC-020)', () => {
  it('emits the category name and colour for a product with a category, null/null without', async () => {
    const { loadCalendarWindow } = await import('./calendar-window.service');
    state.bookings = [
      booking('b-own', { productId: 'p-own' }),
      booking('b-svc', { eventTypeId: 'e-svc' }),
      booking('b-uncat', { productId: 'p-uncat' }),
      booking('b-none', {}),
    ];
    state.categories = new Map([
      ['p-own', { name: 'Laser', color: '#aa0000' }],
      ['p-service', { name: 'Facial', color: '#00aa00' }],
    ]);

    const { bookings } = await loadCalendarWindow(ctx, locals, {
      from: new Date('2026-09-07T05:00:00Z'),
      to: new Date('2026-09-14T05:00:00Z'),
      eventTypes,
      pos: false,
    });
    const byId = Object.fromEntries(
      bookings.map((b) => [b.id, { category: b.category, categoryColor: b.categoryColor }]),
    );
    expect(byId).toEqual({
      'b-own': { category: 'Laser', categoryColor: '#aa0000' },
      'b-svc': { category: 'Facial', categoryColor: '#00aa00' },
      'b-uncat': { category: null, categoryColor: null },
      'b-none': { category: null, categoryColor: null },
    });
    // ONE lookup over the distinct products — no second query for the name.
    expect(state.categoryCalls).toEqual([['p-own', 'p-service', 'p-uncat']]);
  });

  it('fails soft when the category lookup throws: both fields null, calendar still answers', async () => {
    const { loadCalendarWindow } = await import('./calendar-window.service');
    state.bookings = [booking('b-own', { productId: 'p-own' })];
    state.categories = {
      // A rejected promise from the finance module (POS off) must not cost the grid.
      then: (_ok: unknown, fail: (e: Error) => unknown) => fail(new Error('pos off')),
    } as never;
    const { bookings } = await loadCalendarWindow(ctx, locals, {
      from: new Date('2026-09-07T05:00:00Z'),
      to: new Date('2026-09-14T05:00:00Z'),
      eventTypes,
      pos: false,
    });
    expect(bookings[0]).toMatchObject({ id: 'b-own', category: null, categoryColor: null });
  });
});

describe('loadCalendarWindow sold facet (spec 126)', () => {
  const line = (over: Record<string, unknown>) => ({
    ticketId: 't1',
    ticketHumanId: 'POS-1',
    lineId: 'l1',
    productId: 'p-faja',
    bookingId: null,
    description: 'Faja M',
    qty: 1,
    total: 0,
    ...over,
  });
  const member = (id: string, seq: number) =>
    booking(id, { metadata: { groupId: 'g1', groupSeq: seq } });

  it('gives every member of a visit ONE facet: direct/group/unassigned, no other-visit line, money stripped', async () => {
    const { loadCalendarWindow } = await import('./calendar-window.service');
    state.bookings = [member('lead', 0), member('second', 1), booking('other', {})];
    const products = [
      line({ lineId: 'l1' }),
      line({ lineId: 'l2', bookingId: 'lead', description: 'Crema', total: 80 }),
      line({ lineId: 'l3', bookingId: 'second', description: 'Gel', total: 40 }),
      line({ lineId: 'l4', bookingId: 'other', description: 'OTHER VISIT', total: 10 }),
    ];
    state.ticketLinks = new Map([
      ['lead', [{ id: 't1', humanId: 'POS-1', products }]],
      ['second', [{ id: 't1', humanId: 'POS-1', products }]],
    ]);
    const { bookings } = await loadCalendarWindow(ctx, locals, {
      ...window,
      eventTypes,
      pos: true,
      canReadFinancialFields: true,
    });
    const byId = Object.fromEntries(bookings.map((b) => [b.id, b]));
    expect(byId.second!.sold).toEqual(byId.lead!.sold);
    const lead = byId.lead!.sold as {
      value: { rows: { description: string; relation: string; gift: boolean }[] };
    };
    expect(lead.value.rows.map((r) => [r.description, r.relation, r.gift])).toEqual([
      ['Faja M', 'co_ticket_unassigned', true],
      ['Crema', 'direct', false],
      ['Gel', 'group', false],
    ]);
    expect(JSON.stringify(bookings)).not.toContain('OTHER VISIT');
    expect(JSON.stringify(bookings)).not.toContain('"total"');
  });

  it('sends gift null without financial admission, and not_in_slice / denied / read_failed states', async () => {
    const { loadCalendarWindow } = await import('./calendar-window.service');
    state.bookings = [booking('b1', {})];
    state.ticketLinks = new Map([['b1', [{ id: 't1', humanId: null, products: [line({})] }]]]);
    const run = (opts: Record<string, unknown>, foreign?: unknown) =>
      loadCalendarWindow(ctx, locals, { ...window, eventTypes, ...opts, foreign } as never);
    const gift = await run({ pos: true });
    expect(
      (gift.bookings[0]!.sold as { value: { rows: { gift: unknown }[] } }).value.rows[0]!.gift,
    ).toBeNull();
    expect((await run({ pos: false })).bookings[0]!.sold).toEqual({
      state: 'unavailable',
      reason: 'not_in_slice',
    });
    expect(
      (await run({ pos: true }, { pos: { denied: 'pos', verb: 'view' }, stock: ctx, crm: ctx }))
        .bookings[0]!.sold,
    ).toEqual({ state: 'denied' });
    state.ticketLinks = {
      then: (_ok: unknown, fail: (e: Error) => unknown) => fail(new Error('pos off')),
    } as never;
    expect((await run({ pos: true })).bookings[0]!.sold).toEqual({
      state: 'unavailable',
      reason: 'read_failed',
    });
  });
});
