/**
 * GET /api/scheduling/bookings/[id] — the versioned detail (spec 126). Real `bookingDetailResponse` and
 * `bookingDetailBody` over a mocked service: what matters here is what reaches the JSON.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getBookingDetail: vi.fn(),
  datasets: { pos: true, stock: true, finance: true } as Record<string, boolean>,
  maskFinance: false,
}));

vi.mock('$server/auth/scheduling-read', () => ({
  requireSchedulingRead: async () => ({ db: {}, tenantId: 'org-1' }),
}));
vi.mock('$server/auth/dataset-ctx', () => ({
  datasetCtx: async (_l: unknown, module: string) =>
    h.datasets[module] ? { db: {}, tenantId: 'org-1' } : { denied: module, verb: 'view' },
  canReadFinancialFields: async () => h.datasets.finance && !h.maskFinance,
  isDenied: (v: unknown) => !!v && typeof v === 'object' && 'denied' in v,
}));
vi.mock('$server/services/rbac.service', () => ({
  shouldMaskSensitive: async () => false,
  hasOrgCapability: async () => true,
}));
vi.mock('$server/services/scheduling-bookings.service', () => ({
  getBookingDetail: (...a: unknown[]) => h.getBookingDetail(...a),
  MAX_GROUP_MEMBERS: 8,
  BookingReferencedError: class extends Error {},
  deleteBooking: vi.fn(),
}));
vi.mock('$server/services/stock-accruals.service', () => ({
  RecoveryPreviewStaleError: class extends Error {},
  RecoveryForbiddenError: class extends Error {},
  realizeAccruals: vi.fn(),
  listAccruals: vi.fn(),
}));
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: async () => ({ db: {}, tenantId: 'org-1' }),
}));
vi.mock('$server/auth/authorize', () => ({ requireAuth: () => ({}) }));
vi.mock('$server/services/modules.service', () => ({ isModuleEnabled: async () => true }));

const { GET } = await import('./+server');

const detail = () => ({
  booking: {
    id: 'b1',
    status: 'accepted',
    eventTypeId: 'et1',
    productId: null,
    title: null,
    startTime: new Date('2026-10-07T14:00:00Z'),
    endTime: new Date('2026-10-07T15:00:00Z'),
    invoiceId: 'inv-POINTER',
    packageGrantId: 'grant-POINTER',
    paymentPlanId: 'plan-POINTER',
  },
  eventType: { id: 'et1', title: 'Consulta', productId: null },
  resource: null,
  contact: null,
  tags: { own: [], contact: [], service: [] },
  statusHistory: [],
  series: null,
  visit: null,
  products: [{ productId: 'p1', name: 'Crema', unitPrice: 77, qty: 1, paid: false }],
  tickets: [
    {
      ticketId: 't1',
      humanId: 'POS-1',
      submittedAt: new Date('2026-10-07T16:00:00Z'),
      status: 'submitted',
      currency: 'PEN',
      lineTotal: '123.00',
      subtotal: '123.00',
      discount: '0.00',
      total: '123.00',
      note: null,
      payments: [],
      otherLines: [],
      lineCount: 1,
      emission: null,
      createdByName: null,
      invoiceId: null,
    },
  ],
  grant: null,
  plan: null,
  unitPrice: 456,
  accrual: {
    open: 1,
    realized: 0,
    released: 0,
    estValue: 987,
    realizedValue: 0,
    realizedEntryId: null,
  },
  sold: { state: 'available', value: { rows: [] } },
  soldTotals: [{ ticketId: 't1', lineId: 'l1', total: 0 }],
  stockAnchor: {
    state: 'available',
    value: {
      anchorId: 'b1',
      accrual: { open: 1, realized: 0, released: 0, realizedEntryId: null },
    },
  },
  stockRecovery: { state: 'empty' },
});

const call = (headers: Record<string, string> = { 'X-Minion-Booking-Products-Version': '1' }) =>
  GET({
    locals: { user: { id: 'u1' } },
    params: { id: 'b1' },
    request: new Request('http://x', { headers }),
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
  h.datasets = { pos: true, stock: true, finance: true };
  h.maskFinance = false;
  h.getBookingDetail.mockImplementation(async () => detail());
});

describe('GET /api/scheduling/bookings/[id] (versioned)', () => {
  it.each([[{}], [{ 'X-Minion-Booking-Products-Version': '2' }]])(
    'answers HTTP 409 refresh_required with no source payload and no read: %o',
    async (headers) => {
      const res = await call(headers);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'refresh_required' });
      expect(h.getBookingDetail).not.toHaveBeenCalled();
    },
  );

  it('emits the neutral envelope: no legacy top-level money/visit/ticket/accrual field, no foreign pointers', async () => {
    const body = await (await call()).json();
    expect(Object.keys(body).sort()).toEqual([
      'booking',
      'contact',
      'eventType',
      'productFacets',
      'resource',
      'series',
      'statusHistory',
      'tags',
    ]);
    expect(body.booking).not.toHaveProperty('invoiceId');
    expect(body.booking).not.toHaveProperty('packageGrantId');
    expect(body.booking).not.toHaveProperty('paymentPlanId');
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/estValue|realizedValue|987|grant-POINTER|plan-POINTER/);
    // the invoice pointer exists ONLY inside the admitted payment facet
    expect(body.productFacets.payment.value.bookingInvoiceId).toBe('inv-POINTER');
    expect(JSON.stringify({ ...body, productFacets: null })).not.toContain('inv-POINTER');
    expect(body.productFacets.version).toBe(1);
  });

  it('with finance: the payment facet carries the real money and a non-value stock-cost state', async () => {
    const f = (await (await call()).json()).productFacets;
    expect(f.payment.state).toBe('available');
    expect(f.payment.value.services).toEqual([
      expect.objectContaining({ bookingId: 'b1', paid: true, price: 456, paidAmount: 123 }),
    ]);
    expect(f.payment.value.tickets[0].total).toBe('123.00');
    expect(f.payment.value.accrualCost).toEqual({
      state: 'unavailable',
      reason: 'valuation_currency_unverified',
    });
    expect(f.stock.value.anchorAccrual).toEqual({
      open: 1,
      realized: 0,
      released: 0,
      realizedEntryId: null,
    });
  });

  it('finance denied or tier-restricted: payment denied and NO money anywhere in the JSON; names stay', async () => {
    for (const mask of [() => (h.datasets.finance = false), () => (h.maskFinance = true)]) {
      h.datasets = { pos: true, stock: true, finance: true };
      h.maskFinance = false;
      mask();
      const body = await (await call()).json();
      expect(body.productFacets.payment).toEqual({ state: 'denied' });
      expect(body.productFacets.basic.state).toBe('available');
      expect(body.productFacets.planned.value.rows).toEqual([
        { productId: 'p1', name: 'Crema', qty: 1 },
      ]);
      expect(JSON.stringify(body)).not.toMatch(/456|123\.00|\b77\b|POS-1|"total"/);
      expect(h.getBookingDetail).toHaveBeenLastCalledWith(
        expect.anything(),
        'b1',
        expect.objectContaining({ canReadFinancialFields: false }),
      );
    }
  });

  it('POS denied: sold and payment denied, even with finance; the POS handle is the denied marker', async () => {
    h.datasets.pos = false;
    const body = await (await call()).json();
    // (the sold facet itself is the service's answer; the handler passes it the denied POS handle)
    expect(body.productFacets.payment).toEqual({ state: 'denied' });
    expect(JSON.stringify(body)).not.toMatch(/123\.00|POS-1/);
    const opts = h.getBookingDetail.mock.calls[0]![2];
    expect(opts.foreign.pos).toMatchObject({ denied: 'pos' });
    // removal cannot be decided without POS and stock admission
    expect(body.productFacets.basic.value.members[0].canRemoveService).toBeNull();
  });

  it('stock denied: stock facet and the stock-cost state are denied; no anchor counts', async () => {
    h.datasets.stock = false;
    const f = (await (await call()).json()).productFacets;
    expect(f.stock).toEqual({ state: 'denied' });
    expect(f.payment.value.accrualCost).toEqual({ state: 'denied' });
    expect(JSON.stringify(f)).not.toContain('"open"');
  });

  it('a failed stock read is unavailable, never zero accruals', async () => {
    h.getBookingDetail.mockImplementation(async () => ({
      ...detail(),
      stockAnchor: { state: 'unavailable', reason: 'read_failed' },
    }));
    const f = (await (await call()).json()).productFacets;
    expect(f.stock).toEqual({ state: 'unavailable', reason: 'read_failed' });
    expect(f.payment.value.accrualCost).toEqual({ state: 'unavailable', reason: 'read_failed' });
  });
});
