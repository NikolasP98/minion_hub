import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { PosError } from './pos/errors';

const { getGrant, getPlan, captureException } = vi.hoisted(() => ({
  getGrant: vi.fn(),
  getPlan: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock('./pos-packages.service', () => ({ getGrant }));
vi.mock('./pos-accounts.service', () => ({ getPlan }));
vi.mock('./stock-accruals.service', () => ({ accrualSummaryForSources: async () => [] }));
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
});
