import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

// ── finance-products.service mock (upsertProduct) ──
const upsertProductMock = vi.fn<(ctx: unknown, p: unknown) => Promise<void>>();
vi.mock('./finance-products.service', () => ({
  upsertProduct: (ctx: unknown, p: unknown) => upsertProductMock(ctx, p),
}));

// ── stock.service mock — sellables slice only; ticket-flow exports are
// stubbed no-ops since pos.sellables.test.ts never exercises them ──
const createItemMock = vi.fn<(ctx: unknown, input: unknown) => Promise<{ id: string }>>();
const updateItemMock = vi.fn<(ctx: unknown, id: string, patch: unknown) => Promise<{ id: string } | null>>();
const setConsumptionMock = vi.fn<(ctx: unknown, input: unknown, actor: unknown) => Promise<{ id: string }>>();
const deleteConsumptionMock = vi.fn<(ctx: unknown, id: string) => Promise<boolean>>();
const listConsumptionMock = vi.fn<(ctx: unknown, filters: unknown) => Promise<Array<{ id: string; itemId: string }>>>();
vi.mock('./stock.service', () => ({
  createSourcedIssue: vi.fn(),
  findEntryBySource: vi.fn(),
  submitEntry: vi.fn(),
  cancelEntry: vi.fn(),
  StockError: class StockError extends Error {},
  createItem: (ctx: unknown, input: unknown) => createItemMock(ctx, input),
  updateItem: (ctx: unknown, id: string, patch: unknown) => updateItemMock(ctx, id, patch),
  setConsumption: (ctx: unknown, input: unknown, actor: unknown) => setConsumptionMock(ctx, input, actor),
  deleteConsumption: (ctx: unknown, id: string) => deleteConsumptionMock(ctx, id),
  listConsumption: (ctx: unknown, filters: unknown) => listConsumptionMock(ctx, filters),
}));

import { listSellables, createSellable, updateSellable, slugifyCode, type SellableInput } from './pos.service';

/** The mock `Db` is typed as the sqlite/libsql client and doesn't expose
 *  `execute` — narrow-cast to reach the vi.fn the mock harness caches there. */
function mockExecute(db: unknown, value: unknown) {
  (db as { execute: ReturnType<typeof vi.fn> }).execute.mockResolvedValue(value);
}

beforeEach(() => {
  vi.clearAllMocks();
});

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });
const actor = { id: 'u1', name: 'Test User' };

describe('slugifyCode — pure', () => {
  it('uppercases and dash-joins non-alnum runs, no leading/trailing dash', () => {
    expect(slugifyCode('BOTOX 50U')).toBe('BOTOX-50U');
    expect(slugifyCode('  hydra facial! ')).toBe('HYDRA-FACIAL');
    expect(slugifyCode('already-CODE')).toBe('ALREADY-CODE');
  });
});

describe('listSellables', () => {
  it('merges product+item+bins+mapping — kind derives from a linked stk_items row, item w/o bins → stockQty 0', async () => {
    const { db } = createMockDb();
    mockExecute(db, [
      { id: 'fp-1', code: 'BOTOX', name: 'Botox', category: 'injectables', unit_price: '250', active: true, item_id: 'item-1', stock_qty: '12', has_mapping: false },
      { id: 'fp-2', code: 'CONSULT', name: 'Consulta', category: null, unit_price: null, active: true, item_id: null, stock_qty: null, has_mapping: true },
      { id: 'fp-3', code: 'FILLER', name: 'Filler', category: null, unit_price: '300', active: true, item_id: 'item-2', stock_qty: null, has_mapping: false },
    ]);

    const rows = await listSellables(ctx(db));

    expect(rows).toEqual([
      { productId: 'fp-1', code: 'BOTOX', name: 'Botox', category: 'injectables', unitPrice: 250, active: true, kind: 'product', itemId: 'item-1', stockQty: 12, hasMapping: false },
      { productId: 'fp-2', code: 'CONSULT', name: 'Consulta', category: null, unitPrice: null, active: true, kind: 'service', itemId: null, stockQty: null, hasMapping: true },
      { productId: 'fp-3', code: 'FILLER', name: 'Filler', category: null, unitPrice: 300, active: true, kind: 'product', itemId: 'item-2', stockQty: 0, hasMapping: false },
    ]);
  });
});

describe('createSellable', () => {
  it('service-kind writes the product only — no item, no consumption', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'fp-1' }]]); // select product id by code
    mockExecute(db, [{ id: 'fp-1', code: 'CONSULT', name: 'Consulta', category: null, unit_price: null, active: true, item_id: null, stock_qty: null, has_mapping: false }]);
    upsertProductMock.mockResolvedValue(undefined);

    const input: SellableInput = { name: 'Consulta', code: 'CONSULT', unitPrice: null, kind: 'service' };
    const row = await createSellable(ctx(db), input, actor);

    expect(upsertProductMock).toHaveBeenCalledWith(expect.anything(), { code: 'CONSULT', name: 'Consulta', category: null, unitPrice: null, active: true });
    expect(createItemMock).not.toHaveBeenCalled();
    expect(setConsumptionMock).not.toHaveBeenCalled();
    expect(row.kind).toBe('service');
    expect(row.itemId).toBeNull();
  });

  it('product-kind + trackStock writes product + item with a finProductId link — code reused, uom passed', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'fp-2' }]]); // select product id by code
    mockExecute(db, [{ id: 'fp-2', code: 'BOTOX', name: 'Botox', category: null, unit_price: '250', active: true, item_id: 'item-9', stock_qty: '0', has_mapping: false }]);
    upsertProductMock.mockResolvedValue(undefined);
    createItemMock.mockResolvedValue({ id: 'item-9' });

    const input: SellableInput = { name: 'Botox', code: 'BOTOX', unitPrice: 250, kind: 'product', trackStock: true, uom: 'vial' };
    const row = await createSellable(ctx(db), input, actor);

    expect(createItemMock).toHaveBeenCalledWith(expect.anything(), { code: 'BOTOX', name: 'Botox', uom: 'vial', finProductId: 'fp-2' });
    expect(row.itemId).toBe('item-9');
    expect(row.kind).toBe('product');
  });

  // ── #10: publish an EXISTING raw material (a mask, a vial) as a sellable ──
  it('itemId links the existing item instead of creating one', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'fp-x' }]]);
    mockExecute(db, [{ id: 'fp-x', code: 'MASK', name: 'Mask', category: null, unit_price: '40', active: true, item_id: 'item-raw', stock_qty: '5', has_mapping: false }]);
    upsertProductMock.mockResolvedValue(undefined);
    updateItemMock.mockResolvedValue({ id: 'item-raw' });

    const input: SellableInput = { name: 'Mask', code: 'MASK', unitPrice: 40, kind: 'product', itemId: 'item-raw' };
    const row = await createSellable(ctx(db), input, actor);

    expect(updateItemMock).toHaveBeenCalledWith(expect.anything(), 'item-raw', { finProductId: 'fp-x' });
    expect(createItemMock).not.toHaveBeenCalled(); // linked, never created
    expect(row.kind).toBe('product'); // derived from the link, for free
  });

  it('itemId wins over trackStock when both are sent', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'fp-y' }]]);
    mockExecute(db, [{ id: 'fp-y', code: 'DUAL', name: 'Dual', category: null, unit_price: null, active: true, item_id: 'item-raw', stock_qty: '0', has_mapping: false }]);
    upsertProductMock.mockResolvedValue(undefined);
    updateItemMock.mockResolvedValue({ id: 'item-raw' });

    await createSellable(ctx(db), { name: 'Dual', code: 'DUAL', unitPrice: null, kind: 'product', trackStock: true, uom: 'unit', itemId: 'item-raw' }, actor);

    expect(updateItemMock).toHaveBeenCalled();
    expect(createItemMock).not.toHaveBeenCalled();
  });

  it('publishing an already-published item surfaces item_taken, not a raw 23505', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'fp-z' }]]);
    upsertProductMock.mockResolvedValue(undefined);
    // what the stk_items_org_fin_product_uniq partial index raises
    updateItemMock.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));

    const input: SellableInput = { name: 'Dup', code: 'DUP', unitPrice: null, kind: 'product', itemId: 'item-raw' };
    await expect(createSellable(ctx(db), input, actor)).rejects.toMatchObject({ code: 'item_taken' });
  });

  it('a missing itemId surfaces item_not_found', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'fp-w' }]]);
    upsertProductMock.mockResolvedValue(undefined);
    updateItemMock.mockResolvedValue(null); // updateItem returns null when not found

    const input: SellableInput = { name: 'Ghost', code: 'GHOST', unitPrice: null, kind: 'product', itemId: 'nope' };
    await expect(createSellable(ctx(db), input, actor)).rejects.toMatchObject({ code: 'item_not_found' });
  });

  it('product-kind WITHOUT trackStock writes the product only — no item created', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'fp-2b' }]]);
    mockExecute(db, [{ id: 'fp-2b', code: 'RETAIL', name: 'Retail item', category: null, unit_price: '10', active: true, item_id: null, stock_qty: null, has_mapping: false }]);
    upsertProductMock.mockResolvedValue(undefined);

    const input: SellableInput = { name: 'Retail item', code: 'RETAIL', unitPrice: 10, kind: 'product' };
    await createSellable(ctx(db), input, actor);

    expect(createItemMock).not.toHaveBeenCalled();
  });

  it('consumption rows are written via setConsumption, one call per row', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'fp-3' }]]);
    mockExecute(db, [{ id: 'fp-3', code: 'PEEL', name: 'Peel', category: null, unit_price: '80', active: true, item_id: null, stock_qty: null, has_mapping: true }]);
    upsertProductMock.mockResolvedValue(undefined);
    setConsumptionMock.mockResolvedValue({ id: 'c1' });

    const input: SellableInput = {
      name: 'Peel',
      code: 'PEEL',
      unitPrice: 80,
      kind: 'service',
      consumption: [
        { itemId: 'item-a', qtyPerUnit: 2 },
        { itemId: 'item-b', qtyPerUnit: 1 },
      ],
    };
    await createSellable(ctx(db), input, actor);

    expect(setConsumptionMock).toHaveBeenCalledTimes(2);
    expect(setConsumptionMock).toHaveBeenNthCalledWith(1, expect.anything(), { finProductId: 'fp-3', itemId: 'item-a', qtyPerUnit: 2 }, actor);
    expect(setConsumptionMock).toHaveBeenNthCalledWith(2, expect.anything(), { finProductId: 'fp-3', itemId: 'item-b', qtyPerUnit: 1 }, actor);
  });

  it('auto-codes from the name when code is absent: BOTOX 50U → BOTOX-50U', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'fp-4' }]]);
    mockExecute(db, [{ id: 'fp-4', code: 'BOTOX-50U', name: 'BOTOX 50U', category: null, unit_price: null, active: true, item_id: null, stock_qty: null, has_mapping: false }]);
    upsertProductMock.mockResolvedValue(undefined);

    const input: SellableInput = { name: 'BOTOX 50U', unitPrice: null, kind: 'service' };
    await createSellable(ctx(db), input, actor);

    expect(upsertProductMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ code: 'BOTOX-50U' }));
  });

  it('code collision surfaces the underlying unique violation as PosError(code_taken)', async () => {
    const { db } = createMockDb();
    const pgError = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
    upsertProductMock.mockRejectedValue(pgError);

    const input: SellableInput = { name: 'Botox', code: 'BOTOX', unitPrice: 250, kind: 'service' };
    await expect(createSellable(ctx(db), input, actor)).rejects.toMatchObject({ code: 'code_taken' });
    expect(createItemMock).not.toHaveBeenCalled();
  });

  it('a non-unique-violation error from upsertProduct is rethrown as-is', async () => {
    const { db } = createMockDb();
    const boom = new Error('connection reset');
    upsertProductMock.mockRejectedValue(boom);

    const input: SellableInput = { name: 'Botox', code: 'BOTOX', unitPrice: 250, kind: 'service' };
    await expect(createSellable(ctx(db), input, actor)).rejects.toThrow('connection reset');
  });
});

describe('updateSellable', () => {
  it('replace-set consumption: deletes mappings missing from the new array, upserts the rest, scoped to THIS product only', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'fp-5', code: 'PEEL', name: 'Peel', category: null, unitPrice: '80', active: true }]]); // load current product
    mockExecute(db, [{ id: 'fp-5', code: 'PEEL', name: 'Peel', category: null, unit_price: '80', active: true, item_id: null, stock_qty: null, has_mapping: true }]);
    upsertProductMock.mockResolvedValue(undefined);
    listConsumptionMock.mockResolvedValue([
      { id: 'c-old-1', itemId: 'item-a' },
      { id: 'c-old-2', itemId: 'item-keep' },
    ]);
    deleteConsumptionMock.mockResolvedValue(true);
    setConsumptionMock.mockResolvedValue({ id: 'c-new' });

    await updateSellable(ctx(db), 'fp-5', { consumption: [{ itemId: 'item-keep', qtyPerUnit: 3 }] }, actor);

    expect(listConsumptionMock).toHaveBeenCalledWith(expect.anything(), { finProductId: 'fp-5' });
    expect(deleteConsumptionMock).toHaveBeenCalledTimes(1);
    expect(deleteConsumptionMock).toHaveBeenCalledWith(expect.anything(), 'c-old-1');
    expect(setConsumptionMock).toHaveBeenCalledWith(expect.anything(), { finProductId: 'fp-5', itemId: 'item-keep', qtyPerUnit: 3 }, actor);
  });

  it('consumption omitted leaves existing mappings untouched', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'fp-6', code: 'PEEL', name: 'Peel', category: null, unitPrice: '80', active: true }]]);
    mockExecute(db, [{ id: 'fp-6', code: 'PEEL', name: 'Peel', category: null, unit_price: '80', active: true, item_id: null, stock_qty: null, has_mapping: true }]);
    upsertProductMock.mockResolvedValue(undefined);

    await updateSellable(ctx(db), 'fp-6', { name: 'Peel v2' }, actor);

    expect(listConsumptionMock).not.toHaveBeenCalled();
    expect(deleteConsumptionMock).not.toHaveBeenCalled();
    expect(setConsumptionMock).not.toHaveBeenCalled();
  });

  it('not_found when the productId does not exist for this org', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]); // load current product → none
    await expect(updateSellable(ctx(db), 'missing', { name: 'X' }, actor)).rejects.toMatchObject({ code: 'not_found' });
  });
});
