import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { createMockDb } from '$server/test-utils/mock-db';

// ── finance-products.service mock (upsertProduct) ──
const upsertProductMock = vi.fn<(ctx: unknown, p: unknown) => Promise<void>>();
vi.mock('./finance-products.service', () => ({
  upsertProduct: (ctx: unknown, p: unknown) => upsertProductMock(ctx, p),
}));

// ── stock.service mock — sellables slice only; ticket-flow exports are
// stubbed no-ops since pos.sellables.test.ts never exercises them ──
// The sellable item-sync path runs inside the CALLER's transaction, so it goes
// through the tx-scoped forms (`createItemTx` / `updateItemTx`), not the
// ctx-scoped `createItem` / `updateItem` wrappers. Mocking the tx-scoped pair
// is what keeps `syncSellableItem`'s "one transaction" contract observable:
// the handle these receive is the same one the fin_products update runs on.
const createItemTxMock =
  vi.fn<(tx: unknown, orgId: string, input: unknown) => Promise<{ id: string }>>();
const updateItemTxMock =
  vi.fn<
    (tx: unknown, orgId: string, id: string, patch: unknown) => Promise<{ id: string } | null>
  >();
const setConsumptionMock =
  vi.fn<(ctx: unknown, input: unknown, actor: unknown) => Promise<{ id: string }>>();
const deleteConsumptionMock = vi.fn<(ctx: unknown, id: string) => Promise<boolean>>();
const listConsumptionMock =
  vi.fn<(ctx: unknown, filters: unknown) => Promise<Array<{ id: string; itemId: string }>>>();
vi.mock('./stock.service', () => ({
  createSourcedIssue: vi.fn(),
  findEntryBySource: vi.fn(),
  submitEntry: vi.fn(),
  cancelEntry: vi.fn(),
  StockError: class StockError extends Error {},
  createItemTx: (tx: unknown, orgId: string, input: unknown) => createItemTxMock(tx, orgId, input),
  updateItemTx: (tx: unknown, orgId: string, id: string, patch: unknown) =>
    updateItemTxMock(tx, orgId, id, patch),
  setConsumption: (ctx: unknown, input: unknown, actor: unknown) =>
    setConsumptionMock(ctx, input, actor),
  deleteConsumption: (ctx: unknown, id: string) => deleteConsumptionMock(ctx, id),
  listConsumption: (ctx: unknown, filters: unknown) => listConsumptionMock(ctx, filters),
}));

import {
  listSellables,
  createSellable,
  updateSellable,
  slugifyCode,
  deriveSellableFacts,
  type SellableInput,
} from './pos.service';

/** The mock `Db` is typed as the sqlite/libsql client and doesn't expose
 *  `execute` — narrow-cast to reach the vi.fn the mock harness caches there. */
function mockExecute(db: unknown, value: unknown) {
  (db as { execute: ReturnType<typeof vi.fn> }).execute.mockResolvedValue(value);
}

/**
 * Like `mockExecute`, but hands out a DIFFERENT result per raw-SQL query, in
 * order — needed once a single call reads the sellable twice and must see two
 * different states (the pre-transition row, then the post-transition readback).
 * `withOrgCore`'s own `set_config` setup statement runs on the same handle, so
 * it is skipped rather than eating a slot. Past the end: `[]`.
 */
function mockExecuteSequence(db: unknown, values: unknown[]) {
  let cursor = 0;
  (db as { execute: ReturnType<typeof vi.fn> }).execute.mockImplementation((q: unknown) => {
    const { sql: text } = new PgDialect().sqlToQuery(q as Parameters<PgDialect['sqlToQuery']>[0]);
    if (text.includes('set_config') || text.includes('for update')) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(values[cursor++] ?? []);
  });
}

/** A `SELLABLE_MERGE_SQL` row, defaulted to an untracked service. */
function sellableSqlRow(over: Record<string, unknown>) {
  return {
    code: 'CONS',
    name: 'Consulta',
    category: null,
    unit_price: null,
    active: true,
    item_id: null,
    stock_qty: null,
    has_mapping: false,
    ...over,
  };
}

/** The `db.update` top-level spy, which every "mutates nothing" assertion reads. */
function updateSpy(db: unknown) {
  return (db as { update: ReturnType<typeof vi.fn> }).update;
}

/** The `db.transaction` spy — one call per `withOrgCore`, so its call count is
 *  how many transactions a service function opened. */
function txSpy(db: unknown) {
  return (db as { transaction: ReturnType<typeof vi.fn> }).transaction;
}

/** The handle `withOrgCore` hands its callback. `createMockDb`'s transaction is
 *  `cb => cb(db)`, so the handle IS the db proxy — identity against it is what
 *  proves a write went through the caller's transaction rather than opening
 *  its own. */
function txHandle(db: unknown) {
  return db;
}

/** Make the next `tx.update(...).set(...).where(...)` reject — the only way to
 *  simulate a constraint the mock db has no schema to enforce. */
function rejectUpdateWith(db: unknown, err: unknown) {
  const chain = {
    set: () => chain,
    where: () => Promise.reject(err),
  };
  (db as { update: unknown }).update = vi.fn(() => chain);
}

beforeEach(() => {
  vi.clearAllMocks();
});

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });
const actor = { id: 'u1', name: 'Test User' };

describe('slugifyCode — pure', () => {
  // Contract changed deliberately: codes are now 2–4 uppercase alphanumerics
  // with NO separator, because the old unbounded hyphenated form is what let
  // `CM-SVP`/`CMSVP` and `RS-SVP`/`RSSVP` coexist as separate products.
  it('takes initials, caps at 4 chars, drops every separator', () => {
    expect(slugifyCode('BOTOX 50U')).toBe('B5');
    expect(slugifyCode('  hydra facial! ')).toBe('HF');
    expect(slugifyCode('already-CODE')).toBe('AC');
    expect(slugifyCode('Malar Saypha Volume Plus')).toBe('MSVP');
    // Single word → prefix, still capped.
    expect(slugifyCode('Eudaria')).toBe('EUDA');
  });
});

describe('listSellables', () => {
  it('merges product+item+bins+mapping — kind derives from a linked stk_items row, item w/o bins → stockQty 0', async () => {
    const { db } = createMockDb();
    mockExecute(db, [
      {
        id: 'fp-1',
        code: 'BOTOX',
        name: 'Botox',
        category: 'injectables',
        unit_price: '250',
        active: true,
        item_id: 'item-1',
        uom: 'vial',
        stock_qty: '12',
        has_mapping: false,
      },
      {
        id: 'fp-2',
        code: 'CONSULT',
        name: 'Consulta',
        category: null,
        unit_price: null,
        active: true,
        item_id: null,
        // A left join with no match still returns a uom column; it must not
        // become a fact about a sellable that tracks no stock.
        uom: null,
        stock_qty: null,
        has_mapping: true,
      },
      {
        id: 'fp-3',
        code: 'FILLER',
        name: 'Filler',
        category: null,
        unit_price: '300',
        active: true,
        item_id: 'item-2',
        uom: 'mL',
        stock_qty: null,
        has_mapping: false,
      },
    ]);

    const rows = await listSellables(ctx(db));

    expect(rows).toEqual([
      {
        productId: 'fp-1',
        code: 'BOTOX',
        name: 'Botox',
        category: 'injectables',
        unitPrice: 250,
        active: true,
        kind: 'product',
        itemId: 'item-1',
        trackStock: true,
        uom: 'vial',
        stockQty: 12,
        hasMapping: false,
        taxonomy: {
          zone: 'ninguna',
          line: 'toxina',
          // A stored fin_products.category is a HUMAN classification and
          // outranks the derived one ('Toxina' here) — the 2026-07-25 cleanup
          // set Retail/Prenda explicitly and the board must honour that.
          category: 'injectables',
          zoneSource: 'inferred',
          lineSource: 'inferred',
        },
      },
      {
        productId: 'fp-2',
        code: 'CONSULT',
        name: 'Consulta',
        category: null,
        unitPrice: null,
        active: true,
        kind: 'service',
        itemId: null,
        trackStock: false,
        uom: null,
        stockQty: null,
        hasMapping: true,
        taxonomy: {
          zone: 'ninguna',
          line: 'ninguno',
          category: 'Cargo',
          zoneSource: 'inferred',
          lineSource: 'inferred',
        },
      },
      {
        productId: 'fp-3',
        code: 'FILLER',
        name: 'Filler',
        category: null,
        unitPrice: 300,
        active: true,
        kind: 'product',
        itemId: 'item-2',
        trackStock: true,
        uom: 'mL',
        // No bins yet ≠ untracked: the item link is what makes it a product,
        // and Σ qty over zero bins is 0, never null.
        stockQty: 0,
        hasMapping: false,
        taxonomy: {
          zone: 'ninguna',
          line: 'ninguno',
          category: 'Cargo',
          zoneSource: 'inferred',
          lineSource: 'inferred',
        },
      },
    ]);
  });

  // Derived-on-read is the contract: nothing inferred is persisted, so the
  // grouping axes must appear without any backfill having run.
  it('derives the taxonomy from name + consumed insumo, and lets metadata override it', async () => {
    const { db } = createMockDb();
    mockExecute(db, [
      {
        id: 'fp-a',
        code: 'MSVP',
        name: 'Malar - Saypha Volume Plus',
        category: null,
        unit_price: '1350',
        active: true,
        item_id: null,
        stock_qty: null,
        has_mapping: true,
        metadata: {},
        consumed_item_names: ['HA Saypha Volume Plus (Caja)'],
      },
      {
        id: 'fp-b',
        code: 'CM',
        name: 'Contorno Mandibular',
        category: null,
        unit_price: '500',
        active: true,
        item_id: null,
        stock_qty: null,
        has_mapping: false,
        metadata: { line: 'mifill' }, // a human confirmed the insumo
        consumed_item_names: [],
      },
    ]);

    const [malar, mandibula] = await listSellables(ctx(db));

    // Mapped insumo is authoritative, and provenance says so.
    expect(malar.taxonomy).toEqual({
      zone: 'malar',
      line: 'saypha-volume-plus',
      category: 'Relleno',
      zoneSource: 'inferred',
      lineSource: 'mapped',
    });
    // The override replaces the 'por-definir' fallback AND re-derives category.
    expect(mandibula.taxonomy).toEqual({
      zone: 'mandibula',
      line: 'mifill',
      category: 'Relleno',
      zoneSource: 'inferred',
      lineSource: 'manual',
    });
  });

  it('ignores an unrecognised metadata value instead of minting a phantom group', async () => {
    const { db } = createMockDb();
    mockExecute(db, [
      {
        id: 'fp-c',
        code: 'MSVP',
        name: 'Malar - Saypha Volume Plus',
        category: null,
        unit_price: '1350',
        active: true,
        item_id: null,
        stock_qty: null,
        has_mapping: false,
        metadata: { zone: 'mlaar', line: 'typo-line' }, // misspelled
        consumed_item_names: [],
      },
    ]);
    const [row] = await listSellables(ctx(db));
    expect(row.taxonomy.zone).toBe('malar');
    expect(row.taxonomy.zoneSource).toBe('inferred');
    expect(row.taxonomy.line).toBe('saypha-volume-plus');
    expect(row.taxonomy.lineSource).toBe('inferred');
  });

  it('defaults to active-only; includeInactive:true drops the p.active filter so deactivated sellables stay reachable', async () => {
    const { db } = createMockDb();
    mockExecute(db, []);
    const execute = (db as unknown as { execute: ReturnType<typeof vi.fn> }).execute;

    await listSellables(ctx(db));
    // withOrgCore issues a session-config execute() before the query itself,
    // so the query under test is the SECOND call, not the first.
    const defaultQuery = new PgDialect().sqlToQuery(execute.mock.calls[1][0]);
    expect(defaultQuery.sql).toContain('p.active = true');

    await listSellables(ctx(db), { includeInactive: true });
    const inclusiveQuery = new PgDialect().sqlToQuery(execute.mock.calls[3][0]);
    expect(inclusiveQuery.sql).not.toContain('p.active = true');
  });
});

describe('createSellable', () => {
  it('service-kind writes the product only — no item, no consumption', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'fp-1' }]]); // select product id by code
    mockExecute(db, [
      {
        id: 'fp-1',
        code: 'CONSULT',
        name: 'Consulta',
        category: null,
        unit_price: null,
        active: true,
        item_id: null,
        stock_qty: null,
        has_mapping: false,
      },
    ]);
    upsertProductMock.mockResolvedValue(undefined);

    const input: SellableInput = {
      name: 'Consulta',
      code: 'CONS',
      unitPrice: null,
      kind: 'service',
    };
    const row = await createSellable(ctx(db), input, actor);

    expect(upsertProductMock).toHaveBeenCalledWith(expect.anything(), {
      code: 'CONS',
      name: 'Consulta',
      category: null,
      unitPrice: null,
      active: true,
    });
    expect(createItemTxMock).not.toHaveBeenCalled();
    expect(setConsumptionMock).not.toHaveBeenCalled();
    expect(row.kind).toBe('service');
    expect(row.itemId).toBeNull();
  });

  it('product-kind + trackStock writes product + item with a finProductId link — code reused, uom passed', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'fp-2' }]]); // select product id by code
    mockExecute(db, [
      {
        id: 'fp-2',
        code: 'BOTOX',
        name: 'Botox',
        category: null,
        unit_price: '250',
        active: true,
        item_id: 'item-9',
        stock_qty: '0',
        has_mapping: false,
      },
    ]);
    upsertProductMock.mockResolvedValue(undefined);
    createItemTxMock.mockResolvedValue({ id: 'item-9' });

    const input: SellableInput = {
      name: 'Botox',
      code: 'BTX',
      unitPrice: 250,
      kind: 'product',
      trackStock: true,
      uom: 'vial',
    };
    const row = await createSellable(ctx(db), input, actor);

    expect(createItemTxMock).toHaveBeenCalledWith(expect.anything(), 'org-1', {
      code: 'BTX',
      name: 'Botox',
      uom: 'vial',
      finProductId: 'fp-2',
    });
    expect(row.itemId).toBe('item-9');
    expect(row.kind).toBe('product');
  });

  // ── #10: publish an EXISTING raw material (a mask, a vial) as a sellable ──
  it('itemId links the existing item instead of creating one', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'fp-x' }]]);
    mockExecute(db, [
      {
        id: 'fp-x',
        code: 'MASK',
        name: 'Mask',
        category: null,
        unit_price: '40',
        active: true,
        item_id: 'item-raw',
        stock_qty: '5',
        has_mapping: false,
      },
    ]);
    upsertProductMock.mockResolvedValue(undefined);
    updateItemTxMock.mockResolvedValue({ id: 'item-raw' });

    const input: SellableInput = {
      name: 'Mask',
      code: 'MASK',
      unitPrice: 40,
      kind: 'product',
      itemId: 'item-raw',
    };
    const row = await createSellable(ctx(db), input, actor);

    expect(updateItemTxMock).toHaveBeenCalledWith(expect.anything(), 'org-1', 'item-raw', {
      finProductId: 'fp-x',
    });
    expect(createItemTxMock).not.toHaveBeenCalled(); // linked, never created
    expect(row.kind).toBe('product'); // derived from the link, for free
  });

  it('itemId wins over trackStock when both are sent', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'fp-y' }]]);
    mockExecute(db, [
      {
        id: 'fp-y',
        code: 'DUAL',
        name: 'Dual',
        category: null,
        unit_price: null,
        active: true,
        item_id: 'item-raw',
        stock_qty: '0',
        has_mapping: false,
      },
    ]);
    upsertProductMock.mockResolvedValue(undefined);
    updateItemTxMock.mockResolvedValue({ id: 'item-raw' });

    await createSellable(
      ctx(db),
      {
        name: 'Dual',
        code: 'DUAL',
        unitPrice: null,
        kind: 'product',
        trackStock: true,
        uom: 'unit',
        itemId: 'item-raw',
      },
      actor,
    );

    expect(updateItemTxMock).toHaveBeenCalled();
    expect(createItemTxMock).not.toHaveBeenCalled();
  });

  it('publishing an already-published item surfaces item_taken, not a raw 23505', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'fp-z' }]]);
    upsertProductMock.mockResolvedValue(undefined);
    // what the stk_items_org_fin_product_uniq partial index raises
    updateItemTxMock.mockRejectedValue(
      Object.assign(new Error('duplicate key'), { code: '23505' }),
    );

    const input: SellableInput = {
      name: 'Dup',
      code: 'DUP',
      unitPrice: null,
      kind: 'product',
      itemId: 'item-raw',
    };
    await expect(createSellable(ctx(db), input, actor)).rejects.toMatchObject({
      code: 'item_taken',
    });
  });

  it('a missing itemId surfaces item_not_found', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'fp-w' }]]);
    upsertProductMock.mockResolvedValue(undefined);
    updateItemTxMock.mockResolvedValue(null); // updateItem returns null when not found

    const input: SellableInput = {
      name: 'Ghost',
      code: 'GHOST',
      unitPrice: null,
      kind: 'product',
      itemId: 'nope',
    };
    await expect(createSellable(ctx(db), input, actor)).rejects.toMatchObject({
      code: 'item_not_found',
    });
  });

  it('product-kind WITHOUT trackStock writes the product only — no item created', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'fp-2b' }]]);
    mockExecute(db, [
      {
        id: 'fp-2b',
        code: 'RETAIL',
        name: 'Retail item',
        category: null,
        unit_price: '10',
        active: true,
        item_id: null,
        stock_qty: null,
        has_mapping: false,
      },
    ]);
    upsertProductMock.mockResolvedValue(undefined);

    const input: SellableInput = {
      name: 'Retail item',
      code: 'RETAIL',
      unitPrice: 10,
      kind: 'product',
    };
    await createSellable(ctx(db), input, actor);

    expect(createItemTxMock).not.toHaveBeenCalled();
  });

  it('consumption rows are written via setConsumption, one call per row', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'fp-3' }]]);
    mockExecute(db, [
      {
        id: 'fp-3',
        code: 'PEEL',
        name: 'Peel',
        category: null,
        unit_price: '80',
        active: true,
        item_id: null,
        stock_qty: null,
        has_mapping: true,
      },
    ]);
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
    expect(setConsumptionMock).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      { finProductId: 'fp-3', itemId: 'item-a', qtyPerUnit: 2, note: null },
      actor,
    );
    expect(setConsumptionMock).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      { finProductId: 'fp-3', itemId: 'item-b', qtyPerUnit: 1, note: null },
      actor,
    );
  });

  it('consumption note is passed through to setConsumption, not dropped', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'fp-3b' }]]);
    mockExecute(db, [
      {
        id: 'fp-3b',
        code: 'PEEL2',
        name: 'Peel 2',
        category: null,
        unit_price: '80',
        active: true,
        item_id: null,
        stock_qty: null,
        has_mapping: true,
      },
    ]);
    upsertProductMock.mockResolvedValue(undefined);
    setConsumptionMock.mockResolvedValue({ id: 'c1' });

    const input: SellableInput = {
      name: 'Peel 2',
      code: 'PEEL2',
      unitPrice: 80,
      kind: 'service',
      consumption: [{ itemId: 'item-a', qtyPerUnit: 2, note: 'thin layer only' }],
    };
    await createSellable(ctx(db), input, actor);

    expect(setConsumptionMock).toHaveBeenCalledWith(
      expect.anything(),
      { finProductId: 'fp-3b', itemId: 'item-a', qtyPerUnit: 2, note: 'thin layer only' },
      actor,
    );
  });

  it('auto-codes from the name when code is absent: BOTOX 50U → B5', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'fp-4' }]]);
    mockExecute(db, [
      {
        id: 'fp-4',
        code: 'BOTOX-50U',
        name: 'BOTOX 50U',
        category: null,
        unit_price: null,
        active: true,
        item_id: null,
        stock_qty: null,
        has_mapping: false,
      },
    ]);
    upsertProductMock.mockResolvedValue(undefined);

    const input: SellableInput = { name: 'BOTOX 50U', unitPrice: null, kind: 'service' };
    await createSellable(ctx(db), input, actor);

    expect(upsertProductMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: 'B5' }),
    );
  });

  it('code collision surfaces the underlying unique violation as PosError(code_taken)', async () => {
    const { db } = createMockDb();
    const pgError = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
    });
    upsertProductMock.mockRejectedValue(pgError);

    const input: SellableInput = { name: 'Botox', code: 'BOTOX', unitPrice: 250, kind: 'service' };
    await expect(createSellable(ctx(db), input, actor)).rejects.toMatchObject({
      code: 'code_taken',
    });
    expect(createItemTxMock).not.toHaveBeenCalled();
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
    resolveSequence([
      [{ id: 'fp-5', code: 'PEEL', name: 'Peel', category: null, unitPrice: '80', active: true }],
      [{ id: 'item-keep', isStockItem: true }],
      [
        { id: 'c-old-1', itemId: 'item-a', qtyPerUnit: '1' },
        { id: 'c-old-2', itemId: 'item-keep', qtyPerUnit: '3' },
      ],
      [], // fin_products update
      [], // stale mapping delete
      [{ id: 'c-old-2' }], // kept mapping upsert
    ]); // load current product
    mockExecute(db, [
      {
        id: 'fp-5',
        code: 'PEEL',
        name: 'Peel',
        category: null,
        unit_price: '80',
        active: true,
        item_id: null,
        stock_qty: null,
        has_mapping: true,
      },
    ]);
    upsertProductMock.mockResolvedValue(undefined);
    await updateSellable(
      ctx(db),
      'fp-5',
      { consumption: [{ itemId: 'item-keep', qtyPerUnit: 3 }] },
      actor,
    );

    expect((db as never as { delete: ReturnType<typeof vi.fn> }).delete).toHaveBeenCalledTimes(1);
    expect((db as never as { insert: ReturnType<typeof vi.fn> }).insert).toHaveBeenCalledTimes(1);
  });

  it('note survives the replace-set: a save that resubmits an existing row with its note intact does not wipe it', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'fp-5b', code: 'PEEL', name: 'Peel', category: null, unitPrice: '80', active: true }],
      [{ id: 'item-keep', isStockItem: true }],
      [{ id: 'c-old-1', itemId: 'item-keep', qtyPerUnit: '3' }],
      [],
      [{ id: 'c-old-1' }],
    ]);
    mockExecute(db, [
      {
        id: 'fp-5b',
        code: 'PEEL',
        name: 'Peel',
        category: null,
        unit_price: '80',
        active: true,
        item_id: null,
        stock_qty: null,
        has_mapping: true,
      },
    ]);
    upsertProductMock.mockResolvedValue(undefined);
    await updateSellable(
      ctx(db),
      'fp-5b',
      { consumption: [{ itemId: 'item-keep', qtyPerUnit: 3, note: 'thin layer only' }] },
      actor,
    );

    // ★ CRITICAL: the wizard's replace-set loop must forward `note`, or every
    // save silently blanks it via setConsumption's onConflictDoUpdate.
    expect((db as never as { insert: ReturnType<typeof vi.fn> }).insert).toHaveBeenCalledTimes(1);
  });

  it('consumption omitted leaves existing mappings untouched', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'fp-6', code: 'PEEL', name: 'Peel', category: null, unitPrice: '80', active: true }],
    ]);
    mockExecute(db, [
      {
        id: 'fp-6',
        code: 'PEEL',
        name: 'Peel',
        category: null,
        unit_price: '80',
        active: true,
        item_id: null,
        stock_qty: null,
        has_mapping: true,
      },
    ]);
    upsertProductMock.mockResolvedValue(undefined);

    await updateSellable(ctx(db), 'fp-6', { name: 'Peel v2' }, actor);

    expect(listConsumptionMock).not.toHaveBeenCalled();
    expect(deleteConsumptionMock).not.toHaveBeenCalled();
    expect(setConsumptionMock).not.toHaveBeenCalled();
  });

  it('not_found when the productId does not exist for this org', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]); // load current product → none
    await expect(updateSellable(ctx(db), 'missing', { name: 'X' }, actor)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  // ── regression: a code change must RENAME, never fork ────────────────────
  // Four duplicate products (`CM-SVP`, `RS-SVP`, `RS-O4`, `RO-I`) were created
  // in prod on 2026-07-20 within four minutes because this path called
  // upsertProduct, whose conflict target is (org_id, code): a CHANGED code did
  // not conflict, so it INSERTED a second product and left the original intact.
  it('renames in place on a code change — never upserts a second product', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'fp-7', code: 'PEEL', name: 'Peel', category: null, unitPrice: '80', active: true }],
    ]);
    // Serves both the billed-lines count (n) and getSellableRow's merge row.
    mockExecute(db, [
      {
        n: 0,
        id: 'fp-7',
        code: 'PL',
        name: 'Peel',
        category: null,
        unit_price: '80',
        active: true,
        item_id: null,
        stock_qty: null,
        has_mapping: false,
      },
    ]);

    await updateSellable(ctx(db), 'fp-7', { code: 'PL' }, actor);

    expect(upsertProductMock).not.toHaveBeenCalled();
    expect((db as unknown as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalled();
  });

  it('refuses to rename a code that already has billed invoice lines', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [
        {
          id: 'fp-8',
          code: 'RSSV',
          name: 'RinoSculpt',
          category: null,
          unitPrice: '1350',
          active: true,
        },
      ],
    ]);
    // 231 billed lines carry code 'RSSV'; loadProductMap resolves the invoice
    // sync through fin_products.code, so renaming would NULL their product_id.
    mockExecute(db, [{ n: 231 }]);

    await expect(updateSellable(ctx(db), 'fp-8', { code: 'NASP' }, actor)).rejects.toMatchObject({
      code: 'code_locked',
    });
    expect((db as unknown as { update: ReturnType<typeof vi.fn> }).update).not.toHaveBeenCalled();
  });

  it('rejects a code that cannot be salvaged by normalization', async () => {
    const { db, resolveSequence } = createMockDb();
    const row = {
      id: 'fp-9',
      code: 'PEEL',
      name: 'Peel',
      category: null,
      unitPrice: '80',
      active: true,
    };
    resolveSequence([[row], [row]]); // one slot per updateSellable call below
    // Note 'CM-SVP' is NOT the case to test: normalizeCode salvages it to
    // 'CMSV', which is valid on purpose. Only input with fewer than 2 usable
    // characters is unrecoverable.
    await expect(updateSellable(ctx(db), 'fp-9', { code: '-' }, actor)).rejects.toMatchObject({
      code: 'invalid_code',
    });
    await expect(updateSellable(ctx(db), 'fp-9', { code: 'A' }, actor)).rejects.toMatchObject({
      code: 'invalid_code',
    });
  });

  // ── silent-drop fix (2026-08-17-hub-updatesellable-silent-drop-spec, S1) ──
  // kind/trackStock/uom are projections of the linked stk_items row, not
  // fin_products columns — the old .set() accepted these fields and silently
  // discarded them. Every changed value must now either no-op (unchanged,
  // under normalization) or refuse with a typed PosError; never both accept
  // AND drop.
  describe('kind/trackStock/uom — apply or refuse, never silently drop', () => {
    it("full-object resubmit with UNCHANGED kind/trackStock/uom + a changed price → 200, price applied (the wizard's normal save)", async () => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([
        [
          {
            id: 'fp-10',
            code: 'BTX',
            name: 'Botox',
            category: null,
            unitPrice: '250',
            active: true,
          },
        ],
      ]);
      mockExecute(db, [
        {
          id: 'fp-10',
          code: 'BTX',
          name: 'Botox',
          category: null,
          unit_price: '999',
          active: true,
          item_id: 'item-10',
          stock_qty: '5',
          has_mapping: false,
          uom: 'Unidad',
        },
      ]);

      // The mocked execute() readback below is fixed data, independent of what
      // gets written — asserting only `row.unitPrice` / `update` called-ness
      // would still pass if the `.set()` payload dropped `unitPrice` entirely.
      // Spy on `.set()` directly so the test proves the write, not just the
      // (separately mocked) read.
      const setSpy = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
      (db as unknown as { update: ReturnType<typeof vi.fn> }).update = vi
        .fn()
        .mockReturnValue({ set: setSpy });

      const row = await updateSellable(
        ctx(db),
        'fp-10',
        { kind: 'product', trackStock: true, uom: 'Unidad', unitPrice: 999 },
        actor,
      );

      expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ unitPrice: '999' }));
      expect(row.unitPrice).toBe(999);
    });

    it('uom resubmitted with different case/whitespace only → treated as unchanged → 200', async () => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([
        [
          {
            id: 'fp-11',
            code: 'BTX',
            name: 'Botox',
            category: null,
            unitPrice: '250',
            active: true,
          },
        ],
      ]);
      mockExecute(db, [
        {
          id: 'fp-11',
          code: 'BTX',
          name: 'Botox',
          category: null,
          unit_price: '250',
          active: true,
          item_id: 'item-11',
          stock_qty: '0',
          has_mapping: false,
          uom: 'Unidad',
        },
      ]);

      await expect(
        updateSellable(ctx(db), 'fp-11', { uom: '  UNIDAD  ' }, actor),
      ).resolves.toMatchObject({ code: 'BTX' });
      expect((db as unknown as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalled();
    });

    it("kind 'service'→'product' throws PosError code 'kind_derived', mutates nothing", async () => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([
        [
          {
            id: 'fp-12',
            code: 'CONS',
            name: 'Consulta',
            category: null,
            unitPrice: null,
            active: true,
          },
        ],
      ]);
      mockExecute(db, [
        {
          id: 'fp-12',
          code: 'CONS',
          name: 'Consulta',
          category: null,
          unit_price: null,
          active: true,
          item_id: null,
          stock_qty: null,
          has_mapping: false,
        },
      ]);

      await expect(
        updateSellable(ctx(db), 'fp-12', { kind: 'product' }, actor),
      ).rejects.toMatchObject({ code: 'kind_derived' });
      expect((db as unknown as { update: ReturnType<typeof vi.fn> }).update).not.toHaveBeenCalled();
    });

    it("kind: 'service' on a bundle throws PosError code 'kind_derived' instead of comparing equal-by-coincidence, mutates nothing", async () => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([
        [
          {
            id: 'fp-12b',
            code: 'PACK',
            name: 'Combo Pack',
            category: null,
            unitPrice: '100',
            active: true,
          },
        ],
      ]);
      mockExecute(db, [
        {
          id: 'fp-12b',
          code: 'PACK',
          name: 'Combo Pack',
          category: null,
          unit_price: '100',
          active: true,
          item_id: null,
          stock_qty: null,
          has_mapping: false,
          is_bundle: true,
        },
      ]);

      // A bundle has no linked item, so it derives the same as a plain service
      // ('kind: service' resubmitted) UNLESS the true 'bundle' kind is preserved
      // for the comparison — this is the accept-and-drop defect this test guards.
      await expect(
        updateSellable(ctx(db), 'fp-12b', { kind: 'service' }, actor),
      ).rejects.toMatchObject({ code: 'kind_derived' });
      expect((db as unknown as { update: ReturnType<typeof vi.fn> }).update).not.toHaveBeenCalled();
    });

    it("trackStock true→false (untrack) still throws PosError code 'stock_tracking_immutable', mutates nothing", async () => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([
        [
          {
            id: 'fp-13',
            code: 'BTX',
            name: 'Botox',
            category: null,
            unitPrice: '250',
            active: true,
          },
        ],
      ]);
      mockExecute(db, [
        {
          id: 'fp-13',
          code: 'BTX',
          name: 'Botox',
          category: null,
          unit_price: '250',
          active: true,
          item_id: 'item-13',
          stock_qty: '4',
          has_mapping: false,
          uom: 'Unidad',
        },
      ]);

      await expect(
        updateSellable(ctx(db), 'fp-13', { trackStock: false }, actor),
      ).rejects.toMatchObject({ code: 'stock_tracking_immutable' });
      expect(createItemTxMock).not.toHaveBeenCalled();
      expect((db as unknown as { update: ReturnType<typeof vi.fn> }).update).not.toHaveBeenCalled();
    });

    it("trackStock false→true on a BUNDLE stays refused — 'bundle' kind is derived ahead of the item link", async () => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([
        [
          {
            id: 'fp-13b',
            code: 'PACK',
            name: 'Combo Pack',
            category: null,
            unitPrice: '100',
            active: true,
          },
        ],
      ]);
      mockExecute(db, [
        {
          id: 'fp-13b',
          code: 'PACK',
          name: 'Combo Pack',
          category: null,
          unit_price: '100',
          active: true,
          item_id: null,
          stock_qty: null,
          has_mapping: false,
          is_bundle: true,
        },
      ]);

      await expect(
        updateSellable(ctx(db), 'fp-13b', { trackStock: true }, actor),
      ).rejects.toMatchObject({ code: 'stock_tracking_immutable' });
      expect(createItemTxMock).not.toHaveBeenCalled();
      expect((db as unknown as { update: ReturnType<typeof vi.fn> }).update).not.toHaveBeenCalled();
    });

    it("uom 'Unidad'→'mL' throws PosError code 'uom_immutable', mutates nothing", async () => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([
        [
          {
            id: 'fp-14',
            code: 'BTX',
            name: 'Botox',
            category: null,
            unitPrice: '250',
            active: true,
          },
        ],
      ]);
      mockExecute(db, [
        {
          id: 'fp-14',
          code: 'BTX',
          name: 'Botox',
          category: null,
          unit_price: '250',
          active: true,
          item_id: 'item-14',
          stock_qty: '3',
          has_mapping: false,
          uom: 'Unidad',
        },
      ]);

      await expect(updateSellable(ctx(db), 'fp-14', { uom: 'mL' }, actor)).rejects.toMatchObject({
        code: 'uom_immutable',
      });
      expect((db as unknown as { update: ReturnType<typeof vi.fn> }).update).not.toHaveBeenCalled();
    });

    it('uom submitted on a service sellable with no linked item is a change from "not tracked" → refused, not silently accepted', async () => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([
        [
          {
            id: 'fp-15',
            code: 'CONS',
            name: 'Consulta',
            category: null,
            unitPrice: null,
            active: true,
          },
        ],
      ]);
      mockExecute(db, [
        {
          id: 'fp-15',
          code: 'CONS',
          name: 'Consulta',
          category: null,
          unit_price: null,
          active: true,
          item_id: null,
          stock_qty: null,
          has_mapping: false,
        },
      ]);

      await expect(updateSellable(ctx(db), 'fp-15', { uom: 'unit' }, actor)).rejects.toMatchObject({
        code: 'uom_immutable',
      });
    });
  });

  // ── Slice 1 of 2026-08-20-handoff-minion-hub-902723699-spec: the ONE safe
  // transition (an untracked service starts tracking stock) now applies
  // instead of being refused. Everything else above stays refused. ──
  describe('trackStock false→true applies via the shared item-sync path', () => {
    const currentService = [
      {
        id: 'fp-20',
        code: 'CONS',
        name: 'Consulta',
        category: null,
        unitPrice: null,
        active: true,
      },
    ];

    /**
     * The two states ONE PATCH observes: the pre-write read still sees an
     * untracked service, the post-write read sees the tracked product. They
     * differ on purpose — a returned `kind: 'product'` is then only reachable
     * by re-reading AFTER the write, so the assertions below cannot be
     * satisfied by a call that returns its own pre-read.
     *
     * That, and only that, is what a readback assertion in THIS file proves:
     * which of the two reads the projection came from. It says nothing about
     * whether a row was stored, because the rows here are supplied by the
     * mock. The stored result is asserted against a real server in
     * `pos.sellables.concurrent.integration.test.ts`.
     */
    function serviceBecomesProduct(db: unknown) {
      mockExecuteSequence(db, [
        [sellableSqlRow({ id: 'fp-20' })],
        [sellableSqlRow({ id: 'fp-20', item_id: 'item-20', stock_qty: '0', uom: 'Unidad' })],
      ]);
    }

    it("creates the linked stk_items row with the sellable's code/name/uom, and returns the POST-write read", async () => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([currentService]);
      serviceBecomesProduct(db);
      createItemTxMock.mockResolvedValue({ id: 'item-20' });

      const row = await updateSellable(
        ctx(db),
        'fp-20',
        { trackStock: true, uom: 'Unidad' },
        actor,
      );

      expect(createItemTxMock).toHaveBeenCalledWith(expect.anything(), 'org-1', {
        code: 'CONS',
        name: 'Consulta',
        uom: 'Unidad',
        finProductId: 'fp-20',
      });
      expect(updateSpy(db)).toHaveBeenCalled();
      // `kind`/`trackStock`/`uom` are all derived from the item link, and the
      // pre-write read carried none of them — returning them proves the row
      // came from the second read, not the first. It does NOT prove the item
      // persisted; the integration suite does that.
      expect(row).toMatchObject({
        kind: 'product',
        trackStock: true,
        uom: 'Unidad',
        itemId: 'item-20',
      });
    });

    it('runs the item insert and the fin_products update in ONE transaction — a later failure can roll the insert back', async () => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([currentService]);
      serviceBecomesProduct(db);
      createItemTxMock.mockResolvedValue({ id: 'item-20' });

      await updateSellable(ctx(db), 'fp-20', { trackStock: true, uom: 'Unidad' }, actor);

      // updateSellable opens exactly two transactions: one locked business
      // transaction that reads facts and performs both writes, then readback.
      // A third would mean part of the decision or mutation escaped the lock.
      const txOrder = txSpy(db).mock.invocationCallOrder;
      expect(txOrder).toHaveLength(2);

      // …and both writes land inside the first one: no transaction is opened
      // between them, and the handle the item write got is the transaction's.
      const itemAt = createItemTxMock.mock.invocationCallOrder[0];
      const productAt = updateSpy(db).mock.invocationCallOrder[0];
      expect(itemAt).toBeGreaterThan(txOrder[0]);
      expect(productAt).toBeGreaterThan(itemAt);
      expect(txOrder.filter((o) => o > itemAt && o < productAt)).toEqual([]);
      expect(createItemTxMock.mock.calls[0][0]).toBe(txHandle(db));
    });

    it('a code collision on the SAME request reports code_taken and does not commit the stock link — both writes share the transaction, so PostgreSQL rolls the insert back', async () => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([currentService]);
      // A renamed code adds the billed-lines guard query ahead of the two
      // sellable reads, so this case spells its sequence out rather than
      // reusing `serviceBecomesProduct`.
      mockExecuteSequence(db, [
        [{ n: 0 }], // no billed invoice lines → the rename is allowed to proceed
        [sellableSqlRow({ id: 'fp-20' })], // pre-write: an untracked service
        [sellableSqlRow({ id: 'fp-20', item_id: 'item-20', stock_qty: '0', uom: 'Unidad' })],
      ]);
      createItemTxMock.mockResolvedValue({ id: 'item-20' });
      // The killer request: start tracking AND rename onto a code another
      // product already holds. fin_products_org_code_uniq rejects the rename
      // AFTER the item insert has been issued.
      // Wrapped exactly as drizzle raises it (see the item_taken case below).
      rejectUpdateWith(
        db,
        Object.assign(new Error('Failed query: update "fin_products"'), {
          cause: Object.assign(new Error('duplicate key'), { code: '23505' }),
        }),
      );

      await expect(
        updateSellable(ctx(db), 'fp-20', { trackStock: true, uom: 'Unidad', code: 'TAKEN' }, actor),
      ).rejects.toMatchObject({ code: 'code_taken' });

      // The rollback proof this unit test can carry: the item insert really
      // was issued (so the ordering alone would NOT have saved us), it ran on
      // the transaction handle, and no transaction boundary separates it from
      // the failing rename — so the driver aborts both together. It is not
      // retry-healing: every retry re-hits the same code conflict, which is
      // exactly why the item must not be allowed to survive on its own.
      expect(createItemTxMock).toHaveBeenCalledTimes(1);
      expect(createItemTxMock.mock.calls[0][0]).toBe(txHandle(db));
      const itemAt = createItemTxMock.mock.invocationCallOrder[0];
      const renameAt = updateSpy(db).mock.invocationCallOrder[0];
      expect(renameAt).toBeGreaterThan(itemAt);
      expect(txSpy(db).mock.invocationCallOrder.filter((o) => o > itemAt && o < renameAt)).toEqual(
        [],
      );
    });

    it("the wizard's full-object save {kind:'product', trackStock:true, uom} is accepted — kind is judged AFTER the transition", async () => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([currentService]);
      serviceBecomesProduct(db);
      createItemTxMock.mockResolvedValue({ id: 'item-20' });

      const row = await updateSellable(
        ctx(db),
        'fp-20',
        { kind: 'product', trackStock: true, uom: 'Unidad', name: 'Consulta' },
        actor,
      );

      expect(createItemTxMock).toHaveBeenCalledTimes(1);
      expect(row.kind).toBe('product');
    });

    it("a submitted kind that CONFLICTS with the post-transition state ({kind:'service', trackStock:true}) is still kind_derived, and writes nothing", async () => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([currentService]);
      serviceBecomesProduct(db);

      await expect(
        updateSellable(ctx(db), 'fp-20', { kind: 'service', trackStock: true }, actor),
      ).rejects.toMatchObject({ code: 'kind_derived' });
      expect(createItemTxMock).not.toHaveBeenCalled();
      expect(updateSpy(db)).not.toHaveBeenCalled();
    });

    it('PARITY: create(tracked) and create(service)+update(trackStock) build the SAME item — the anti-drift property of the extraction', async () => {
      // Path A — one create that tracks stock from the start.
      const a = createMockDb();
      a.resolveSequence([[{ id: 'fp-20' }]]);
      mockExecute(a.db, [sellableSqlRow({ id: 'fp-20', item_id: 'item-20', stock_qty: '0' })]);
      upsertProductMock.mockResolvedValue(undefined);
      createItemTxMock.mockResolvedValue({ id: 'item-20' });
      await createSellable(
        ctx(a.db),
        {
          name: 'Consulta',
          code: 'CONS',
          unitPrice: null,
          kind: 'product',
          trackStock: true,
          uom: 'Unidad',
        },
        actor,
      );
      const viaCreate = createItemTxMock.mock.calls.at(-1)?.[2];

      // Path B — create as a service, then switch tracking on.
      const b = createMockDb();
      b.resolveSequence([currentService]);
      serviceBecomesProduct(b.db);
      await updateSellable(ctx(b.db), 'fp-20', { trackStock: true, uom: 'Unidad' }, actor);
      const viaUpdate = createItemTxMock.mock.calls.at(-1)?.[2];

      // Not a mock echo: the two paths are different functions building this
      // payload, and the assertion fails the moment either grows its own copy
      // of "what a tracked sellable's item looks like". Parity of the STORED
      // rows (the same property, one layer down) is asserted against a real
      // server in `pos.sellables.concurrent.integration.test.ts`.
      expect(viaCreate).toEqual({
        code: 'CONS',
        name: 'Consulta',
        uom: 'Unidad',
        finProductId: 'fp-20',
      });
      expect(viaUpdate).toEqual(viaCreate);
    });

    it("PARITY: an omitted uom defaults to 'unit' identically on both paths", async () => {
      const a = createMockDb();
      a.resolveSequence([[{ id: 'fp-20' }]]);
      mockExecute(a.db, [sellableSqlRow({ id: 'fp-20', item_id: 'item-20', stock_qty: '0' })]);
      upsertProductMock.mockResolvedValue(undefined);
      createItemTxMock.mockResolvedValue({ id: 'item-20' });
      await createSellable(
        ctx(a.db),
        { name: 'Consulta', code: 'CONS', unitPrice: null, kind: 'product', trackStock: true },
        actor,
      );
      const viaCreate = createItemTxMock.mock.calls.at(-1)?.[2];

      const b = createMockDb();
      b.resolveSequence([currentService]);
      serviceBecomesProduct(b.db);
      await updateSellable(ctx(b.db), 'fp-20', { trackStock: true }, actor);
      const viaUpdate = createItemTxMock.mock.calls.at(-1)?.[2];

      expect(viaCreate).toMatchObject({ uom: 'unit' });
      expect(viaUpdate).toEqual(viaCreate);
    });

    it('a failed item insert aborts the whole request — the fin_products update is never issued', async () => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([currentService]);
      serviceBecomesProduct(db);
      createItemTxMock.mockRejectedValue(new Error('stk_items insert exploded'));

      await expect(
        updateSellable(ctx(db), 'fp-20', { trackStock: true, uom: 'Unidad', unitPrice: 42 }, actor),
      ).rejects.toThrow('stk_items insert exploded');
      expect(updateSpy(db)).not.toHaveBeenCalled();
    });

    it('a 23505 from the item insert surfaces as item_taken, not a raw pg error, and writes no partial update', async () => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([currentService]);
      serviceBecomesProduct(db);
      // This case proves only the TRANSLATION of a unique violation into the
      // domain error. The behaviour it stands in for — two genuinely concurrent
      // false→true PATCHes leaving exactly ONE linked row — is proved against a
      // real server in `pos.sellables.concurrent.integration.test.ts`, because
      // a mock told to raise 23505 cannot prove that PostgreSQL raises it.
      //
      // ★ The wrapped shape is the point. drizzle raises a `DrizzleQueryError`
      // whose `cause` carries the SQLSTATE; the flat `{code: '23505'}` this
      // file used to inject was the ONLY shape the old bare `e.code` check
      // matched, which is why a real-database run was the first thing to notice
      // that `item_taken` was dead in production.
      createItemTxMock.mockRejectedValue(
        Object.assign(new Error('Failed query: insert into "stk_items"'), {
          cause: Object.assign(new Error('duplicate key'), { code: '23505' }),
        }),
      );

      await expect(
        updateSellable(ctx(db), 'fp-20', { trackStock: true, uom: 'Unidad' }, actor),
      ).rejects.toMatchObject({ code: 'item_taken' });
      expect(updateSpy(db)).not.toHaveBeenCalled();
    });
  });
});

describe('deriveSellableFacts', () => {
  it('derives product/trackStock/uom from the linked stk_items row', async () => {
    const { db } = createMockDb();
    mockExecute(db, [
      {
        id: 'fp-16',
        code: 'BTX',
        name: 'Botox',
        category: null,
        unit_price: '250',
        active: true,
        item_id: 'item-16',
        stock_qty: '2',
        has_mapping: false,
        uom: 'vial',
      },
    ]);

    const facts = await deriveSellableFacts(ctx(db), 'fp-16');

    expect(facts).toEqual({ kind: 'product', trackStock: true, uom: 'vial', itemId: 'item-16' });
  });

  it('derives service/no-tracking/null-uom when no item is linked', async () => {
    const { db } = createMockDb();
    mockExecute(db, [
      {
        id: 'fp-17',
        code: 'CONS',
        name: 'Consulta',
        category: null,
        unit_price: null,
        active: true,
        item_id: null,
        stock_qty: null,
        has_mapping: false,
      },
    ]);

    const facts = await deriveSellableFacts(ctx(db), 'fp-17');

    expect(facts).toEqual({ kind: 'service', trackStock: false, uom: null, itemId: null });
  });
});
