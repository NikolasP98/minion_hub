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
const findEntryBySourceMock = vi.fn<(ctx: unknown, source: string, sourceId: string) => Promise<{ id: string; status: string } | null>>();
const submitEntryMock = vi.fn<(ctx: unknown, id: string, actor: unknown) => Promise<{ id: string }>>();
const cancelEntryMock = vi.fn<(ctx: unknown, id: string, actor: unknown) => Promise<{ id: string }>>();
const listAllComponentEdgesMock = vi.fn<(ctx: unknown) => Promise<Array<{ parentItemId: string; childItemId: string; qty: number }>>>();
vi.mock('./stock.service', () => ({
  createSourcedIssue: (ctx: unknown, input: unknown) => createSourcedIssueMock(ctx, input),
  findEntryBySource: (ctx: unknown, source: string, sourceId: string) => findEntryBySourceMock(ctx, source, sourceId),
  submitEntry: (ctx: unknown, id: string, actor: unknown) => submitEntryMock(ctx, id, actor),
  cancelEntry: (ctx: unknown, id: string, actor: unknown) => cancelEntryMock(ctx, id, actor),
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

import { submitTicket, postTicketStock, voidTicket, computeTicketTotals, type SubmitTicketInput } from './pos.service';

/** The mock `Db` is typed as the sqlite/libsql client and doesn't expose
 *  `execute` — narrow-cast to reach the vi.fn the mock harness caches there. */
function mockExecute(db: unknown, value: unknown) {
  (db as { execute: ReturnType<typeof vi.fn> }).execute.mockResolvedValue(value);
}

beforeEach(() => {
  vi.clearAllMocks();
  findEntryBySourceMock.mockResolvedValue(null);
  // Default: no components anywhere => the explosion is the identity, so every
  // pre-Slice-1b expectation still describes the behaviour exactly.
  listAllComponentEdgesMock.mockResolvedValue([]);
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
    expect(computeTicketTotals([
      { kind: 'product', description: 'A', qty: 2, unitPrice: 10 },
      { kind: 'service', description: 'B', qty: 1, unitPrice: 50 },
    ])).toEqual({ lineTotals: [20, 50], subtotal: 70, discount: 0, total: 70 });
  });

  it('line discount is applied per line, inside the line total', () => {
    expect(computeTicketTotals([
      { kind: 'product', description: 'A', qty: 3, unitPrice: 10, discount: 5 },
    ])).toEqual({ lineTotals: [25], subtotal: 25, discount: 0, total: 25 });
  });

  it('ticket-level discount is subtracted once from the subtotal, not per line', () => {
    expect(computeTicketTotals([
      { kind: 'product', description: 'A', qty: 1, unitPrice: 40 },
      { kind: 'product', description: 'B', qty: 1, unitPrice: 60 },
    ], 10)).toEqual({ lineTotals: [40, 60], subtotal: 100, discount: 10, total: 90 });
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

  it('zero_price when a line has unitPrice <= 0', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]); // settings only
    const input: SubmitTicketInput = {
      lines: [{ kind: 'product', description: 'X', qty: 1, unitPrice: 0 }],
      payments: [{ method: 'cash', amount: 0, tendered: 0 }],
      actor,
    };
    await expect(submitTicket(ctx(db), input)).rejects.toMatchObject({ code: 'zero_price' });
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
      [openShiftRow], // open shift
      [ticketRow()], // insert ticket returning
      [], // insert lines
      [], // insert payments
      [ticketRow()], // postTicketStock: loadTicketRow
      [{ id: 'line-1', orgId: 'org-1', ticketId: 'ticket-1', kind: 'product', finProductId: 'fp-1', bookingId: null, qty: '2', unitPrice: '10', discount: '0', total: '20', lineNo: 0 }], // ticket lines
      [{ id: 'item-1', finProductId: 'fp-1' }], // stk_items batch lookup
      [], // stampTicketStock update
    ]);
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');
    createSourcedIssueMock.mockResolvedValue({ id: 'entry-1' });

    const input: SubmitTicketInput = {
      lines: [{ kind: 'product', finProductId: 'fp-1', description: 'Retail', qty: 2, unitPrice: 10 }],
      payments: [{ method: 'cash', amount: 20, tendered: 20 }],
      actor,
    };
    const result = await submitTicket(ctx(db), input);

    expect(result.ticket.id).toBe('ticket-1');
    expect(result.ticket.humanId).toBe('POS-2026-00001');
    expect(result.stockWarning).toBeNull();
    expect(db.insert).toHaveBeenCalled();
    expect(createSourcedIssueMock).toHaveBeenCalledTimes(1);
    const call = createSourcedIssueMock.mock.calls[0][1] as { lines: { itemId: string; qty: number }[]; warehouseId: string; source: string; sourceId: string };
    expect(call.lines).toEqual([{ itemId: 'item-1', qty: 2 }]);
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
      [openShiftRow], // open shift
      [ticketRow({ total: '70', subtotal: '70' })], // insert ticket returning
      [], // insert lines
      [], // insert payments
      [ticketRow({ total: '70', subtotal: '70' })], // postTicketStock: loadTicketRow
      [
        { id: 'line-1', orgId: 'org-1', ticketId: 'ticket-1', kind: 'service', finProductId: 'fp-svc', bookingId: 'bkg-1', qty: '1', unitPrice: '50', discount: '0', total: '50', lineNo: 0 },
        { id: 'line-2', orgId: 'org-1', ticketId: 'ticket-1', kind: 'product', finProductId: 'fp-1', bookingId: null, qty: '2', unitPrice: '10', discount: '0', total: '20', lineNo: 1 },
      ], // ticket lines
      [{ id: 'item-1', finProductId: 'fp-1' }], // stk_items batch lookup — booking line's fin id never queried
      [], // stampTicketStock update
    ]);
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');
    createSourcedIssueMock.mockResolvedValue({ id: 'entry-2' });

    const input: SubmitTicketInput = {
      lines: [
        { kind: 'service', finProductId: 'fp-svc', bookingId: 'bkg-1', description: 'Massage', qty: 1, unitPrice: 50 },
        { kind: 'product', finProductId: 'fp-1', description: 'Retail', qty: 2, unitPrice: 10 },
      ],
      payments: [{ method: 'cash', amount: 70, tendered: 70 }],
      actor,
    };
    await submitTicket(ctx(db), input);

    const call = createSourcedIssueMock.mock.calls[0][1] as { lines: { itemId: string; qty: number }[] };
    expect(call.lines).toEqual([{ itemId: 'item-1', qty: 2 }]);
  });
});

describe('postTicketStock — line resolution', () => {
  it('product 1:1, service via stk_consumption (qty × qtyPerUnit), unmapped lines resolve to nothing', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [ticketRow({ id: 'ticket-8' })], // loadTicketRow
      [
        { id: 'l1', orgId: 'org-1', ticketId: 'ticket-8', kind: 'product', finProductId: 'fp-prod', bookingId: null, qty: '3', unitPrice: '10' },
        { id: 'l2', orgId: 'org-1', ticketId: 'ticket-8', kind: 'service', finProductId: 'fp-svc', bookingId: null, qty: '2', unitPrice: '30' },
        { id: 'l3', orgId: 'org-1', ticketId: 'ticket-8', kind: 'product', finProductId: 'fp-unmapped', bookingId: null, qty: '1', unitPrice: '5' },
      ], // ticket lines
      [{ id: 'item-a', finProductId: 'fp-prod' }], // stk_items batch lookup (fp-unmapped has no match)
      [{ finProductId: 'fp-svc', itemId: 'item-b', qtyPerUnit: '5' }], // stk_consumption batch lookup
      [], // stampTicketStock update
    ]);
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');
    createSourcedIssueMock.mockResolvedValue({ id: 'entry-9' });

    await postTicketStock(ctx(db), 'ticket-8', actor);

    const call = createSourcedIssueMock.mock.calls[0][1] as { lines: { itemId: string; qty: number; qtyConsumption?: number }[] };
    expect(call.lines).toEqual([
      { itemId: 'item-a', qty: 3 }, // 1:1
      { itemId: 'item-b', qty: 10, qtyConsumption: 10 }, // 2 × 5 consumption-UOM
    ]);
  });

  // ── Precedence: an authored recipe outranks the implicit 1:1 bridge ──────
  // spec 2026-07-19-pos-stock-split. `kind` is no longer consulted, so a
  // product-kind sellable may carry a recipe.
  it('product-kind WITH a real recipe explodes the recipe and does NOT issue itself', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [ticketRow({ id: 'ticket-r1' })],
      [{ id: 'l1', orgId: 'org-1', ticketId: 'ticket-r1', kind: 'product', finProductId: 'fp-kit', bookingId: null, qty: '2', unitPrice: '40' }],
      [{ id: 'item-kit', finProductId: 'fp-kit' }], // bridge exists…
      [
        // …but a real recipe naming OTHER items wins over it
        { finProductId: 'fp-kit', itemId: 'item-x', qtyPerUnit: '3' },
        { finProductId: 'fp-kit', itemId: 'item-y', qtyPerUnit: '1' },
      ],
      [],
    ]);
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');
    createSourcedIssueMock.mockResolvedValue({ id: 'entry-r1' });

    await postTicketStock(ctx(db), 'ticket-r1', actor);

    const call = createSourcedIssueMock.mock.calls[0][1] as { lines: { itemId: string; qty: number; qtyConsumption?: number }[] };
    expect(call.lines).toEqual([
      { itemId: 'item-x', qty: 6, qtyConsumption: 6 }, // 2 × 3 consumption-UOM
      { itemId: 'item-y', qty: 2, qtyConsumption: 2 }, // 2 × 1 consumption-UOM
    ]);
    expect(call.lines.some((l) => l.itemId === 'item-kit')).toBe(false); // finished good NOT issued
  });

  it('preserves separate stock and consumption quantities when two lines reach the same item', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [ticketRow({ id: 'ticket-mixed-uom' })],
      [
        { id: 'l1', orgId: 'org-1', ticketId: 'ticket-mixed-uom', kind: 'product', finProductId: 'fp-vial', bookingId: null, qty: '1', unitPrice: '20' },
        { id: 'l2', orgId: 'org-1', ticketId: 'ticket-mixed-uom', kind: 'service', finProductId: 'fp-procedure', bookingId: null, qty: '1', unitPrice: '80' },
      ],
      [{ id: 'item-h', finProductId: 'fp-vial' }],
      [{ finProductId: 'fp-procedure', itemId: 'item-h', qtyPerUnit: '10' }],
      [],
    ]);
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');
    createSourcedIssueMock.mockResolvedValue({ id: 'entry-mixed-uom' });

    await postTicketStock(ctx(db), 'ticket-mixed-uom', actor);

    const call = createSourcedIssueMock.mock.calls[0][1] as { lines: { itemId: string; qty: number; qtyConsumption?: number }[] };
    expect(call.lines).toEqual([
      { itemId: 'item-h', qty: 1 }, // one whole vial sold
      { itemId: 'item-h', qty: 10, qtyConsumption: 10 }, // plus 10 mL consumed by the procedure
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
          kind: 'service',
          finProductId: 'fp-procedure',
          bookingId: null,
          qty: '1',
          unitPrice: '80',
          modifiers: [{ action: 'add', itemId: 'item-drink', qty: 1 }],
        },
      ],
      [],
      [
        { finProductId: 'fp-procedure', itemId: 'item-a', qtyPerUnit: '1' },
        { finProductId: 'fp-procedure', itemId: 'item-b', qtyPerUnit: '2' },
      ],
      [],
    ]);
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');
    createSourcedIssueMock.mockResolvedValue({ id: 'entry-mod' });

    await postTicketStock(ctx(db), 'ticket-mod', actor);

    const call = createSourcedIssueMock.mock.calls[0][1] as { lines: { itemId: string; qty: number; qtyConsumption?: number }[] };
    expect(call.lines).toEqual([
      { itemId: 'item-drink', qty: 1 },
      { itemId: 'item-a', qty: 1, qtyConsumption: 1 },
      { itemId: 'item-b', qty: 2, qtyConsumption: 2 },
    ]);
  });

  it('a self-mapping recipe acts as a qty multiplier on the bridge item', async () => {
    // The real Hialuronidasa shape: the only recipe row points at the
    // product's own item, so it multiplies rather than substituting.
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [ticketRow({ id: 'ticket-r2' })],
      [{ id: 'l1', orgId: 'org-1', ticketId: 'ticket-r2', kind: 'product', finProductId: 'fp-h', bookingId: null, qty: '2', unitPrice: '80' }],
      [{ id: 'item-h', finProductId: 'fp-h' }],
      [{ finProductId: 'fp-h', itemId: 'item-h', qtyPerUnit: '10' }], // self-map
      [],
    ]);
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');
    createSourcedIssueMock.mockResolvedValue({ id: 'entry-r2' });

    await postTicketStock(ctx(db), 'ticket-r2', actor);

    const call = createSourcedIssueMock.mock.calls[0][1] as { lines: { itemId: string; qty: number; qtyConsumption?: number }[] };
    expect(call.lines).toEqual([{ itemId: 'item-h', qty: 20, qtyConsumption: 20 }]); // 20 mL; stock service converts using vial capacity
  });

  it('a sold COMPOSITE consumes its leaves, not itself (Slice 1b explosion)', async () => {
    // fp-plate resolves 1:1 to item-plate, which is a recipe:
    //   plate -> 2 mash -> 3 potato  => 1 plate sold = 6 potato consumed
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [ticketRow({ id: 'ticket-x1' })],
      [{ id: 'l1', orgId: 'org-1', ticketId: 'ticket-x1', kind: 'product', finProductId: 'fp-plate', bookingId: null, qty: '1', unitPrice: '90' }],
      [{ id: 'item-plate', finProductId: 'fp-plate' }], // bridge
      [], // no stk_consumption recipe
      [
        // stk_items is_stock_item flags for the explosion
        { id: 'item-plate', isStockItem: false },
        { id: 'item-mash', isStockItem: false },
        { id: 'item-potato', isStockItem: true },
      ],
      [], // stampTicketStock
    ]);
    listAllComponentEdgesMock.mockResolvedValue([
      { parentItemId: 'item-plate', childItemId: 'item-mash', qty: 2 },
      { parentItemId: 'item-mash', childItemId: 'item-potato', qty: 3 },
    ]);
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');
    createSourcedIssueMock.mockResolvedValue({ id: 'entry-x1' });

    await postTicketStock(ctx(db), 'ticket-x1', actor);

    const call = createSourcedIssueMock.mock.calls[0][1] as { lines: { itemId: string; qty: number; qtyConsumption?: number }[] };
    expect(call.lines).toEqual([{ itemId: 'item-potato', qty: 6, qtyConsumption: 6 }]);
    // the composite and the intermediate sub-recipe are never issued
    expect(call.lines.some((l) => l.itemId === 'item-plate' || l.itemId === 'item-mash')).toBe(false);
  });

  it('service-kind WITHOUT a recipe but WITH a bridge falls back to 1:1', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [ticketRow({ id: 'ticket-r3' })],
      [{ id: 'l1', orgId: 'org-1', ticketId: 'ticket-r3', kind: 'service', finProductId: 'fp-s', bookingId: null, qty: '4', unitPrice: '15' }],
      [{ id: 'item-s', finProductId: 'fp-s' }],
      [], // no recipe
      [],
    ]);
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');
    createSourcedIssueMock.mockResolvedValue({ id: 'entry-r3' });

    await postTicketStock(ctx(db), 'ticket-r3', actor);

    const call = createSourcedIssueMock.mock.calls[0][1] as { lines: { itemId: string; qty: number }[] };
    expect(call.lines).toEqual([{ itemId: 'item-s', qty: 4 }]);
  });
});

describe('submitTicket — stock fail-soft', () => {
  it('a StockError from the stock post degrades to a stockWarning; the ticket still returns', async () => {
    const { db, resolveSequence } = createMockDb();
    mockExecute(db, [{ n: 1 }]);
    resolveSequence([
      [], // settings
      [openShiftRow], // open shift
      [ticketRow({ id: 'ticket-9' })], // insert ticket returning
      [], // insert lines
      [], // insert payments
      [ticketRow({ id: 'ticket-9' })], // postTicketStock: loadTicketRow
      [{ id: 'line-1', orgId: 'org-1', ticketId: 'ticket-9', kind: 'product', finProductId: 'fp-1', bookingId: null, qty: '1', unitPrice: '20' }], // ticket lines
      [{ id: 'item-1', finProductId: 'fp-1' }], // stk_items batch lookup
      [], // stampTicketStock update (stores the warning)
    ]);
    resolveDefaultWarehouseMock.mockResolvedValue('wh-1');
    createSourcedIssueMock.mockRejectedValue(new MockStockError('insufficient stock', 'negative_stock'));

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

describe('voidTicket', () => {
  it('happy path: cancels the linked stock entry and marks the ticket void', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [ticketRow({ id: 't1', stockEntryId: 'entry-1' })], // loadTicketRow
      [{ status: 'open' }], // shift lookup
      [ticketRow({ id: 't1', status: 'void', stockEntryId: 'entry-1' })], // update returning
    ]);
    cancelEntryMock.mockResolvedValue({ id: 'entry-1' });

    const result = await voidTicket(ctx(db), 't1', actor);
    expect(cancelEntryMock).toHaveBeenCalledWith(expect.anything(), 'entry-1', actor);
    expect(result.status).toBe('void');
  });

  it('throws reconciled when invoiceProviderRef is set', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[ticketRow({ id: 't2', invoiceProviderRef: 'INV-1' })]]);
    await expect(voidTicket(ctx(db), 't2', actor)).rejects.toMatchObject({ code: 'reconciled' });
  });

  it('throws shift_closed when its shift is not open', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[ticketRow({ id: 't3' })], [{ status: 'closed' }]]);
    await expect(voidTicket(ctx(db), 't3', actor)).rejects.toMatchObject({ code: 'shift_closed' });
  });

  it('throws already_void on repeat', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[ticketRow({ id: 't4', status: 'void' })]]);
    await expect(voidTicket(ctx(db), 't4', actor)).rejects.toMatchObject({ code: 'already_void' });
  });
});
