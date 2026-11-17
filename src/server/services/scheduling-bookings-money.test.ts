import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { PosError } from './pos/errors';

const { getGrant, getPlan, captureException, bookingTicketLinks, stockAnchorForBookings } =
  vi.hoisted(() => ({
    getGrant: vi.fn(),
    getPlan: vi.fn(),
    bookingTicketLinks: vi.fn(),
    stockAnchorForBookings: vi.fn(),
    captureException: vi.fn(),
  }));
vi.mock('./pos-packages.service', () => ({ getGrant }));
vi.mock('./pos-accounts.service', () => ({ getPlan, bookingTicketLinks }));
vi.mock('./stock-accruals.service', () => ({
  accrualSummaryForSources: async () => [],
  stockAnchorForBookings,
  stockRecoveryForBookings: async () => [],
}));
vi.mock('./tag-links.service', () => ({
  getTagLinks: async () => new Map(),
  getContactTagsBulk: async () => new Map(),
}));
vi.mock('@sentry/sveltekit', () => ({ captureException }));
import { getBookingDetail } from './scheduling-bookings.service';

const booking = { id: 'b1', orgId: 'org1', eventTypeId: 'et1', resourceId: 'r1' };
function fixture(patch: Record<string, unknown> = {}, rows: unknown[][] = []) {
  const { db, resolveSequence } = createMockDb();
  resolveSequence([[{ ...booking, ...patch }], [], [], [], ...rows]);
  return { db, ctx: { db: db as never, tenantId: 'org1' } };
}
const ticket = {
  ticketId: 't1',
  currency: 'PEN',
  subtotal: '20.00',
  discount: '0.00',
  total: '20.00',
  lineTotal: '20.00',
  createdBy: null,
  invoiceProviderRef: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  getGrant.mockReset();
  getPlan.mockReset();
  getGrant.mockResolvedValue(null);
  getPlan.mockResolvedValue(null);
  bookingTicketLinks.mockReset();
  bookingTicketLinks.mockResolvedValue(new Map());
  stockAnchorForBookings.mockReset();
  stockAnchorForBookings.mockResolvedValue(new Map());
});

describe('getBookingDetail financial read boundaries', () => {
  it.each(['grant', 'plan'] as const)(
    'propagates corrupt %s instead of hiding it as absent',
    async (facet) => {
      const failure = new PosError('Stored monetary data is invalid.', 'invalid_stored_amount');
      (facet === 'grant' ? getGrant : getPlan).mockRejectedValue(failure);
      const { ctx } = fixture(
        facet === 'grant' ? { packageGrantId: 'g1' } : { paymentPlanId: 'p1' },
      );
      await expect(getBookingDetail(ctx, 'b1')).rejects.toBe(failure);
      expect(captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ tags: { area: 'pos', code: 'invalid_stored_amount' } }),
      );
    },
  );
  it.each([
    { patch: { total: 'NaN' }, code: 'invalid_stored_amount' },
    { patch: { lineTotal: 'Infinity' }, code: 'invalid_stored_amount' },
    { patch: { currency: 'JPY' }, code: 'unsupported_pos_currency' },
  ])('rejects invalid linked ticket $code', async ({ patch, code }) => {
    const { ctx } = fixture({}, [[{ ...ticket, ...patch }]]);
    await expect(getBookingDetail(ctx, 'b1')).rejects.toMatchObject({ code });
  });
  it('rejects corrupt payment money before projecting the booking ticket', async () => {
    const { ctx } = fixture({}, [
      [ticket],
      [{ ticketId: 't1', method: 'cash', amount: 'NaN', tendered: null }],
      [],
      [],
    ]);
    await expect(getBookingDetail(ctx, 'b1')).rejects.toMatchObject({
      code: 'invalid_stored_amount',
    });
  });
  it('preserves optional-module fail-soft behavior for non-financial errors', async () => {
    getGrant.mockRejectedValue(new Error('relation absent'));
    const { ctx } = fixture({ packageGrantId: 'g1' }, [[]]);
    const output = await getBookingDetail(ctx, 'b1');
    expect(output?.booking.id).toBe('b1');
    expect(output?.grant).toBeNull();
    expect(captureException).not.toHaveBeenCalled();
  });
  it('describes the whole EVENT: lineTotal summed, siblings not "also bought"', async () => {
    // Two services of one appointment, both charged on ticket t1 beside a cream.
    const at = new Date('2026-10-07T15:00:00.000Z');
    const member = (id: string) => ({
      id,
      startTime: at,
      endTime: at,
      metadata: { groupId: 'g1', groupSeq: id === 'b1' ? 0 : 1, groupLength: 30 },
      eventTypeId: 'et1',
      resourceId: 'r1',
      status: 'accepted',
      productId: null,
      packageGrantId: null,
      paymentPlanId: null,
    });
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ ...booking, metadata: { groupId: 'g1', groupSeq: 0, groupLength: 30 } }],
      [],
      [],
      [],
      // visit facet: members, their event types, the money lines, the three
      // reference reads, then the org currency (no product ⇒ no price query).
      [member('b1'), member('b2')],
      [{ id: 'et1', title: 'Botox', productId: null }],
      [
        { bookingId: 'b1', ticketId: 't1', total: '20.00', currency: 'PEN' },
        { bookingId: 'b2', ticketId: 't1', total: '30.00', currency: 'PEN' },
      ],
      [],
      [],
      [],
      [{ currency: 'PEN' }],
      // ticket facet, now scoped to BOTH member ids: one row per event line.
      [
        { ...ticket, lineTotal: '20.00' },
        { ...ticket, lineTotal: '30.00' },
      ],
      [], // payments
      [
        { ticketId: 't1', bookingId: 'b1', description: 'Botox' },
        { ticketId: 't1', bookingId: 'b2', description: 'Peeling' },
        { ticketId: 't1', bookingId: null, description: 'Crema' },
      ],
      [], // emissions
    ]);

    const output = await getBookingDetail({ db: db as never, tenantId: 'org1' }, 'b1');

    expect(output?.visit?.members.map((m) => m.id)).toEqual(['b1', 'b2']);
    // A visit's members carry their own price: no ungrouped lookup.
    expect(output?.unitPrice).toBeNull();
    expect(output?.tickets).toEqual([
      expect.objectContaining({
        ticketId: 't1',
        // The event's two lines on t1 collapse into ONE ref carrying their sum.
        lineTotal: '50.00',
        // The sibling service is this same event, not something else bought.
        otherLines: ['Crema'],
        lineCount: 3,
      }),
    ]);
  });
  it('preserves valid historical ticket and payment decimals', async () => {
    const { ctx } = fixture({}, [
      [ticket],
      [{ ticketId: 't1', method: 'cash', amount: '20.00', tendered: '50.00' }],
      [],
      [],
    ]);
    const output = await getBookingDetail(ctx, 'b1');
    expect(output?.tickets).toEqual([
      expect.objectContaining({
        currency: 'PEN',
        total: '20.00',
        lineTotal: '20.00',
        payments: [{ method: 'cash', amount: '20.00' }],
      }),
    ]);
  });
  it('serves the catalog price of an UNGROUPED booking (own product wins; free = 0)', async () => {
    // booking, event type, resource, history, then tickets [], products [], price.
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ ...booking, productId: 'p-own' }],
      [{ id: 'et1', productId: 'p-type' }],
      [],
      [],
      [],
      [],
      [{ unitPrice: '0.00' }],
    ]);
    const output = await getBookingDetail({ db: db as never, tenantId: 'org1' }, 'b1');
    expect(output?.visit).toBeNull();
    expect(output?.unitPrice).toBe(0);
  });
  it('leaves unitPrice null for an ungrouped booking with no product', async () => {
    const { ctx } = fixture();
    expect((await getBookingDetail(ctx, 'b1'))?.unitPrice).toBeNull();
  });

  it('keeps a line of ANOTHER visit out of otherLines and lineCount, but keeps an unassigned service line', async () => {
    const { ctx } = fixture({}, [
      [ticket],
      [],
      [
        { ticketId: 't1', bookingId: 'b1', description: 'Botox' },
        { ticketId: 't1', bookingId: 'someone-elses-visit', description: 'OTHER VISIT SERVICE' },
        { ticketId: 't1', bookingId: null, description: 'Faja M' },
        { ticketId: 't1', bookingId: null, description: 'Peeling (unassigned service)' },
      ],
      [],
    ]);
    const output = await getBookingDetail(ctx, 'b1');
    expect(output?.tickets[0]?.otherLines).toEqual(['Faja M', 'Peeling (unassigned service)']);
    expect(output?.tickets[0]?.lineCount).toBe(3);
    expect(JSON.stringify(output?.tickets)).not.toContain('OTHER VISIT');
  });
});

describe('getBookingDetail sold + stock anchor facets (spec 126)', () => {
  const handle = { db: {} as never, tenantId: 'org1' };
  const foreign = { pos: handle, stock: handle };
  const links = (total: number) =>
    new Map([
      [
        'b1',
        [
          {
            id: 't1',
            humanId: 'POS-1',
            products: [
              {
                ticketId: 't1',
                ticketHumanId: 'POS-1',
                lineId: 'l1',
                productId: 'p-faja',
                bookingId: null,
                description: 'Faja M',
                qty: 1,
                total,
              },
            ],
          },
        ],
      ],
    ]);

  it('shows the same unassigned Faja M the hover shows, labelled and gift-flagged only with finance', async () => {
    bookingTicketLinks.mockResolvedValue(links(0));
    const { ctx } = fixture();
    const withMoney = await getBookingDetail(ctx, 'b1', { canReadFinancialFields: true, foreign });
    expect(withMoney?.sold).toMatchObject({
      state: 'available',
      value: { rows: [{ description: 'Faja M', relation: 'co_ticket_unassigned', gift: true }] },
    });
    const noMoney = await getBookingDetail(fixture().ctx, 'b1', { foreign });
    expect(
      (noMoney?.sold as { value: { rows: { gift: unknown }[] } }).value.rows[0]!.gift,
    ).toBeNull();
    expect(JSON.stringify(noMoney?.sold)).not.toContain('total');
  });

  it('is denied without a POS handle (no query) and unavailable when the read fails, never empty', async () => {
    const denied = await getBookingDetail(fixture().ctx, 'b1', {
      foreign: { pos: { denied: 'pos', verb: 'view' }, stock: { denied: 'stock', verb: 'view' } },
    });
    expect(denied?.sold).toEqual({ state: 'denied' });
    expect(denied?.stockAnchor).toEqual({ state: 'denied' });
    expect(bookingTicketLinks).not.toHaveBeenCalled();
    expect(stockAnchorForBookings).not.toHaveBeenCalled();

    bookingTicketLinks.mockRejectedValue(new Error('boom'));
    stockAnchorForBookings.mockRejectedValue(new Error('boom'));
    const failed = await getBookingDetail(fixture().ctx, 'b1', { foreign });
    expect(failed?.sold).toEqual({ state: 'unavailable', reason: 'read_failed' });
    expect(failed?.stockAnchor).toEqual({ state: 'unavailable', reason: 'read_failed' });
  });

  it('FAIL CLOSED: omitted foreign handles are denied, never read through the scheduling ctx', async () => {
    const out = await getBookingDetail(fixture().ctx, 'b1');
    expect(out?.sold).toEqual({ state: 'denied' });
    expect(out?.stockAnchor).toEqual({ state: 'denied' });
    expect(out?.stockRecovery).toEqual({ state: 'denied' });
    expect(bookingTicketLinks).not.toHaveBeenCalled();
    expect(stockAnchorForBookings).not.toHaveBeenCalled();
  });

  it('reads the stock facet for the ANCHOR, with counts only', async () => {
    stockAnchorForBookings.mockResolvedValue(
      new Map([['b1', { open: 1, realized: 0, released: 0, realizedEntryId: null }]]),
    );
    const out = await getBookingDetail(fixture().ctx, 'b1', { foreign });
    expect(stockAnchorForBookings).toHaveBeenCalledWith(expect.anything(), ['b1']);
    expect(out?.stockAnchor).toEqual({
      state: 'available',
      value: {
        anchorId: 'b1',
        accrual: { open: 1, realized: 0, released: 0, realizedEntryId: null },
      },
    });
  });
});
