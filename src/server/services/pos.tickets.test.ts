import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

// ── stock.service mock (createSourcedIssue / findEntryBySource / submitEntry / cancelEntry / StockError) ──
// vi.hoisted: vi.mock factories are hoisted above regular top-level code, so a
// plain `class` here would throw "Cannot access before initialization".
const { MockStockError } = vi.hoisted(() => ({
  MockStockError: class MockStockError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'StockError';
      this.code = code;
    }
  },
}));
const createSourcedIssueMock = vi.fn<(ctx: unknown, input: unknown) => Promise<{ id: string }>>();
const findEntryBySourceMock =
  vi.fn<
    (
      ctx: unknown,
      source: string,
      sourceId: string,
    ) => Promise<{ id: string; status: string } | null>
  >();
const submitEntryMock =
  vi.fn<(ctx: unknown, id: string, actor: unknown) => Promise<{ id: string }>>();
const cancelEntryMock =
  vi.fn<(ctx: unknown, id: string, actor: unknown) => Promise<{ id: string }>>();
const getEntryMock = vi.fn<
  (
    ctx: unknown,
    id: string,
  ) => Promise<{
    entry: { id: string; status: string };
    lines: Array<{ itemId: string; qty: string }>;
  } | null>
>();
const listAllComponentEdgesMock =
  vi.fn<
    (ctx: unknown) => Promise<Array<{ parentItemId: string; childItemId: string; qty: number }>>
  >();
vi.mock('./stock.service', () => ({
  createSourcedIssue: (ctx: unknown, input: unknown) => createSourcedIssueMock(ctx, input),
  findEntryBySource: (ctx: unknown, source: string, sourceId: string) =>
    findEntryBySourceMock(ctx, source, sourceId),
  submitEntry: (ctx: unknown, id: string, actor: unknown) => submitEntryMock(ctx, id, actor),
  cancelEntry: (ctx: unknown, id: string, actor: unknown) => cancelEntryMock(ctx, id, actor),
  getEntry: (ctx: unknown, id: string) => getEntryMock(ctx, id),
  StockError: MockStockError,
  // Slice 1b: resolveIssueLines expands results through the component DAG.
  listAllComponentEdges: (ctx: unknown) => listAllComponentEdgesMock(ctx),
}));

// ── stock-accruals.service mock (resolveDefaultWarehouse) ──
const resolveDefaultWarehouseMock = vi.fn<(ctx: unknown) => Promise<string | null>>();
vi.mock('./stock-accruals.service', () => ({
  resolveDefaultWarehouse: (ctx: unknown) => resolveDefaultWarehouseMock(ctx),
}));

// ── modules.service mock (isModuleEnabled) ──
vi.mock('./modules.service', () => ({ isModuleEnabled: async () => true }));

import {
  submitTicket as submitTicketService,
  postTicketStock,
  planRepost,
  repostTicketStock,
  swapTicketLineProduct,
  voidTicket,
  computeTicketTotals,
  DEFAULT_POS_SETTINGS,
  normalizeMethods,
  normalizeRequirements,
  type SubmitTicketInput,
} from './pos.service';
import { paymentPolicyRevision } from './pos/credit-method-policy';

const DEFAULT_POLICY_REVISION = paymentPolicyRevision(DEFAULT_POS_SETTINGS);

function submitTicket(ctx: Parameters<typeof submitTicketService>[0], input: SubmitTicketInput) {
  return submitTicketService(ctx, {
    ...input,
    paymentPolicyRevision: input.paymentPolicyRevision ?? DEFAULT_POLICY_REVISION,
  });
}

/** The mock `Db` is typed as the sqlite/libsql client and doesn't expose
 *  `execute` — narrow-cast to reach the vi.fn the mock harness caches there. */
function mockExecute(db: unknown, value: unknown) {
  (db as { execute: ReturnType<typeof vi.fn> }).execute.mockResolvedValue(value);
}

beforeEach(() => {
  vi.clearAllMocks();
  findEntryBySourceMock.mockResolvedValue(null);
  getEntryMock.mockResolvedValue(null);
  // Default: no components anywhere => the explosion is the identity, so every
  // pre-Slice-1b expectation still describes the behaviour exactly.
  listAllComponentEdgesMock.mockResolvedValue([]);
  // vi.clearAllMocks() clears call history, not a configured mockResolvedValue
  // — without this reset a later test would silently inherit an earlier
  // test's 'wh-1' and run the new stock preflight (submitTicket) against a
  // resolveSequence that was never built for it. Explicit per-test
  // `.mockResolvedValue('wh-1')` calls below still win (they run after this).
  resolveDefaultWarehouseMock.mockResolvedValue(null);
});

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });
const actor = { id: 'u1', name: 'Test User' };

const openShiftRow = { id: 'shift-1', orgId: 'org-1', status: 'open', openingFloat: {} };

function ticketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-1',
    orgId: 'org-1',
    humanId: 'POS-2026-00001',
    shiftId: 'shift-1',
    partyId: null,
    status: 'submitted',
    subtotal: '20',
    discount: '0',
    total: '20',
    currency: 'PEN',
    stockEntryId: null,
    stockWarning: null,
    invoiceProviderRef: null,
    ...overrides,
  };
}

describe('computeTicketTotals — pure money math (the persisted path)', () => {
  it('multi-line happy path: subtotal = Σ line totals, total = subtotal with no discounts', () => {
    expect(
      computeTicketTotals([
        { kind: 'product', description: 'A', qty: 2, unitPrice: 10 },
        { kind: 'service', description: 'B', qty: 1, unitPrice: 50 },
      ]),
    ).toEqual({ lineTotals: [20, 50], subtotal: 70, discount: 0, total: 70 });
  });

  it('line discount is applied per line, inside the line total', () => {
    expect(
      computeTicketTotals([
        { kind: 'product', description: 'A', qty: 3, unitPrice: 10, discount: 5 },
      ]),
    ).toEqual({ lineTotals: [25], subtotal: 25, discount: 0, total: 25 });
  });

  it('ticket-level discount is subtracted once from the subtotal, not per line', () => {
    expect(
      computeTicketTotals(
        [
          { kind: 'product', description: 'A', qty: 1, unitPrice: 40 },
          { kind: 'product', description: 'B', qty: 1, unitPrice: 60 },
        ],
        10,
      ),
    ).toEqual({ lineTotals: [40, 60], subtotal: 100, discount: 10, total: 90 });
  });

  it('rounds float drift to exact 2dp at every stage (3 × 0.10 = 0.30, not 0.30000000000000004)', () => {
    const r = computeTicketTotals([{ kind: 'product', description: 'A', qty: 3, unitPrice: 0.1 }]);
    expect(r.lineTotals).toEqual([0.3]);
    expect(r.subtotal).toBe(0.3);
    expect(r.total).toBe(0.3);
    // classic drift pair: 0.1 + 0.2 across two lines
    const r2 = computeTicketTotals([
      { kind: 'product', description: 'A', qty: 1, unitPrice: 0.1 },
      { kind: 'product', description: 'B', qty: 1, unitPrice: 0.2 },
    ]);
    expect(r2.subtotal).toBe(0.3);
    expect(r2.total).toBe(0.3);
  });

  it('omitted ticket discount defaults to 0', () => {
    const r = computeTicketTotals([{ kind: 'product', description: 'A', qty: 1, unitPrice: 9.99 }]);
    expect(r.discount).toBe(0);
    expect(r.total).toBe(9.99);
  });
});

describe('submitTicket — validation guards', () => {
  it('fails closed when a committing caller omits or sends a stale payment-policy revision', async () => {
    const input: SubmitTicketInput = {
      lines: [{ kind: 'product', description: 'X', qty: 1, unitPrice: 10 }],
      payments: [{ method: 'cash', amount: 10, tendered: 10 }],
      actor,
    };
    for (const paymentPolicyRevision of [undefined, '0'.repeat(64)]) {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([[]]);
      await expect(
        submitTicketService(ctx(db), { ...input, paymentPolicyRevision }),
      ).rejects.toMatchObject({ code: 'pos_settings_changed' });
      expect(db.insert).not.toHaveBeenCalled();
    }
  });

  it('rechecks the revision under the transaction lock before any ticket write', async () => {
    const { db, resolveSequence } = createMockDb();
    const changed = {
      ...DEFAULT_POS_SETTINGS,
      currency: 'USD',
    };
    resolveSequence([[], [changed]]);
    await expect(
      submitTicketService(ctx(db), {
        lines: [{ kind: 'product', description: 'X', qty: 1, unitPrice: 10 }],
        payments: [{ method: 'cash', amount: 10, tendered: 10 }],
        actor,
        paymentPolicyRevision: DEFAULT_POLICY_REVISION,
      }),
    ).rejects.toMatchObject({ code: 'pos_settings_changed' });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('no_open_shift when no shift is open', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[], []]); // settings (defaults), open-shift lookup (none)
    const input: SubmitTicketInput = {
      lines: [{ kind: 'product', description: 'X', qty: 1, unitPrice: 10 }],
      payments: [{ method: 'cash', amount: 10, tendered: 10 }],
      actor,
    };
    await expect(submitTicket(ctx(db), input)).rejects.toMatchObject({ code: 'no_open_shift' });
  });

  it('payment_mismatch when payments do not sum to the total', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]); // settings only — throws before touching the tx
    const input: SubmitTicketInput = {
      lines: [{ kind: 'product', description: 'X', qty: 1, unitPrice: 10 }],
      payments: [{ method: 'cash', amount: 5, tendered: 5 }],
      actor,
    };
    await expect(submitTicket(ctx(db), input)).rejects.toMatchObject({ code: 'payment_mismatch' });
  });

  it('invalid_amount: a negative payment amount is rejected even when the split sums to the total', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]); // settings only — throws before touching the tx
    const input: SubmitTicketInput = {
      lines: [{ kind: 'product', description: 'X', qty: 1, unitPrice: 100 }],
      payments: [
        { method: 'cash', amount: 200 },
        { method: 'card', amount: -100 },
      ],
      actor,
    };
    await expect(submitTicket(ctx(db), input)).rejects.toMatchObject({ code: 'invalid_amount' });
  });

  it('invalid_method for a method not in settings', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]); // settings only
    const input: SubmitTicketInput = {
      lines: [{ kind: 'product', description: 'X', qty: 1, unitPrice: 10 }],
      payments: [{ method: 'bitcoin', amount: 10 }],
      actor,
    };
    await expect(submitTicket(ctx(db), input)).rejects.toMatchObject({ code: 'invalid_method' });
  });

  // A zero price is a valid value and must NOT be rejected here; only a
  // negative one is. The zero case is proven in src/lib/money/ticket.test.ts
  // (the shared rule) — asserting it end to end would need the whole
  // persistence mock sequence for no extra coverage of this guard.
  it('invalid_amount when a line has a negative unitPrice', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]); // settings only
    const input: SubmitTicketInput = {
      lines: [{ kind: 'product', description: 'X', qty: 1, unitPrice: -1 }],
      payments: [{ method: 'cash', amount: 0, tendered: 0 }],
      actor,
    };
    await expect(submitTicket(ctx(db), input)).rejects.toMatchObject({ code: 'invalid_amount' });
  });

  it('invalid_tender: a non-cash payment carrying tendered', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]);
    const input: SubmitTicketInput = {
      lines: [{ kind: 'product', description: 'X', qty: 1, unitPrice: 10 }],
      payments: [{ method: 'card', amount: 10, tendered: 10 }],
      actor,
    };
    await expect(submitTicket(ctx(db), input)).rejects.toMatchObject({ code: 'invalid_tender' });
  });

  it('invalid_tender: cash tendered below the amount', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]);
    const input: SubmitTicketInput = {
      lines: [{ kind: 'product', description: 'X', qty: 1, unitPrice: 10 }],
      payments: [{ method: 'cash', amount: 10, tendered: 5 }],
      actor,
    };
    await expect(submitTicket(ctx(db), input)).rejects.toMatchObject({ code: 'invalid_tender' });
  });

  it('invalid_discount: a line discount larger than the line total is rejected (would go negative)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]); // settings only — throws before touching the tx
    const input: SubmitTicketInput = {
      lines: [{ kind: 'product', description: 'X', qty: 1, unitPrice: 80, discount: 999 }],
      payments: [{ method: 'cash', amount: -919, tendered: -919 }],
      actor,
    };
    await expect(submitTicket(ctx(db), input)).rejects.toMatchObject({ code: 'invalid_discount' });
  });

  it('invalid_discount: an order-level discount larger than the subtotal is rejected', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]); // settings only
    const input: SubmitTicketInput = {
      lines: [{ kind: 'product', description: 'X', qty: 1, unitPrice: 80 }],
      discount: 999,
      payments: [{ method: 'cash', amount: 0 }],
      actor,
    };
    await expect(submitTicket(ctx(db), input)).rejects.toMatchObject({ code: 'invalid_discount' });
  });
});

describe('submitTicket — happy path', () => {
  it('inserts the ticket + lines + payments, posts stock post-commit, returns stockWarning: null', async () => {
    const { db, resolveSequence } = createMockDb();
    // nextSerialId's `tx.execute(...)` needs a `{n}` row back (the mock's
    // sequential mode always resolves `execute` to undefined otherwise) —
    // harmless for the SET ROLE/config execute calls, which ignore the result.
    mockExecute(db, [{ n: 1 }]);
    resolveSequence([
      [], // settings (defaults)
      [], // fin_product_components lookup — no packages
      [{ finProductId: 'fp-1', itemId: 'item-1', qtyPerUnit: '1' }], // stk_consumption: its 1-unit recipe row
      [{ itemId: 'item-1', qty: 5 }], // stock preflight: checkStockShortfalls bins (covers qty 2)
      [], // stock preflight: checkStockShortfalls item names (no shortfall, unused)
      [], // settings re-read under the transaction lock
      [openShiftRow], // open shift
      [ticketRow()], // insert ticket returning
      [{ id: 'line-1', lineNo: 0 }], // insert lines (returning id, lineNo)
      [], // insert payments
      [ticketRow()], // postTicketStock: loadTicketRow
      [
        {
          id: 'line-1',
          orgId: 'org-1',
          ticketId: 'ticket-1',
          kind: 'product',
          finProductId: 'fp-1',
          bookingId: null,
          qty: '2',
          unitPrice: '10',
          discount: '0',
          total: '20',
          lineNo: 0,
        },
      ], // ticket lines
      [{ finProductId: 'fp-1', itemId: 'item-1', qtyPerUnit: '1' }], // stk_consumption: its 1-unit recipe row
      [{ itemId: 'item-1', qty: 5 }], // postTicketStock fresh checkStockShortfalls: bins
      [], // postTicketStock fresh checkStockShortfalls: item names (no shortfall, unused)
      [], // stampTicketStock update
    ]);
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');
    createSourcedIssueMock.mockResolvedValue({ id: 'entry-1' });

    const input: SubmitTicketInput = {
      lines: [
        { kind: 'product', finProductId: 'fp-1', description: 'Retail', qty: 2, unitPrice: 10 },
      ],
      payments: [{ method: 'cash', amount: 20, tendered: 20 }],
      actor,
    };
    const result = await submitTicket(ctx(db), input);

    expect(result.ticket.id).toBe('ticket-1');
    expect(result.ticket.humanId).toBe('POS-2026-00001');
    expect(result.stockWarning).toBeNull();
    expect(db.insert).toHaveBeenCalled();
    expect(createSourcedIssueMock).toHaveBeenCalledTimes(1);
    const call = createSourcedIssueMock.mock.calls[0][1] as {
      lines: { itemId: string; qty: number }[];
      warehouseId: string;
      source: string;
      sourceId: string;
    };
    expect(call.lines).toEqual([{ itemId: 'item-1', qty: 2, qtyConsumption: 2 }]);
    expect(call.warehouseId).toBe('wh-1');
    expect(call.source).toBe('pos');
    expect(call.sourceId).toBe('ticket-1');
  });
});

describe('submitTicket — booking-linked lines never issue', () => {
  it('a booking-linked service line is excluded from stock resolution', async () => {
    const { db, resolveSequence } = createMockDb();
    mockExecute(db, [{ n: 1 }]);
    resolveSequence([
      [], // settings
      [], // fin_product_components lookup — no packages
      [{ finProductId: 'fp-1', itemId: 'item-1', qtyPerUnit: '1' }], // stk_consumption: its 1-unit recipe row
      [{ itemId: 'item-1', qty: 5 }], // stock preflight: checkStockShortfalls bins (covers qty 2)
      [], // stock preflight: checkStockShortfalls item names (no shortfall, unused)
      [], // settings re-read under the transaction lock
      [openShiftRow], // open shift
      [ticketRow({ total: '70', subtotal: '70' })], // insert ticket returning
      [{ id: 'line-1', lineNo: 0 }], // insert lines (returning id, lineNo)
      [], // insert payments
      [ticketRow({ total: '70', subtotal: '70' })], // postTicketStock: loadTicketRow
      [
        {
          id: 'line-1',
          orgId: 'org-1',
          ticketId: 'ticket-1',
          kind: 'service',
          finProductId: 'fp-svc',
          bookingId: 'bkg-1',
          qty: '1',
          unitPrice: '50',
          discount: '0',
          total: '50',
          lineNo: 0,
        },
        {
          id: 'line-2',
          orgId: 'org-1',
          ticketId: 'ticket-1',
          kind: 'product',
          finProductId: 'fp-1',
          bookingId: null,
          qty: '2',
          unitPrice: '10',
          discount: '0',
          total: '20',
          lineNo: 1,
        },
      ], // ticket lines
      [{ finProductId: 'fp-1', itemId: 'item-1', qtyPerUnit: '1' }], // stk_consumption: its 1-unit recipe row
      [{ itemId: 'item-1', qty: 5 }], // postTicketStock fresh checkStockShortfalls: bins
      [], // postTicketStock fresh checkStockShortfalls: item names (no shortfall, unused)
      [], // stampTicketStock update
    ]);
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');
    createSourcedIssueMock.mockResolvedValue({ id: 'entry-2' });

    const input: SubmitTicketInput = {
      lines: [
        {
          kind: 'service',
          finProductId: 'fp-svc',
          bookingId: 'bkg-1',
          description: 'Massage',
          qty: 1,
          unitPrice: 50,
        },
        { kind: 'product', finProductId: 'fp-1', description: 'Retail', qty: 2, unitPrice: 10 },
      ],
      payments: [{ method: 'cash', amount: 70, tendered: 70 }],
      actor,
    };
    await submitTicket(ctx(db), input);

    const call = createSourcedIssueMock.mock.calls[0][1] as {
      lines: { itemId: string; qty: number }[];
    };
    expect(call.lines).toEqual([{ itemId: 'item-1', qty: 2, qtyConsumption: 2 }]);
  });
});

describe('postTicketStock — line resolution', () => {
  it('kind decides: products issue (linked to a visit or not), a service awaiting scheduling does not (spec 120)', async () => {
    const { db, resolveSequence } = createMockDb();
    const line = (id: string, kind: string, finProductId: string, extra: object = {}) => ({
      id,
      orgId: 'org-1',
      ticketId: 'ticket-8',
      kind,
      finProductId,
      bookingId: null,
      redemptionId: null,
      qty: '1',
      unitPrice: '10',
      ...extra,
    });
    resolveSequence([
      [ticketRow({ id: 'ticket-8' })], // loadTicketRow
      [
        line('l1', 'product', 'fp-prod', { qty: '3' }),
        line('l2', 'service', 'fp-svc', { qty: '2' }), // awaiting scheduling → nothing
        line('l3', 'product', 'fp-unmapped'),
        line('l4', 'product', 'fp-tray', { bookingId: 'bkg-1' }), // charged from a visit → issues
        line('l5', 'service', 'fp-booked', { bookingId: 'bkg-1' }), // booking-owned → nothing
        line('l6', 'service', 'fp-redeemed', { redemptionId: 'red-1' }), // counter session → issues
        line('l7', 'service', 'fp-bundle'), // bundle → issues
      ], // ticket lines
      [{ id: 'fp-bundle' }], // bundle lookup, asked only for fp-svc + fp-bundle
      [
        { finProductId: 'fp-prod', itemId: 'item-a', qtyPerUnit: '1' },
        { finProductId: 'fp-tray', itemId: 'item-c', qtyPerUnit: '1' },
        { finProductId: 'fp-redeemed', itemId: 'item-d', qtyPerUnit: '2' },
        { finProductId: 'fp-bundle', itemId: 'item-e', qtyPerUnit: '1' },
      ], // stk_consumption batch lookup (fp-svc / fp-booked are never asked for)
      [
        { itemId: 'item-a', qty: 5 },
        { itemId: 'item-c', qty: 5 },
        { itemId: 'item-d', qty: 5 },
        { itemId: 'item-e', qty: 5 },
      ], // fresh checkStockShortfalls: bins
      [], // fresh checkStockShortfalls: item names (no shortfall, unused)
      [], // stampTicketStock update
    ]);
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');
    createSourcedIssueMock.mockResolvedValue({ id: 'entry-9' });

    await postTicketStock(ctx(db), 'ticket-8', actor);

    const call = createSourcedIssueMock.mock.calls[0][1] as {
      lines: { itemId: string; qty: number; qtyConsumption?: number }[];
    };
    expect(call.lines).toEqual([
      { itemId: 'item-a', qty: 3, qtyConsumption: 3 },
      { itemId: 'item-c', qty: 1, qtyConsumption: 1 },
      { itemId: 'item-d', qty: 2, qtyConsumption: 2 },
      { itemId: 'item-e', qty: 1, qtyConsumption: 1 },
    ]);
  });

  it('a sale of services awaiting scheduling posts no stock entry and no warning (spec 120)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [ticketRow({ id: 'ticket-s' })], // loadTicketRow
      [
        {
          id: 'l1',
          orgId: 'org-1',
          ticketId: 'ticket-s',
          kind: 'service',
          finProductId: 'fp-svc',
          bookingId: null,
          redemptionId: null,
          qty: '1',
          unitPrice: '30',
        },
      ], // ticket lines
      [], // bundle lookup: fp-svc is not a bundle
      [], // stampTicketStock update
    ]);

    const out = await postTicketStock(ctx(db), 'ticket-s', actor);

    expect(out).toEqual({ entryId: null, stockWarning: null });
    expect(createSourcedIssueMock).not.toHaveBeenCalled();
  });

  it('a stamp left on a cancelled entry is an interrupted rebuild: posts again (spec 120)', async () => {
    const { db, resolveSequence } = createMockDb();
    getEntryMock.mockResolvedValue({ entry: { id: 'entry-old', status: 'cancelled' }, lines: [] });
    findEntryBySourceMock.mockResolvedValue(null);
    resolveSequence([
      [ticketRow({ id: 'ticket-r', stockEntryId: 'entry-old' })], // loadTicketRow
      [
        {
          id: 'l1',
          orgId: 'org-1',
          ticketId: 'ticket-r',
          kind: 'product',
          finProductId: 'fp-prod',
          bookingId: null,
          redemptionId: null,
          qty: '1',
          unitPrice: '10',
        },
      ], // ticket lines
      [{ finProductId: 'fp-prod', itemId: 'item-a', qtyPerUnit: '1' }], // stk_consumption
      [{ itemId: 'item-a', qty: 5 }], // bins
      [], // item names (unused)
      [], // stampTicketStock update
    ]);
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');
    createSourcedIssueMock.mockResolvedValue({ id: 'entry-new' });

    const out = await postTicketStock(ctx(db), 'ticket-r', actor);

    expect(out).toEqual({ entryId: 'entry-new', stockWarning: null });
  });

  it('a stamp on a live entry is a posted sale: no second issue', async () => {
    const { db, resolveSequence } = createMockDb();
    getEntryMock.mockResolvedValue({ entry: { id: 'entry-1', status: 'submitted' }, lines: [] });
    resolveSequence([[ticketRow({ id: 'ticket-p', stockEntryId: 'entry-1' })]]);

    const out = await postTicketStock(ctx(db), 'ticket-p', actor);

    expect(out).toEqual({ entryId: 'entry-1', stockWarning: null });
    expect(createSourcedIssueMock).not.toHaveBeenCalled();
  });

  it('a 0-qty usage mapping beside a real one issues only the real line (spec 033)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [ticketRow({ id: 'ticket-z' })], // loadTicketRow
      [
        {
          id: 'l1',
          orgId: 'org-1',
          ticketId: 'ticket-z',
          kind: 'product',
          finProductId: 'fp-svc',
          bookingId: null,
          qty: '2',
          unitPrice: '30',
        },
      ], // ticket lines
      [
        { finProductId: 'fp-svc', itemId: 'item-x', qtyPerUnit: '2' },
        { finProductId: 'fp-svc', itemId: 'item-y', qtyPerUnit: '0' },
      ], // stk_consumption
      [{ itemId: 'item-x', qty: 50 }], // bins
      [], // item names
      [], // stampTicketStock update
    ]);
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');
    createSourcedIssueMock.mockResolvedValue({ id: 'entry-z' });

    await postTicketStock(ctx(db), 'ticket-z', actor);

    const call = createSourcedIssueMock.mock.calls[0][1] as { lines: { itemId: string }[] };
    expect(call.lines.map((l) => l.itemId)).toEqual(['item-x']);
  });

  // `kind` is not consulted: a product-kind sellable issues its recipe.
  it('product-kind WITH a recipe explodes the recipe', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [ticketRow({ id: 'ticket-r1' })],
      [
        {
          id: 'l1',
          orgId: 'org-1',
          ticketId: 'ticket-r1',
          kind: 'product',
          finProductId: 'fp-kit',
          bookingId: null,
          qty: '2',
          unitPrice: '40',
        },
      ],
      [
        { finProductId: 'fp-kit', itemId: 'item-x', qtyPerUnit: '3' },
        { finProductId: 'fp-kit', itemId: 'item-y', qtyPerUnit: '1' },
      ],
      [
        { itemId: 'item-x', qty: 10 },
        { itemId: 'item-y', qty: 10 },
      ], // fresh checkStockShortfalls: bins
      [], // fresh checkStockShortfalls: item names (no shortfall, unused)
      [],
    ]);
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');
    createSourcedIssueMock.mockResolvedValue({ id: 'entry-r1' });

    await postTicketStock(ctx(db), 'ticket-r1', actor);

    const call = createSourcedIssueMock.mock.calls[0][1] as {
      lines: { itemId: string; qty: number; qtyConsumption?: number }[];
    };
    expect(call.lines).toEqual([
      { itemId: 'item-x', qty: 6, qtyConsumption: 6 }, // 2 × 3 consumption-UOM
      { itemId: 'item-y', qty: 2, qtyConsumption: 2 }, // 2 × 1 consumption-UOM
    ]);
  });

  it('two lines reaching the same item sum in its consumption uom', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [ticketRow({ id: 'ticket-mixed-uom' })],
      [
        {
          id: 'l1',
          orgId: 'org-1',
          ticketId: 'ticket-mixed-uom',
          kind: 'product',
          finProductId: 'fp-vial',
          bookingId: null,
          qty: '1',
          unitPrice: '20',
        },
        {
          id: 'l2',
          orgId: 'org-1',
          ticketId: 'ticket-mixed-uom',
          kind: 'product',
          finProductId: 'fp-procedure',
          bookingId: null,
          qty: '1',
          unitPrice: '80',
        },
      ],
      [
        // a whole vial = its 10 mL (units_per_stock_uom), as the migration wrote it
        { finProductId: 'fp-vial', itemId: 'item-h', qtyPerUnit: '10' },
        { finProductId: 'fp-procedure', itemId: 'item-h', qtyPerUnit: '10' },
      ],
      [{ itemId: 'item-h', qty: 50 }], // fresh checkStockShortfalls: bins (covers both lines' 10 + 10)
      [], // fresh checkStockShortfalls: item names (no shortfall, unused)
      [],
    ]);
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');
    createSourcedIssueMock.mockResolvedValue({ id: 'entry-mixed-uom' });

    await postTicketStock(ctx(db), 'ticket-mixed-uom', actor);

    const call = createSourcedIssueMock.mock.calls[0][1] as {
      lines: { itemId: string; qty: number; qtyConsumption?: number }[];
    };
    expect(call.lines).toEqual([
      { itemId: 'item-h', qty: 20, qtyConsumption: 20 }, // a vial's 10 mL + the procedure's 10 mL
    ]);
  });

  it('applies an add modifier once for a multi-root recipe', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [ticketRow({ id: 'ticket-mod' })],
      [
        {
          id: 'l1',
          orgId: 'org-1',
          ticketId: 'ticket-mod',
          kind: 'product',
          finProductId: 'fp-procedure',
          bookingId: null,
          qty: '1',
          unitPrice: '80',
          modifiers: [{ action: 'add', itemId: 'item-drink', qty: 1 }],
        },
      ],
      [
        { finProductId: 'fp-procedure', itemId: 'item-a', qtyPerUnit: '1' },
        { finProductId: 'fp-procedure', itemId: 'item-b', qtyPerUnit: '2' },
      ],
      [
        { itemId: 'item-drink', qty: 10 },
        { itemId: 'item-a', qty: 10 },
        { itemId: 'item-b', qty: 10 },
      ], // fresh checkStockShortfalls: bins
      [], // fresh checkStockShortfalls: item names (no shortfall, unused)
      [],
    ]);
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');
    createSourcedIssueMock.mockResolvedValue({ id: 'entry-mod' });

    await postTicketStock(ctx(db), 'ticket-mod', actor);

    const call = createSourcedIssueMock.mock.calls[0][1] as {
      lines: { itemId: string; qty: number; qtyConsumption?: number }[];
    };
    expect(call.lines).toEqual([
      { itemId: 'item-drink', qty: 1 },
      { itemId: 'item-a', qty: 1, qtyConsumption: 1 },
      { itemId: 'item-b', qty: 2, qtyConsumption: 2 },
    ]);
  });

  it('a self-mapping recipe acts as a qty multiplier on the product item', async () => {
    // The real Hialuronidasa shape: the only recipe row points at the
    // product's own item, so it multiplies rather than substituting.
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [ticketRow({ id: 'ticket-r2' })],
      [
        {
          id: 'l1',
          orgId: 'org-1',
          ticketId: 'ticket-r2',
          kind: 'product',
          finProductId: 'fp-h',
          bookingId: null,
          qty: '2',
          unitPrice: '80',
        },
      ],
      [{ finProductId: 'fp-h', itemId: 'item-h', qtyPerUnit: '10' }], // self-map
      [{ itemId: 'item-h', qty: 50 }], // fresh checkStockShortfalls: bins
      [], // fresh checkStockShortfalls: item names (no shortfall, unused)
      [],
    ]);
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');
    createSourcedIssueMock.mockResolvedValue({ id: 'entry-r2' });

    await postTicketStock(ctx(db), 'ticket-r2', actor);

    const call = createSourcedIssueMock.mock.calls[0][1] as {
      lines: { itemId: string; qty: number; qtyConsumption?: number }[];
    };
    expect(call.lines).toEqual([{ itemId: 'item-h', qty: 20, qtyConsumption: 20 }]); // 20 mL; stock service converts using vial capacity
  });

  it('a sold COMPOSITE consumes its leaves, not itself (Slice 1b explosion)', async () => {
    // fp-plate's recipe is 1 × item-plate, which is itself composite:
    //   plate -> 2 mash -> 3 potato  => 1 plate sold = 6 potato consumed
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [ticketRow({ id: 'ticket-x1' })],
      [
        {
          id: 'l1',
          orgId: 'org-1',
          ticketId: 'ticket-x1',
          kind: 'product',
          finProductId: 'fp-plate',
          bookingId: null,
          qty: '1',
          unitPrice: '90',
        },
      ],
      [{ finProductId: 'fp-plate', itemId: 'item-plate', qtyPerUnit: '1' }], // stk_consumption: its 1-unit recipe row
      [
        // stk_items is_stock_item flags for the explosion
        { id: 'item-plate', isStockItem: false },
        { id: 'item-mash', isStockItem: false },
        { id: 'item-potato', isStockItem: true },
      ],
      [{ itemId: 'item-potato', qty: 50 }], // fresh checkStockShortfalls: bins
      [], // fresh checkStockShortfalls: item names (no shortfall, unused)
      [], // stampTicketStock
    ]);
    listAllComponentEdgesMock.mockResolvedValue([
      { parentItemId: 'item-plate', childItemId: 'item-mash', qty: 2 },
      { parentItemId: 'item-mash', childItemId: 'item-potato', qty: 3 },
    ]);
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');
    createSourcedIssueMock.mockResolvedValue({ id: 'entry-x1' });

    await postTicketStock(ctx(db), 'ticket-x1', actor);

    const call = createSourcedIssueMock.mock.calls[0][1] as {
      lines: { itemId: string; qty: number; qtyConsumption?: number }[];
    };
    expect(call.lines).toEqual([{ itemId: 'item-potato', qty: 6, qtyConsumption: 6 }]);
    // the composite and the intermediate sub-recipe are never issued
    expect(call.lines.some((l) => l.itemId === 'item-plate' || l.itemId === 'item-mash')).toBe(
      false,
    );
  });

  it('a sellable WITHOUT a recipe issues nothing (no hidden 1:1 fallback, meta spec 024)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [ticketRow({ id: 'ticket-r3' })],
      [
        {
          id: 'l1',
          orgId: 'org-1',
          ticketId: 'ticket-r3',
          kind: 'product',
          finProductId: 'fp-s',
          bookingId: null,
          qty: '4',
          unitPrice: '10',
        },
      ],
      [], // no recipe
      [],
      [],
      [],
    ]);
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');

    await postTicketStock(ctx(db), 'ticket-r3', actor);

    expect(createSourcedIssueMock).not.toHaveBeenCalled();
  });
});

describe('submitTicket — stock fail-soft', () => {
  it('a StockError from the stock post degrades to a stockWarning; the ticket still returns', async () => {
    const { db, resolveSequence } = createMockDb();
    mockExecute(db, [{ n: 1 }]);
    resolveSequence([
      [], // settings
      [], // fin_product_components lookup — no packages
      [{ finProductId: 'fp-1', itemId: 'item-1', qtyPerUnit: '1' }], // stk_consumption: its 1-unit recipe row
      [{ itemId: 'item-1', qty: 5 }], // stock preflight: checkStockShortfalls bins (covers qty 1)
      [], // stock preflight: checkStockShortfalls item names (no shortfall, unused)
      [], // settings re-read under the transaction lock
      [openShiftRow], // open shift
      [ticketRow({ id: 'ticket-9' })], // insert ticket returning
      [{ id: 'line-1', lineNo: 0 }], // insert lines (returning id, lineNo)
      [], // insert payments
      [ticketRow({ id: 'ticket-9' })], // postTicketStock: loadTicketRow
      [
        {
          id: 'line-1',
          orgId: 'org-1',
          ticketId: 'ticket-9',
          kind: 'product',
          finProductId: 'fp-1',
          bookingId: null,
          qty: '1',
          unitPrice: '20',
        },
      ], // ticket lines
      [{ finProductId: 'fp-1', itemId: 'item-1', qtyPerUnit: '1' }], // stk_consumption: its 1-unit recipe row
      [{ itemId: 'item-1', qty: 5 }], // postTicketStock fresh checkStockShortfalls: bins (covers qty 1 — the createSourcedIssue rejection below is a SEPARATE, late failure, not a shortfall)
      [], // postTicketStock fresh checkStockShortfalls: item names (no shortfall, unused)
      [], // stampTicketStock update (stores the warning)
    ]);
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');
    createSourcedIssueMock.mockRejectedValue(
      new MockStockError('insufficient stock', 'negative_stock'),
    );

    const input: SubmitTicketInput = {
      lines: [{ kind: 'product', finProductId: 'fp-1', description: 'X', qty: 1, unitPrice: 20 }],
      payments: [{ method: 'cash', amount: 20, tendered: 20 }],
      actor,
    };
    const result = await submitTicket(ctx(db), input);

    expect(result.ticket.id).toBe('ticket-9');
    expect(result.stockWarning).toMatchObject({ code: 'negative_stock' });
    expect(db.update).toHaveBeenCalled(); // ticket row stamped with stock_warning
  });
});

// F-partial-stock-shortfall: a short line used to discard the WHOLE stock
// entry (every in-stock line lost, `stockEntryId: null`) instead of refusing
// the sale up front. These cover the three promised behaviours: refusal
// before payment, the manager override, and "never drop the whole entry".
describe('submitTicket — stock shortfall integrity', () => {
  it('refuses the sale (before any write) when a tracked line lacks stock', async () => {
    const { db, resolveSequence } = createMockDb();
    mockExecute(db, [{ n: 1 }]);
    resolveSequence([
      [], // settings
      [], // fin_product_components lookup — no packages
      [{ finProductId: 'fp-1', itemId: 'item-1', qtyPerUnit: '1' }], // stk_consumption: its 1-unit recipe row
      [{ itemId: 'item-1', qty: 2 }], // preflight checkStockShortfalls: bins — only 2 on hand
      [{ id: 'item-1', name: 'Tracked Widget', code: 'TW-1' }], // preflight: item name/code for the message
    ]);
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');

    const input: SubmitTicketInput = {
      lines: [
        {
          kind: 'product',
          finProductId: 'fp-1',
          description: 'Tracked Widget',
          qty: 5,
          unitPrice: 10,
        },
      ],
      payments: [{ method: 'cash', amount: 50, tendered: 50 }],
      actor,
    };

    await expect(submitTicket(ctx(db), input)).rejects.toMatchObject({
      code: 'insufficient_stock',
      // Per-line detail the /pos/sell UI needs to localize the refusal
      // instead of showing the raw English message (senior-review finding).
      items: [
        {
          itemId: 'item-1',
          itemName: 'Tracked Widget',
          itemCode: 'TW-1',
          requested: 5,
          available: 2,
        },
      ],
    });
    // Refused BEFORE the money tx — nothing was ever inserted.
    expect(db.insert).not.toHaveBeenCalled();
    expect(createSourcedIssueMock).not.toHaveBeenCalled();
  });

  it('allowNegativeStock: issues every in-stock line and excludes only the short one', async () => {
    const { db, resolveSequence } = createMockDb();
    mockExecute(db, [{ n: 1 }]);
    const recipeRows = [
      { finProductId: 'fp-1', itemId: 'item-1', qtyPerUnit: '1' },
      { finProductId: 'fp-2', itemId: 'item-2', qtyPerUnit: '1' },
    ];
    const lineRows = [
      {
        id: 'line-1',
        orgId: 'org-1',
        ticketId: 'ticket-1',
        kind: 'product',
        finProductId: 'fp-1',
        bookingId: null,
        qty: '5',
        unitPrice: '10',
      },
      {
        id: 'line-2',
        orgId: 'org-1',
        ticketId: 'ticket-1',
        kind: 'product',
        finProductId: 'fp-2',
        bookingId: null,
        qty: '1',
        unitPrice: '5',
      },
    ];
    resolveSequence([
      [], // settings
      [], // fin_product_components lookup — no packages
      recipeRows, // preflight resolveIssueLines: stk_consumption
      [
        { itemId: 'item-1', qty: 2 }, // short: 5 requested, 2 available
        { itemId: 'item-2', qty: 10 }, // in stock
      ], // preflight checkStockShortfalls: bins
      [{ id: 'item-1', name: 'Short Widget', code: 'SW-1' }], // preflight: item name/code
      [], // settings re-read under the transaction lock
      [openShiftRow], // open shift
      [ticketRow()], // insert ticket returning
      [
        { id: 'line-1', lineNo: 0 },
        { id: 'line-2', lineNo: 1 },
      ], // insert lines
      [], // insert payments
      [ticketRow()], // postTicketStock: loadTicketRow
      lineRows, // postTicketStock: ticket lines
      recipeRows, // postTicketStock resolveIssueLines: stk_consumption (2nd resolve, post-commit)
      [
        { itemId: 'item-1', qty: 2 }, // still short — same fresh read, race-free here
        { itemId: 'item-2', qty: 10 },
      ], // postTicketStock fresh checkStockShortfalls: bins
      [{ id: 'item-1', name: 'Short Widget', code: 'SW-1' }], // postTicketStock fresh checkStockShortfalls: item names
      [], // stampTicketStock update
    ]);
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');
    createSourcedIssueMock.mockResolvedValue({ id: 'entry-partial' });

    const input: SubmitTicketInput = {
      lines: [
        {
          kind: 'product',
          finProductId: 'fp-1',
          description: 'Short Widget',
          qty: 5,
          unitPrice: 10,
        },
        { kind: 'product', finProductId: 'fp-2', description: 'OK Widget', qty: 1, unitPrice: 5 },
      ],
      payments: [{ method: 'cash', amount: 55, tendered: 55 }],
      actor,
      allowNegativeStock: true,
    };

    const result = await submitTicket(ctx(db), input);

    // The sale went through — never dropped for the shortfall.
    expect(result.ticket.id).toBe('ticket-1');
    // The IN-STOCK line (item-2) still issued: the whole entry was not discarded.
    expect(createSourcedIssueMock).toHaveBeenCalledTimes(1);
    const call = createSourcedIssueMock.mock.calls[0][1] as {
      lines: { itemId: string; qty: number }[];
    };
    expect(call.lines).toEqual([{ itemId: 'item-2', qty: 1, qtyConsumption: 1 }]);
    // The short line is recorded, not silently dropped.
    expect(result.stockWarning).toMatchObject({ code: 'negative_stock' });
    expect(result.stockWarning?.items).toEqual([
      { itemId: 'item-1', itemName: 'Short Widget', itemCode: 'SW-1', requested: 5, available: 2 },
    ]);
  });
});

describe('planRepost — what a rebuild may change (spec 120)', () => {
  const m = (o: Record<string, number>) => new Map(Object.entries(o));

  it('a decrease on an allowed item is a change, not drift', () => {
    const out = planRepost(m({ a: 1, s: 1 }), m({ a: 1 }), { allowedItemIds: new Set(['s']) });
    expect(out.changes).toEqual([{ itemId: 's', old: 1, new: 0, diff: -1 }]);
    expect(out.drift).toEqual([]);
  });

  it('a change on an item nobody named is drift', () => {
    const out = planRepost(m({ a: 1, x: 2 }), m({ a: 1 }), { allowedItemIds: new Set(['s']) });
    expect(out.drift.map((d) => d.itemId)).toEqual(['x']);
  });

  it('an increase is drift even on an allowed item, unless it is the swap target', () => {
    const grow = [m({ a: 0.5 }), m({ a: 1 })] as const;
    expect(planRepost(...grow, { allowedItemIds: new Set(['a']) }).drift).toHaveLength(1);
    expect(
      planRepost(...grow, { allowedItemIds: new Set(), allowIncreaseItemIds: new Set(['a']) })
        .drift,
    ).toEqual([]);
  });

  it('differences inside the tolerance plan nothing', () => {
    const out = planRepost(m({ a: 1 }), m({ a: 1.00005 }), { allowedItemIds: new Set() });
    expect(out).toEqual({ changes: [], drift: [] });
  });
});

describe('repostTicketStock — rebuild a sale under the current rule (spec 120)', () => {
  const productLine = {
    id: 'l1',
    orgId: 'org-1',
    ticketId: 'ticket-1',
    kind: 'product',
    finProductId: 'fp-prod',
    bookingId: null,
    redemptionId: null,
    qty: '1',
    unitPrice: '10',
  };
  const serviceLine = { ...productLine, id: 'l2', kind: 'service', finProductId: 'fp-svc' };
  /** The read-only half: sale, lines, rule, recipes. */
  const previewSequence = (stockEntryId = 'entry-old') => [
    [ticketRow({ stockEntryId })], // loadTicketRow
    [productLine, serviceLine], // ticket lines
    [], // bundle lookup: fp-svc is not a bundle
    [{ finProductId: 'fp-prod', itemId: 'item-a', qtyPerUnit: '1' }], // recipe of what issues
    [{ finProductId: 'fp-svc', itemId: 'item-s', qtyPerUnit: '1' }], // recipe of the treatment
    [{ id: 'item-a', unitsPerStockUom: null }], // unit conversion
  ];
  const liveEntry = (lines: Array<{ itemId: string; qty: string }>) =>
    getEntryMock.mockResolvedValueOnce({ entry: { id: 'entry-old', status: 'submitted' }, lines });
  const treatmentOnly = { allowedItemIds: new Set(['item-s']) };

  it('refuses a void sale', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[ticketRow({ status: 'void', stockEntryId: 'entry-old' })]]);
    await expect(
      repostTicketStock(ctx(db), 'ticket-1', actor, treatmentOnly),
    ).rejects.toMatchObject({ code: 'already_void' });
  });

  it('refuses a sale with no live movement and never posts one', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[ticketRow({ stockEntryId: null })]]);
    await expect(
      repostTicketStock(ctx(db), 'ticket-1', actor, treatmentOnly),
    ).rejects.toMatchObject({ code: 'no_stock_entry' });
    expect(createSourcedIssueMock).not.toHaveBeenCalled();
  });

  it('refuses a change outside the named items and touches nothing', async () => {
    const { db, resolveSequence } = createMockDb();
    liveEntry([
      { itemId: 'item-a', qty: '1' },
      { itemId: 'item-s', qty: '1' },
      { itemId: 'item-x', qty: '1' }, // not in any recipe today
    ]);
    resolveSequence(previewSequence());
    await expect(
      repostTicketStock(ctx(db), 'ticket-1', actor, treatmentOnly),
    ).rejects.toMatchObject({ code: 'stock_drift' });
    expect(db.update).not.toHaveBeenCalled();
    expect(cancelEntryMock).not.toHaveBeenCalled();
  });

  it('refuses an increase', async () => {
    const { db, resolveSequence } = createMockDb();
    liveEntry([{ itemId: 'item-a', qty: '0.5' }]);
    resolveSequence(previewSequence());
    await expect(
      repostTicketStock(ctx(db), 'ticket-1', actor, { allowedItemIds: new Set(['item-a']) }),
    ).rejects.toMatchObject({ code: 'stock_drift' });
    expect(cancelEntryMock).not.toHaveBeenCalled();
  });

  it('plans nothing for a sale that is already right', async () => {
    const { db, resolveSequence } = createMockDb();
    liveEntry([{ itemId: 'item-a', qty: '1' }]);
    resolveSequence(previewSequence());
    const out = await repostTicketStock(ctx(db), 'ticket-1', actor, treatmentOnly);
    expect(out).toMatchObject({ entryId: 'entry-old', changes: [] });
    expect(db.update).not.toHaveBeenCalled();
    expect(cancelEntryMock).not.toHaveBeenCalled();
  });

  const doubled = [
    { itemId: 'item-a', qty: '1' },
    { itemId: 'item-s', qty: '1' },
  ];

  it('refuses when the stamp moved since it was read', async () => {
    const { db, resolveSequence } = createMockDb();
    liveEntry(doubled);
    resolveSequence([...previewSequence(), []]); // claim matches no row
    await expect(
      repostTicketStock(ctx(db), 'ticket-1', actor, treatmentOnly),
    ).rejects.toMatchObject({ code: 'operation_conflict' });
    expect(cancelEntryMock).not.toHaveBeenCalled();
  });

  it('restores the stamp when the cancel fails', async () => {
    const { db, resolveSequence } = createMockDb();
    liveEntry(doubled);
    resolveSequence([...previewSequence(), [{ id: 'ticket-1' }], []]); // claim, restore
    cancelEntryMock.mockRejectedValueOnce(new MockStockError('locked', 'not_submitted'));
    await expect(
      repostTicketStock(ctx(db), 'ticket-1', actor, treatmentOnly),
    ).rejects.toMatchObject({ code: 'not_submitted' });
    expect(db.update).toHaveBeenCalledTimes(2);
    expect(createSourcedIssueMock).not.toHaveBeenCalled();
  });

  /** postTicketStock after the claim: the stamp is gone, the product issues. */
  const repostSequence = [
    [{ id: 'ticket-1' }], // claim
    [ticketRow({ stockEntryId: null })], // loadTicketRow
    [productLine, serviceLine], // ticket lines
    [], // bundle lookup
    [{ finProductId: 'fp-prod', itemId: 'item-a', qtyPerUnit: '1' }], // recipe
    [{ itemId: 'item-a', qty: 5 }], // bins
    [], // item names
    [], // stampTicketStock
  ];

  it('cancels the old movement and posts the product only', async () => {
    const { db, resolveSequence } = createMockDb();
    liveEntry(doubled);
    resolveSequence([...previewSequence(), ...repostSequence]);
    cancelEntryMock.mockResolvedValue({ id: 'entry-old' });
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');
    createSourcedIssueMock.mockResolvedValue({ id: 'entry-new' });

    const out = await repostTicketStock(ctx(db), 'ticket-1', actor, treatmentOnly);

    expect(cancelEntryMock).toHaveBeenCalledWith(expect.anything(), 'entry-old', actor);
    expect(out.entryId).toBe('entry-new');
    expect(out.changes).toEqual([{ itemId: 'item-s', old: 1, new: 0, diff: -1 }]);
    const issued = createSourcedIssueMock.mock.calls[0][1] as { lines: { itemId: string }[] };
    expect(issued.lines.map((l) => l.itemId)).toEqual(['item-a']);
  });

  it('a post that fails after the cancel leaves a warning for the retry', async () => {
    const { db, resolveSequence } = createMockDb();
    liveEntry(doubled);
    resolveSequence([...previewSequence(), ...repostSequence]);
    cancelEntryMock.mockResolvedValue({ id: 'entry-old' });
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');
    createSourcedIssueMock.mockRejectedValue(new MockStockError('bin locked', 'bin_locked'));

    const out = await repostTicketStock(ctx(db), 'ticket-1', actor, treatmentOnly);

    expect(out.entryId).toBeNull();
    expect(out.stockWarning).toMatchObject({ code: 'bin_locked' });
  });
});

describe('swapTicketLineProduct — change a product on a submitted sale (spec 120)', () => {
  const line = (over: Record<string, unknown> = {}) => ({
    id: 'l1',
    orgId: 'org-1',
    ticketId: 'ticket-1',
    kind: 'product',
    finProductId: 'fp-l',
    bookingId: null,
    redemptionId: null,
    description: 'Faja L',
    qty: '1',
    unitPrice: '0',
    modifiers: null,
    ...over,
  });
  const product = (id: string, name: string, over: Record<string, unknown> = {}) => ({
    id,
    name,
    kind: 'product',
    active: true,
    unitPrice: '120.00',
    ...over,
  });
  /** Sale, line, shift, documents, period lock, both products. */
  const readSequence = (over: {
    ticket?: Record<string, unknown>;
    line?: Record<string, unknown>;
    emissions?: unknown[];
    products?: unknown[];
  }) => [
    [ticketRow(over.ticket)],
    [line(over.line)],
    [{ status: 'open' }],
    over.emissions ?? [],
    [], // no accounting lock
    over.products ?? [product('fp-l', 'Faja L'), product('fp-m', 'Faja M')],
  ];
  const swap = (db: unknown, input = { productId: 'fp-m', expectedProductId: 'fp-l' }) =>
    swapTicketLineProduct(ctx(db), 'ticket-1', 'l1', input, actor);

  it.each([
    ['a void sale', { ticket: { status: 'void' } }, 'ticket_void'],
    ['a treatment line', { line: { kind: 'service' } }, 'line_not_product'],
    ['a line someone else already changed', { line: { finProductId: 'fp-x' } }, 'line_changed'],
    [
      'a replacement at another price',
      { products: [product('fp-l', 'Faja L'), product('fp-m', 'Faja M', { unitPrice: '150' })] },
      'price_differs',
    ],
    [
      'a replacement that is a treatment',
      { products: [product('fp-l', 'Faja L'), product('fp-m', 'Masaje', { kind: 'service' })] },
      'line_not_product',
    ],
    ['an archived replacement', { products: [product('fp-l', 'Faja L')] }, 'not_found'],
    [
      'a sale with a real electronic document',
      { emissions: [{ status: 'accepted', environment: 'production' }] },
      'emitted',
    ],
  ])('refuses %s and changes nothing', async (_name, over, code) => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence(readSequence(over));
    await expect(swap(db)).rejects.toMatchObject({ code });
    expect(db.update).not.toHaveBeenCalled();
    expect(cancelEntryMock).not.toHaveBeenCalled();
  });

  it('a test-environment or failed document does not block the swap', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      ...readSequence({
        emissions: [
          { status: 'accepted', environment: 'beta' },
          { status: 'error', environment: 'production' },
        ],
      }),
      [], // recipes: neither product moves stock
      [{ status: 'submitted' }], // sale re-read under lock
      [{ id: 'l1' }], // line update
    ]);
    await expect(swap(db)).resolves.toEqual({ entryId: null, stockWarning: null });
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it('refuses when stock would move but the sale has no movement', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      ...readSequence({}),
      [
        { finProductId: 'fp-l', itemId: 'item-l', qtyPerUnit: '1' },
        { finProductId: 'fp-m', itemId: 'item-m', qtyPerUnit: '1' },
      ],
    ]);
    await expect(swap(db)).rejects.toMatchObject({ code: 'stock_drift' });
    expect(db.update).not.toHaveBeenCalled();
  });

  it('refuses before touching the line when the replacement is out of stock', async () => {
    const { db, resolveSequence } = createMockDb();
    getEntryMock.mockResolvedValue({
      entry: { id: 'entry-old', status: 'submitted' },
      lines: [{ itemId: 'item-l', qty: '1' }],
    });
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');
    resolveSequence([
      ...readSequence({ ticket: { stockEntryId: 'entry-old' } }),
      [
        { finProductId: 'fp-l', itemId: 'item-l', qtyPerUnit: '1' },
        { finProductId: 'fp-m', itemId: 'item-m', qtyPerUnit: '1' },
      ], // recipes of both products
      [ticketRow({ stockEntryId: 'entry-old' })], // preview: sale
      [line()], // preview: lines
      [{ finProductId: 'fp-l', itemId: 'item-l', qtyPerUnit: '1' }], // preview: recipe
      [{ id: 'item-l', unitsPerStockUom: null }], // preview: unit conversion
      [{ itemId: 'item-m', qty: 0 }], // bins: none of the replacement
      [{ id: 'item-m', name: 'Faja M', code: 'FAJA-M', unitsPerStockUom: null }],
    ]);
    await expect(swap(db)).rejects.toMatchObject({ code: 'negative_stock' });
    expect(db.update).not.toHaveBeenCalled();
    expect(cancelEntryMock).not.toHaveBeenCalled();
  });

  it('swapping to the same product is a no-op', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence(readSequence({ products: [product('fp-l', 'Faja L')] }));
    await expect(swap(db, { productId: 'fp-l', expectedProductId: 'fp-l' })).resolves.toMatchObject(
      { entryId: null },
    );
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe('voidTicket', () => {
  it.each([
    { facet: 'grant', grants: [{ id: 'g1', unitValue: 'NaN' }], lines: [], payments: [] },
    {
      facet: 'line',
      grants: [],
      lines: [{ unitPrice: '20', discount: '0', total: 'NaN' }],
      payments: [],
    },
    { facet: 'payment', grants: [], lines: [], payments: [{ amount: '20', tendered: 'Infinity' }] },
  ])(
    'rejects corrupt $facet money before any stock or financial effect',
    async ({ grants, lines, payments }) => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([
        [ticketRow({ stockEntryId: 'entry-1' })],
        [], // no accounting lock on the ticket's month
        [{ status: 'open' }],
        [],
        grants,
        [],
        lines,
        payments,
      ]);
      await expect(voidTicket(ctx(db), 'ticket-1', actor)).rejects.toMatchObject({
        code: 'invalid_stored_amount',
      });
      expect(cancelEntryMock).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    },
  );

  it('happy path: cancels the linked stock entry and marks the ticket void', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [ticketRow({ id: 't1', stockEntryId: 'entry-1' })], // loadTicketRow
      [], // no accounting lock on the ticket's month (spec 2026-10-15 T4)
      [{ id: 'shift-1' }], // the actor's open shift (cash refund preflight)
      [], // live redemptions created by this ticket
      [], // grants minted by this ticket
      [], // ledger money preflight before stock cancellation
      [], // ticket line preflight
      [], // payment preflight
      [{ id: 'shift-1' }], // the refund shift, re-read inside the money tx
      [], // client-ledger rows to reverse
      [ticketRow({ id: 't1', status: 'void', stockEntryId: 'entry-1' })], // update returning
    ]);
    cancelEntryMock.mockResolvedValue({ id: 'entry-1' });

    const result = await voidTicket(ctx(db), 't1', actor);
    expect(cancelEntryMock).toHaveBeenCalledWith(expect.anything(), 'entry-1', actor);
    expect(result.status).toBe('void');
  });

  it('cancels a movement a racing rebuild posted after the void read the sale (spec 120)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [ticketRow({ id: 't1', stockEntryId: null })], // loadTicketRow: stamp claimed by the rebuild
      [], // no accounting lock
      [{ id: 'shift-1' }], // the actor's open shift
      [], // live redemptions
      [], // grants
      [], // ledger money preflight
      [], // ticket line preflight
      [], // payment preflight
      [{ id: 'shift-1' }], // the refund shift, re-read inside the money tx
      [], // client-ledger rows to reverse
      [ticketRow({ id: 't1', status: 'void', stockEntryId: null })], // update returning
    ]);
    findEntryBySourceMock.mockResolvedValue({ id: 'entry-raced', status: 'submitted' });
    cancelEntryMock.mockResolvedValue({ id: 'entry-raced' });

    const result = await voidTicket(ctx(db), 't1', actor);

    expect(cancelEntryMock).toHaveBeenCalledWith(expect.anything(), 'entry-raced', actor);
    expect(result.status).toBe('void');
  });

  it('a failing final lookup never fails a committed void: it stores a warning', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [ticketRow({ id: 't1', stockEntryId: null })],
      [],
      [{ id: 'shift-1' }],
      [],
      [],
      [],
      [],
      [],
      [{ id: 'shift-1' }],
      [],
      [ticketRow({ id: 't1', status: 'void', stockEntryId: null })],
      [], // warning update
    ]);
    findEntryBySourceMock.mockResolvedValue({ id: 'entry-raced', status: 'submitted' });
    cancelEntryMock.mockRejectedValue(new MockStockError('no ledger', 'no_ledger'));

    const result = await voidTicket(ctx(db), 't1', actor);

    expect(result.status).toBe('void');
    expect(result.stockWarning).toMatchObject({ code: 'void_stock_failed' });
  });

  it('a sale that moved no stock (services only, spec 120) voids cleanly: nothing to cancel, no warning', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [ticketRow({ id: 't1', stockEntryId: null })], // loadTicketRow
      [], // no accounting lock
      [{ id: 'shift-1' }], // the actor's open shift
      [], // live redemptions
      [], // grants
      [], // ledger money preflight
      [], // ticket line preflight
      [], // payment preflight
      [{ id: 'shift-1' }], // the refund shift, re-read inside the money tx
      [], // client-ledger rows to reverse
      [ticketRow({ id: 't1', status: 'void', stockEntryId: null })], // update returning
    ]);

    const result = await voidTicket(ctx(db), 't1', actor);
    expect(cancelEntryMock).not.toHaveBeenCalled();
    expect(result.status).toBe('void');
    expect(result.stockWarning ?? null).toBeNull();
  });

  it.each([
    { amount: 'NaN', currency: 'PEN', code: 'invalid_stored_amount' },
    { amount: '-50.00', currency: 'JPY', code: 'unsupported_pos_currency' },
  ])('rejects invalid historical ledger money before stock effects: $code', async (money) => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [ticketRow({ id: 't1', stockEntryId: 'entry-1' })],
      [], // no accounting lock
      [{ status: 'open' }],
      [],
      [],
      [money],
    ]);
    await expect(voidTicket(ctx(db), 't1', actor)).rejects.toMatchObject({ code: money.code });
    expect(cancelEntryMock).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('throws reconciled when invoiceProviderRef is set', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[ticketRow({ id: 't2', invoiceProviderRef: 'INV-1' })]]);
    await expect(voidTicket(ctx(db), 't2', actor)).rejects.toMatchObject({ code: 'reconciled' });
  });

  it('throws no_open_shift for a cash refund when the actor has no open shift — before any effect', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[ticketRow({ id: 't3', stockEntryId: 'entry-1' })], []]);
    await expect(voidTicket(ctx(db), 't3', actor)).rejects.toMatchObject({
      code: 'no_open_shift',
    });
    expect(cancelEntryMock).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('throws no_party for a store-credit refund on an anonymous ticket', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[ticketRow({ id: 't3', partyId: null })]]);
    await expect(voidTicket(ctx(db), 't3', actor, { refund: 'credit' })).rejects.toMatchObject({
      code: 'no_party',
    });
  });

  it('throws period_locked when the accountant closed the month — before any effect (T4)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [ticketRow({ id: 't5', stockEntryId: 'entry-1', invoiceProviderRef: 'INV-1' })],
      [{ id: 'lock-1' }], // the lock read answers first
    ]);
    await expect(voidTicket(ctx(db), 't5', actor)).rejects.toMatchObject({
      code: 'period_locked',
      message: 'Periodo cerrado por contabilidad',
    });
    expect(cancelEntryMock).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('throws already_void on repeat', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[ticketRow({ id: 't4', status: 'void' })]]);
    await expect(voidTicket(ctx(db), 't4', actor)).rejects.toMatchObject({ code: 'already_void' });
  });
});

/**
 * `pos_settings.requirements.identityDocument` — the per-org "a DNI/RUC on
 * every invoice" rule (FACES needs it; other orgs turn it off). The PARTY SPINE
 * is the authority: a typed-in customerName is not an identity.
 */
describe('submitTicket — identity-document requirement', () => {
  const settingsRow = (requirements: unknown) => [
    {
      orgId: 'org-1',
      methods: ['cash'],
      currency: 'PEN',
      requireCustomer: false,
      allowPriceOverride: true,
      emission: { mode: 'off', docTypeDefault: '03' },
      requirements,
    },
  ];
  const settingsRevision = (requirements: unknown) =>
    paymentPolicyRevision({
      currency: 'PEN',
      methods: normalizeMethods(['cash']),
      requireCustomer: false,
      allowPriceOverride: true,
      emission: { mode: 'off', docTypeDefault: '03' },
      requirements: normalizeRequirements(requirements),
    });
  const withRequirements = (requirements: unknown, input: SubmitTicketInput = oneLine) => ({
    ...input,
    paymentPolicyRevision: settingsRevision(requirements),
  });
  const oneLine: SubmitTicketInput = {
    lines: [{ kind: 'service', description: 'Limpieza', qty: 1, unitPrice: 10 }],
    payments: [{ method: 'cash', amount: 10, tendered: 10 }],
    actor,
  };

  it('off (the default, and an empty `{}` jsonb) never blocks and never queries the party', async () => {
    const { db, resolveSequence } = createMockDb();
    // settings, then the open-shift lookup. No party read in between — if the
    // guard queried here, the shift lookup would consume the wrong result.
    resolveSequence([settingsRow({}), settingsRow({}), []]);
    await expect(submitTicket(ctx(db), withRequirements({}))).rejects.toMatchObject({
      code: 'no_open_shift',
    });
  });

  it('required + no customer at all → identity_document_required', async () => {
    const { db, resolveSequence } = createMockDb();
    const requirements = { identityDocument: 'required' };
    resolveSequence([settingsRow(requirements), settingsRow(requirements)]);
    await expect(
      submitTicket(
        ctx(db),
        withRequirements(requirements, { ...oneLine, customerName: 'Walk-in' }),
      ),
    ).rejects.toMatchObject({ code: 'identity_document_required' });
  });

  it('required + a party WITHOUT doc_number → identity_document_required', async () => {
    const { db, resolveSequence } = createMockDb();
    const requirements = { identityDocument: 'required' };
    resolveSequence([
      settingsRow(requirements),
      settingsRow(requirements),
      [{ id: 'party-1' }],
      [{ id: 'party-1', docNumber: null }],
    ]);
    await expect(
      submitTicket(
        ctx(db),
        withRequirements(requirements, { ...oneLine, partyId: 'party-1', customerName: 'Ana' }),
      ),
    ).rejects.toMatchObject({ code: 'identity_document_required' });
  });

  it('required + a party WITH doc_number passes the guard (falls through to the shift check)', async () => {
    const { db, resolveSequence } = createMockDb();
    const requirements = { identityDocument: 'required' };
    resolveSequence([
      settingsRow(requirements),
      settingsRow(requirements),
      [{ id: 'party-1' }],
      [{ id: 'party-1', docNumber: '12345678' }],
      [], // open-shift lookup: none
    ]);
    await expect(
      submitTicket(
        ctx(db),
        withRequirements(requirements, { ...oneLine, partyId: 'party-1', customerName: 'Ana' }),
      ),
    ).rejects.toMatchObject({ code: 'no_open_shift' });
  });

  it("'optional' is a nudge, not a block", async () => {
    const { db, resolveSequence } = createMockDb();
    const requirements = { identityDocument: 'optional' };
    resolveSequence([settingsRow(requirements), settingsRow(requirements), []]);
    await expect(submitTicket(ctx(db), withRequirements(requirements))).rejects.toMatchObject({
      code: 'no_open_shift',
    });
  });

  // The registry: any kind set to 'required' is checked the same way, with
  // its own error code, and a party missing several fails on the FIRST kind.
  it('phone required + a party WITHOUT phone9 → phone_required', async () => {
    const { db, resolveSequence } = createMockDb();
    const requirements = { phone: 'required' };
    resolveSequence([
      settingsRow(requirements),
      settingsRow(requirements),
      [{ id: 'party-1' }],
      [{ id: 'party-1', docNumber: '12345678', phone9: null }],
    ]);
    await expect(
      submitTicket(
        ctx(db),
        withRequirements(requirements, { ...oneLine, partyId: 'party-1', customerName: 'Ana' }),
      ),
    ).rejects.toMatchObject({ code: 'phone_required' });
  });

  it('document + phone required, party has both → passes the guard', async () => {
    const { db, resolveSequence } = createMockDb();
    const requirements = { identityDocument: 'required', phone: 'required' };
    resolveSequence([
      settingsRow(requirements),
      settingsRow(requirements),
      [{ id: 'party-1' }],
      [{ id: 'party-1', docNumber: '12345678', phone9: '987654321' }],
      [], // open-shift lookup: none
    ]);
    await expect(
      submitTicket(
        ctx(db),
        withRequirements(requirements, { ...oneLine, partyId: 'party-1', customerName: 'Ana' }),
      ),
    ).rejects.toMatchObject({ code: 'no_open_shift' });
  });
});

// ── Preflight compares in STOCK uom: a recipe written in ml must not be read
// against bins kept in boxes (5 ml of a 500 ml box is 0.01 box, not 5 boxes).
describe('submitTicket — stock preflight uom conversion', () => {
  const recipeLines = [
    {
      id: 'line-1',
      orgId: 'org-1',
      ticketId: 'ticket-1',
      kind: 'product',
      finProductId: 'fp-svc',
      bookingId: null,
      qty: '2',
      unitPrice: '10',
      discount: '0',
      total: '20',
      lineNo: 0,
    },
  ];
  const recipe = [{ finProductId: 'fp-svc', itemId: 'item-b', qtyPerUnit: '5' }];
  const serum = [{ id: 'item-b', name: 'Serum', code: 'SER', unitsPerStockUom: '500' }];
  const input: SubmitTicketInput = {
    lines: [
      { kind: 'product', finProductId: 'fp-svc', description: 'Facial', qty: 2, unitPrice: 10 },
    ],
    payments: [{ method: 'cash', amount: 20, tendered: 20 }],
    actor,
  };

  it('1 box covers 2 × 5 ml — not refused', async () => {
    const { db, resolveSequence } = createMockDb();
    mockExecute(db, [{ n: 1 }]);
    resolveSequence([
      [], // settings
      [], // fin_product_components
      recipe, // preflight: stk_consumption
      [{ itemId: 'item-b', qty: 1 }], // preflight bins: 1 box
      serum, // preflight item facts (500 ml / box)
      [], // settings re-read under the transaction lock
      [openShiftRow],
      [ticketRow()],
      [{ id: 'line-1', lineNo: 0 }],
      [], // payments
      [ticketRow()], // postTicketStock
      recipeLines,
      recipe,
      [{ itemId: 'item-b', qty: 1 }],
      serum,
      [], // stamp
    ]);
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');
    createSourcedIssueMock.mockResolvedValue({ id: 'entry-1' });

    const result = await submitTicket(ctx(db), input);
    expect(result.stockWarning).toBeNull();
    const call = createSourcedIssueMock.mock.calls[0][1] as {
      lines: { itemId: string; qtyConsumption?: number }[];
    };
    expect(call.lines).toEqual([{ itemId: 'item-b', qty: 10, qtyConsumption: 10 }]);
  });

  it('0.01 box does not cover 2 × 5 ml — refused, requested reported in stock uom', async () => {
    const { db, resolveSequence } = createMockDb();
    mockExecute(db, [{ n: 1 }]);
    resolveSequence([
      [], // settings
      [], // fin_product_components
      recipe,
      [{ itemId: 'item-b', qty: 0.01 }], // 5 ml left
      serum,
    ]);
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');

    await expect(submitTicket(ctx(db), input)).rejects.toMatchObject({
      code: 'insufficient_stock',
      message: expect.stringContaining('requested 0.02, available 0.01'),
    });
    expect(db.insert).not.toHaveBeenCalled();
  });
});
