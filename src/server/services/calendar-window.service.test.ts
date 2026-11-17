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
  anchors: new Map<string, unknown>(),
  anchorCalls: [] as string[][],
  anchorFail: '' as string,
  tickets: [] as unknown[],
  ticketsFail: false,
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
  stockAnchorForBookings: (_c: unknown, ids: string[]) => {
    state.anchorCalls.push(ids);
    if (state.anchorFail) return Promise.reject(new Error(state.anchorFail));
    return Promise.resolve(state.anchors);
  },
}));
vi.mock('$server/services/tag-links.service', () => ({
  getTagLinks: () => Promise.resolve(new Map()),
  getContactTagsBulk: () => Promise.resolve(new Map()),
}));
vi.mock('$server/services/crm-contacts.service', () => ({
  listTags: () => Promise.resolve([]),
}));
vi.mock('$server/services/pos-accounts.service', () => ({
  listTicketsForCalendar: () =>
    state.ticketsFail ? Promise.reject(new Error('x')) : Promise.resolve(state.tickets),
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
  state.anchors = new Map();
  state.anchorCalls = [];
  state.anchorFail = '';
  state.tickets = [];
  state.ticketsFail = false;
});

const all = { pos: ctx, stock: ctx, crm: ctx };
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
      foreign: all,
      pos: true,
      canReadFinancialFields: true,
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
      foreign: all,
      pos: false,
    });
    // The scheduling host: no money, sold or stock facet, and no legacy alias at all.
    expect(bookings[0]!.productFacets).toEqual({
      version: 1,
      sold: { state: 'unavailable', reason: 'not_in_slice' },
      payment: { state: 'unavailable', reason: 'not_in_slice' },
      stock: { state: 'unavailable', reason: 'not_in_slice' },
    });
    expect(bookings[0]).not.toHaveProperty('paid');
    expect(bookings[0]).not.toHaveProperty('funding');
    expect(bookings[0]).not.toHaveProperty('tickets');
    expect(state.ticketLinkCalls).toEqual([]);
    expect(state.anchorCalls).toEqual([]);
  });

  it('a failed ticket-link read is unavailable, never unpaid; the calendar still answers', async () => {
    const { loadCalendarWindow } = await import('./calendar-window.service');
    state.bookings = [booking('b1', {})];
    state.ticketLinks = {
      then: (_ok: unknown, fail: (e: Error) => unknown) => fail(new Error('pos off')),
    } as never;
    const { bookings } = await loadCalendarWindow(ctx, locals, {
      ...window,
      eventTypes,
      foreign: all,
      pos: true,
      canReadFinancialFields: true,
    });
    expect(bookings[0]).toMatchObject({ id: 'b1' });
    expect(bookings[0]!.productFacets!.payment).toEqual({
      state: 'unavailable',
      reason: 'read_failed',
    });
    expect(bookings[0]).not.toHaveProperty('paid');
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
      foreign: all,
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
      foreign: all,
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
      foreign: all,
      pos: true,
      canReadFinancialFields: true,
    });
    const byId = Object.fromEntries(bookings.map((b) => [b.id, b]));
    expect(byId.second!.productFacets!.sold).toEqual(byId.lead!.productFacets!.sold);
    const lead = byId.lead!.productFacets!.sold as {
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
      loadCalendarWindow(ctx, locals, {
        ...window,
        eventTypes,
        ...opts,
        foreign: foreign ?? all,
      } as never);
    const gift = await run({ pos: true });
    expect(
      (gift.bookings[0]!.productFacets!.sold as { value: { rows: { gift: unknown }[] } }).value
        .rows[0]!.gift,
    ).toBeNull();
    expect((await run({ pos: false })).bookings[0]!.productFacets!.sold).toEqual({
      state: 'unavailable',
      reason: 'not_in_slice',
    });
    expect(
      (await run({ pos: true }, { pos: { denied: 'pos', verb: 'view' }, stock: ctx, crm: ctx }))
        .bookings[0]!.productFacets!.sold,
    ).toEqual({ state: 'denied' });
    state.ticketLinks = {
      then: (_ok: unknown, fail: (e: Error) => unknown) => fail(new Error('pos off')),
    } as never;
    expect((await run({ pos: true })).bookings[0]!.productFacets!.sold).toEqual({
      state: 'unavailable',
      reason: 'read_failed',
    });
  });
});

describe('loadCalendarWindow payment, stock and overlay facets (spec 126)', () => {
  const run = (opts: Record<string, unknown>, foreign?: unknown) =>
    import('./calendar-window.service').then((m) =>
      m.loadCalendarWindow(ctx, locals, {
        ...window,
        eventTypes,
        ...opts,
        // `undefined` = all admitted; `null` = omitted entirely (fail-closed case)
        ...(foreign === null ? {} : { foreign: foreign ?? all }),
      } as never),
    );
  const denied = (module: string) => ({ denied: module, verb: 'view' });

  it('without finance admission: payment denied, NO paid/funding/tickets alias, overlay denied', async () => {
    state.bookings = [booking('b1', {})];
    state.ticketLinks = new Map([['b1', [{ id: 't1', humanId: 'P-1', products: [] }]]]);
    const out = await run({ pos: true, canReadFinancialFields: false });
    expect(out.bookings[0]!.productFacets!.payment).toEqual({ state: 'denied' });
    expect(out.bookings[0]).not.toHaveProperty('paid');
    expect(out.bookings[0]).not.toHaveProperty('tickets');
    expect(out.ticketOverlay).toEqual({ state: 'denied' });
    expect(JSON.stringify(out)).not.toContain('invoices');
    expect(JSON.stringify(out)).not.toContain('accrualSummaries');
  });

  it('with admission: reduced payment facet and aliases come from the SAME admitted facts', async () => {
    state.bookings = [booking('b1', { packageGrantId: 'g1' }), booking('b2', {})];
    state.ticketLinks = new Map([['b1', [{ id: 't1', humanId: 'P-1', products: [] }]]]);
    const out = await run({ pos: true, canReadFinancialFields: true });
    expect(out.bookings[0]!.productFacets!.payment).toEqual({
      state: 'available',
      value: { paid: true, funding: 'grant', tickets: [{ id: 't1', humanId: 'P-1' }] },
    });
    expect(out.bookings[1]).toMatchObject({ paid: false, funding: 'cash', tickets: [] });
  });

  it('stock facet: anchor counts keyed by the server-resolved anchor, one read, cost-free', async () => {
    state.bookings = [
      booking('lead', { metadata: { groupId: 'g', groupSeq: 0 } }),
      booking('second', { metadata: { groupId: 'g', groupSeq: 1 } }),
    ];
    state.anchors = new Map([
      ['lead', { open: 2, realized: 0, released: 0, realizedEntryId: null }],
    ]);
    const out = await run({ pos: true, canReadFinancialFields: true });
    expect(state.anchorCalls).toEqual([['lead']]);
    for (const b of out.bookings)
      expect(b.productFacets!.stock).toEqual({
        state: 'available',
        value: { anchorAccrual: { open: 2, realized: 0, released: 0, realizedEntryId: null } },
      });
  });

  it('stock denied / failed / over capacity are their own states, never "no accrual"', async () => {
    state.bookings = [booking('b1', {})];
    expect(
      (await run({ pos: true }, { pos: ctx, stock: denied('stock'), crm: ctx })).bookings[0]!
        .productFacets!.stock,
    ).toEqual({ state: 'denied' });
    state.anchorFail = 'boom';
    expect((await run({ pos: true })).bookings[0]!.productFacets!.stock).toEqual({
      state: 'unavailable',
      reason: 'read_failed',
    });
    state.anchorFail = 'capacity';
    const out = await run({ pos: true });
    expect(out.bookings).toHaveLength(1); // the bookings are never truncated
    expect(out.bookings[0]!.productFacets!.stock).toEqual({
      state: 'unavailable',
      reason: 'capacity',
    });
  });

  it('carries the version and the overlay key; the old namespaces are gone', async () => {
    state.bookings = [];
    const out = await run({ pos: true, canReadFinancialFields: true });
    expect(out.productProjectionVersion).toBe(1);
    expect(Object.keys(out).sort()).toEqual([
      'bookings',
      'productProjectionVersion',
      'tagOptions',
      'ticketOverlay',
    ]);
  });

  it('ticketOverlay: empty, rows, capacity and a failed read are four different answers', async () => {
    const t = (i: number) => ({
      id: `t${i}`,
      humanId: null,
      submittedAt: new Date('2026-09-08T14:00:00Z'),
      total: '10.00',
      currency: 'PEN',
      customerName: null,
      lines: [],
    });
    const ov = async () => (await run({ pos: true, canReadFinancialFields: true })).ticketOverlay;
    expect(await ov()).toEqual({ state: 'empty' });
    state.tickets = [t(1)];
    expect(await ov()).toMatchObject({
      state: 'available',
      value: { rows: [{ id: 't1', total: 10 }] },
    });
    state.tickets = Array.from({ length: 2000 }, (_, i) => t(i));
    expect(await ov()).toEqual({ state: 'unavailable', reason: 'capacity' });
    state.ticketsFail = true;
    expect(await ov()).toEqual({ state: 'unavailable', reason: 'read_failed' });
  });

  it('FAIL CLOSED: an omitted foreign (or member) is denied: no stock, crm or pos read through the scheduling ctx', async () => {
    state.bookings = [booking('b1', {})];
    state.ticketLinks = new Map([['b1', [{ id: 't1', humanId: null, products: [] }]]]);
    const none = await run({ pos: true, canReadFinancialFields: true }, null);
    expect(state.anchorCalls).toEqual([]);
    expect(state.ticketLinkCalls).toEqual([]);
    expect(none.bookings[0]!.productFacets).toMatchObject({
      sold: { state: 'denied' },
      payment: { state: 'denied' },
      stock: { state: 'denied' },
    });
    expect(none.bookings[0]).not.toHaveProperty('paid');
    expect(none.ticketOverlay).toEqual({ state: 'denied' });
    // a partial foreign: only what is passed is read
    await run({ pos: true, canReadFinancialFields: true }, { pos: ctx });
    expect(state.anchorCalls).toEqual([]);
    expect(state.ticketLinkCalls).toHaveLength(1);
  });

  it('a denied stock handle never calls stockAnchorForBookings', async () => {
    state.bookings = [booking('b1', {})];
    await run({ pos: true }, { pos: ctx, stock: denied('stock'), crm: ctx });
    expect(state.anchorCalls).toEqual([]);
  });
});
