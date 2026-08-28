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
const createItemMock = vi.fn<(ctx: unknown, input: unknown) => Promise<{ id: string }>>();
const updateItemMock =
  vi.fn<(ctx: unknown, id: string, patch: unknown) => Promise<{ id: string } | null>>();
// pos.service.ts now calls the tx-scoped variants directly (item write +
// fin_products write share one transaction — see updateSellable's doc
// comment); the mock still records calls under the same createItemMock/
// updateItemMock spies (dropping the orgId arg) so existing assertions read
// the same call shape as the ctx-based functions did.
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
  createItemInTx: (tx: unknown, _orgId: unknown, input: unknown) => createItemMock(tx, input),
  updateItemInTx: (tx: unknown, _orgId: unknown, id: string, patch: unknown) =>
    updateItemMock(tx, id, patch),
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
  itemHasHistory,
  type SellableInput,
} from './pos.service';

/** The mock `Db` is typed as the sqlite/libsql client and doesn't expose
 *  `execute` — narrow-cast to reach the vi.fn the mock harness caches there. */
function mockExecute(db: unknown, value: unknown) {
  (db as { execute: ReturnType<typeof vi.fn> }).execute.mockResolvedValue(value);
}

/**
 * Per-call execute sequencing — one value per REAL raw-SQL call, in order.
 * `withOrgCore` opens a fresh transaction (4 `tx.execute` setup statements:
 * the idle-timeout, `set local role`, and two `set_config` GUCs) around
 * every wrapped query, and a multi-step function like `deriveSellableFacts`
 * or `applyUomChange` opens several `withOrgCore` blocks — so the setup
 * calls interleave with the real ones in the actual call order. Queuing
 * `values` positionally (`mockResolvedValueOnce` per call) would hand a
 * real value to a setup statement and desync everything after it. This
 * mock inspects the query text instead: setup statements are recognized
 * and answered with `undefined` (their return value is never read) without
 * consuming the queue, so `values` only ever has to list the REAL query
 * results, in the order those queries happen.
 */
function mockExecuteSeq(db: unknown, values: unknown[]) {
  const queue = [...values];
  const isSetupQuery = (query: unknown): boolean => {
    const chunks = (query as { queryChunks?: unknown[] } | undefined)?.queryChunks;
    // drizzle's `sql` template wraps a literal chunk as `{ value: string[] }`,
    // not a bare string — the leading literal text (before any interpolated
    // param) is what distinguishes withOrgCore's 4 fixed setup statements
    // from every real query built by this module.
    const first = chunks?.[0] as { value?: unknown } | string | undefined;
    const text =
      typeof first === 'string' ? first : Array.isArray(first?.value) ? first.value.join(' ') : '';
    return /^\s*(set local|select set_config)/i.test(text);
  };
  (db as { execute: unknown }).execute = vi.fn((query: unknown) =>
    isSetupQuery(query) ? Promise.resolve(undefined) : Promise.resolve(queue.shift()),
  );
}

/** The all-branches-empty answer of the pristine-item history probe. */
const NO_HISTORY = [{ ledger: false, entry_lines: false, bins: false, billed: false }];

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
    expect(createItemMock).not.toHaveBeenCalled();
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
    createItemMock.mockResolvedValue({ id: 'item-9' });

    const input: SellableInput = {
      name: 'Botox',
      code: 'BTX',
      unitPrice: 250,
      kind: 'product',
      trackStock: true,
      uom: 'vial',
    };
    const row = await createSellable(ctx(db), input, actor);

    expect(createItemMock).toHaveBeenCalledWith(expect.anything(), {
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
    updateItemMock.mockResolvedValue({ id: 'item-raw' });

    const input: SellableInput = {
      name: 'Mask',
      code: 'MASK',
      unitPrice: 40,
      kind: 'product',
      itemId: 'item-raw',
    };
    const row = await createSellable(ctx(db), input, actor);

    expect(updateItemMock).toHaveBeenCalledWith(expect.anything(), 'item-raw', {
      finProductId: 'fp-x',
    });
    expect(createItemMock).not.toHaveBeenCalled(); // linked, never created
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
    updateItemMock.mockResolvedValue({ id: 'item-raw' });

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

    expect(updateItemMock).toHaveBeenCalled();
    expect(createItemMock).not.toHaveBeenCalled();
  });

  it('publishing an already-published item surfaces item_taken, not a raw 23505', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'fp-z' }]]);
    upsertProductMock.mockResolvedValue(undefined);
    // what the stk_items_org_fin_product_uniq partial index raises
    updateItemMock.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));

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
    updateItemMock.mockResolvedValue(null); // updateItem returns null when not found

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

    expect(createItemMock).not.toHaveBeenCalled();
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
    resolveSequence([
      [{ id: 'fp-5', code: 'PEEL', name: 'Peel', category: null, unitPrice: '80', active: true }],
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
    listConsumptionMock.mockResolvedValue([
      { id: 'c-old-1', itemId: 'item-a' },
      { id: 'c-old-2', itemId: 'item-keep' },
    ]);
    deleteConsumptionMock.mockResolvedValue(true);
    setConsumptionMock.mockResolvedValue({ id: 'c-new' });

    await updateSellable(
      ctx(db),
      'fp-5',
      { consumption: [{ itemId: 'item-keep', qtyPerUnit: 3 }] },
      actor,
    );

    expect(listConsumptionMock).toHaveBeenCalledWith(expect.anything(), { finProductId: 'fp-5' });
    expect(deleteConsumptionMock).toHaveBeenCalledTimes(1);
    expect(deleteConsumptionMock).toHaveBeenCalledWith(expect.anything(), 'c-old-1');
    expect(setConsumptionMock).toHaveBeenCalledWith(
      expect.anything(),
      { finProductId: 'fp-5', itemId: 'item-keep', qtyPerUnit: 3, note: null },
      actor,
    );
  });

  it('note survives the replace-set: a save that resubmits an existing row with its note intact does not wipe it', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'fp-5b', code: 'PEEL', name: 'Peel', category: null, unitPrice: '80', active: true }],
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
    listConsumptionMock.mockResolvedValue([{ id: 'c-old-1', itemId: 'item-keep' }]);
    setConsumptionMock.mockResolvedValue({ id: 'c-new' });

    await updateSellable(
      ctx(db),
      'fp-5b',
      { consumption: [{ itemId: 'item-keep', qtyPerUnit: 3, note: 'thin layer only' }] },
      actor,
    );

    // ★ CRITICAL: the wizard's replace-set loop must forward `note`, or every
    // save silently blanks it via setConsumption's onConflictDoUpdate.
    expect(setConsumptionMock).toHaveBeenCalledWith(
      expect.anything(),
      { finProductId: 'fp-5b', itemId: 'item-keep', qtyPerUnit: 3, note: 'thin layer only' },
      actor,
    );
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

    it('trackStock false→true on a service APPLIES: linked item created via the createSellable path, kind flips to product', async () => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([
        [
          {
            id: 'fp-13',
            code: 'CONS',
            name: 'Consulta',
            category: null,
            unitPrice: null,
            active: true,
          },
        ],
      ]);
      const serviceRow = {
        id: 'fp-13',
        code: 'CONS',
        name: 'Consulta',
        category: null,
        unit_price: null,
        active: true,
        item_id: null,
        stock_qty: null,
        has_mapping: false,
      };
      mockExecuteSeq(db, [
        [serviceRow], // deriveSellableFacts → getSellableRow (still a service)
        [{ ...serviceRow, item_id: 'item-13', stock_qty: '0', uom: 'Unidad' }], // final readback
      ]);
      createItemMock.mockResolvedValue({ id: 'item-13' });

      const row = await updateSellable(
        ctx(db),
        'fp-13',
        { trackStock: true, uom: 'Unidad' },
        actor,
      );

      // The linked stk_items row is created with fin_product_id == the sellable.
      expect(createItemMock).toHaveBeenCalledWith(expect.anything(), {
        code: 'CONS',
        name: 'Consulta',
        uom: 'Unidad',
        finProductId: 'fp-13',
      });
      expect(row.kind).toBe('product');
      expect(row.itemId).toBe('item-13');
    });

    it("coupled full-object PATCH { kind:'product', trackStock:true } succeeds; kind:'service' + trackStock:true → 'kind_derived', no writes", async () => {
      const serviceRow = {
        id: 'fp-13',
        code: 'CONS',
        name: 'Consulta',
        category: null,
        unit_price: null,
        active: true,
        item_id: null,
        stock_qty: null,
        has_mapping: false,
      };
      const current = {
        id: 'fp-13',
        code: 'CONS',
        name: 'Consulta',
        category: null,
        unitPrice: null,
        active: true,
      };

      // Accepted: submitted kind matches the POST-transition derived state.
      {
        const { db, resolveSequence } = createMockDb();
        resolveSequence([[current]]);
        mockExecuteSeq(db, [[serviceRow], [{ ...serviceRow, item_id: 'item-13', stock_qty: '0' }]]);
        createItemMock.mockResolvedValue({ id: 'item-13' });
        const row = await updateSellable(
          ctx(db),
          'fp-13',
          { kind: 'product', trackStock: true, uom: 'Unidad' },
          actor,
        );
        expect(row.kind).toBe('product');
        expect(createItemMock).toHaveBeenCalledTimes(1);
      }

      // Refused: submitted kind conflicts with the post-transition state.
      {
        vi.clearAllMocks();
        const { db, resolveSequence } = createMockDb();
        resolveSequence([[current]]);
        mockExecuteSeq(db, [[serviceRow]]);
        await expect(
          updateSellable(ctx(db), 'fp-13', { kind: 'service', trackStock: true }, actor),
        ).rejects.toMatchObject({ code: 'kind_derived' });
        expect(createItemMock).not.toHaveBeenCalled();
        expect(
          (db as unknown as { update: ReturnType<typeof vi.fn> }).update,
        ).not.toHaveBeenCalled();
      }
    });

    it('PARITY: createSellable(trackStock) and createSellable(service)+updateSellable(trackStock) drive the SAME item-sync call — omitted uom defaults identically', async () => {
      const syncArgs = async (
        run: (db: ReturnType<typeof createMockDb>['db']) => Promise<unknown>,
        seq: unknown[],
        exec: unknown[],
      ) => {
        vi.clearAllMocks();
        const { db, resolveSequence } = createMockDb();
        resolveSequence(seq);
        mockExecuteSeq(db, exec);
        createItemMock.mockResolvedValue({ id: 'item-1' });
        await run(db);
        expect(createItemMock).toHaveBeenCalledTimes(1);
        return createItemMock.mock.calls[0]![1];
      };

      const finalRow = {
        id: 'fp-1',
        code: 'BTX',
        name: 'Botox',
        category: null,
        unit_price: '250',
        active: true,
        item_id: 'item-1',
        stock_qty: '0',
        has_mapping: false,
      };
      const createArgs = await syncArgs(
        (db) =>
          createSellable(
            ctx(db),
            { name: 'Botox', code: 'BTX', unitPrice: 250, kind: 'product', trackStock: true },
            actor,
          ),
        [[{ id: 'fp-1' }]],
        [[finalRow]],
      );
      const updateArgs = await syncArgs(
        (db) => updateSellable(ctx(db), 'fp-1', { kind: 'product', trackStock: true }, actor),
        [
          [
            {
              id: 'fp-1',
              code: 'BTX',
              name: 'Botox',
              category: null,
              unitPrice: '250',
              active: true,
            },
          ],
        ],
        [[{ ...finalRow, item_id: null, stock_qty: null }], [finalRow]],
      );

      // The anti-drift property: one shared syncSellableItem, identical input —
      // including the same 'unit' default when uom is omitted on both sides.
      expect(updateArgs).toEqual(createArgs);
      expect(createArgs).toMatchObject({ uom: 'unit' });
    });

    it('forced item-insert failure → rejects and the fin_products row is untouched', async () => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([
        [
          {
            id: 'fp-13',
            code: 'CONS',
            name: 'Consulta',
            category: null,
            unitPrice: null,
            active: true,
          },
        ],
      ]);
      mockExecuteSeq(db, [
        [
          {
            id: 'fp-13',
            code: 'CONS',
            name: 'Consulta',
            category: null,
            unit_price: null,
            active: true,
            item_id: null,
            stock_qty: null,
            has_mapping: false,
          },
        ],
      ]);
      createItemMock.mockRejectedValue(new Error('item insert failed'));

      await expect(updateSellable(ctx(db), 'fp-13', { trackStock: true }, actor)).rejects.toThrow(
        'item insert failed',
      );
      expect((db as unknown as { update: ReturnType<typeof vi.fn> }).update).not.toHaveBeenCalled();
    });

    // NOT a real concurrency test — a single call with the item insert mocked
    // to reject with 23505, proving only the error-code mapping. The actual
    // two-connection race against a real unique index is proven in
    // pos.trackstock.concurrent.integration.test.ts (real PostgreSQL, gated by
    // REQUIRE_POS_TRACKSTOCK_POSTGRES) — see PR #142/#149 review history for
    // why a mock-configured single call doesn't establish this on its own.
    it("a 23505 from the item insert (what stk_items_org_fin_product_uniq raises for the losing PATCH) surfaces as the mapped 'item_taken' conflict, no partial product write", async () => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([
        [
          {
            id: 'fp-13',
            code: 'CONS',
            name: 'Consulta',
            category: null,
            unitPrice: null,
            active: true,
          },
        ],
      ]);
      mockExecuteSeq(db, [
        [
          {
            id: 'fp-13',
            code: 'CONS',
            name: 'Consulta',
            category: null,
            unit_price: null,
            active: true,
            item_id: null,
            stock_qty: null,
            has_mapping: false,
          },
        ],
      ]);
      // What stk_items_org_fin_product_uniq raises for the second inserter.
      createItemMock.mockRejectedValue(Object.assign(new Error('duplicate'), { code: '23505' }));

      await expect(
        updateSellable(ctx(db), 'fp-13', { trackStock: true }, actor),
      ).rejects.toMatchObject({ code: 'item_taken' });
      expect((db as unknown as { update: ReturnType<typeof vi.fn> }).update).not.toHaveBeenCalled();
    });

    it("patch.itemId throws 'item_link_immutable', no facts lookup, no writes — itemId is create-only, not a silent no-op", async () => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([
        [
          {
            id: 'fp-13',
            code: 'CONS',
            name: 'Consulta',
            category: null,
            unitPrice: null,
            active: true,
          },
        ],
      ]);

      await expect(
        updateSellable(ctx(db), 'fp-13', { itemId: 'item-99' }, actor),
      ).rejects.toMatchObject({ code: 'item_link_immutable' });
      expect((db as unknown as { update: ReturnType<typeof vi.fn> }).update).not.toHaveBeenCalled();
      expect(createItemMock).not.toHaveBeenCalled();
    });

    it("combined PATCH { code: <colliding>, trackStock:true } throws 'code_taken' BEFORE the item transition runs — no orphan stk_items row under the rejected code", async () => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([
        [
          {
            id: 'fp-13',
            code: 'CONS',
            name: 'Consulta',
            category: null,
            unitPrice: null,
            active: true,
          },
        ],
        [{ id: 'fp-other' }], // the NEW code already belongs to another product
      ]);
      mockExecuteSeq(db, [[{ n: 0 }]]); // billed-invoice-lines count for the OLD code: 0, rename allowed

      await expect(
        updateSellable(ctx(db), 'fp-13', { code: 'TAKEN', trackStock: true }, actor),
      ).rejects.toMatchObject({ code: 'code_taken' });
      // The precheck must reject before deriveSellableFacts/syncSellableItem run —
      // otherwise a stk_items row would already be committed under 'TAKEN' by the
      // time the (never-reached) fin_products update would have failed.
      expect(createItemMock).not.toHaveBeenCalled();
      expect((db as unknown as { update: ReturnType<typeof vi.fn> }).update).not.toHaveBeenCalled();
    });

    it("trackStock true→false still throws 'stock_tracking_immutable' (untrack is S3, unchanged), mutates nothing", async () => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([
        [
          {
            id: 'fp-13b',
            code: 'BTX',
            name: 'Botox',
            category: null,
            unitPrice: '250',
            active: true,
          },
        ],
      ]);
      mockExecuteSeq(db, [
        [
          {
            id: 'fp-13b',
            code: 'BTX',
            name: 'Botox',
            category: null,
            unit_price: '250',
            active: true,
            item_id: 'item-13b',
            stock_qty: '2',
            has_mapping: false,
          },
        ],
        [{ uom: 'Unidad' }],
      ]);

      await expect(
        updateSellable(ctx(db), 'fp-13b', { trackStock: false }, actor),
      ).rejects.toMatchObject({ code: 'stock_tracking_immutable' });
      expect((db as unknown as { update: ReturnType<typeof vi.fn> }).update).not.toHaveBeenCalled();
    });

    it("trackStock: true on a BUNDLE still throws 'stock_tracking_immutable' — a bundle can never gain a linked item", async () => {
      const { db, resolveSequence } = createMockDb();
      resolveSequence([
        [
          {
            id: 'fp-13c',
            code: 'PACK',
            name: 'Combo Pack',
            category: null,
            unitPrice: '100',
            active: true,
          },
        ],
      ]);
      mockExecuteSeq(db, [
        [
          {
            id: 'fp-13c',
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
        ],
      ]);

      await expect(
        updateSellable(ctx(db), 'fp-13c', { trackStock: true }, actor),
      ).rejects.toMatchObject({ code: 'stock_tracking_immutable' });
      expect(createItemMock).not.toHaveBeenCalled();
    });

    // Shared fixture for the uom-transition cases: a tracked item in 'Unidad'.
    const uomFixture = () => {
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
        [{ id: 'item-14' }], // applyUomChange: stk_items row locked for update
      ]);
      const itemRow = {
        id: 'fp-14',
        code: 'BTX',
        name: 'Botox',
        category: null,
        unit_price: '250',
        active: true,
        item_id: 'item-14',
        stock_qty: '0',
        has_mapping: false,
        uom: 'Unidad',
      };
      return { db, itemRow };
    };

    it("uom 'Unidad'→'mL' on a PRISTINE item APPLIES — history check and write in one locked transaction", async () => {
      const { db, itemRow } = uomFixture();
      mockExecuteSeq(db, [
        [itemRow], // deriveSellableFacts → getSellableRow
        [{ uom: 'Unidad' }], // deriveSellableFacts → uom lookup
        NO_HISTORY, // itemHasHistory — every branch empty
        [{ ...itemRow, uom: 'mL' }], // final readback
      ]);
      const setSpy = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
      (db as unknown as { update: ReturnType<typeof vi.fn> }).update = vi
        .fn()
        .mockReturnValue({ set: setSpy });

      const row = await updateSellable(ctx(db), 'fp-14', { uom: 'mL' }, actor);

      expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ uom: 'mL' }));
      expect(row.code).toBe('BTX');
    });

    it("uom 'Unidad'→'mL' on an item WITH history throws 'uom_immutable' (unchanged S1 code), mutates nothing", async () => {
      const { db, itemRow } = uomFixture();
      mockExecuteSeq(db, [
        [itemRow],
        [{ uom: 'Unidad' }],
        [{ ledger: true, entry_lines: false, bins: false, billed: false }],
      ]);

      await expect(updateSellable(ctx(db), 'fp-14', { uom: 'mL' }, actor)).rejects.toMatchObject({
        code: 'uom_immutable',
      });
      expect((db as unknown as { update: ReturnType<typeof vi.fn> }).update).not.toHaveBeenCalled();
    });

    it('an injected history-query failure PROPAGATES — never a fabricated answer, and no writes', async () => {
      const { db, itemRow } = uomFixture();
      mockExecuteSeq(db, [[itemRow], [{ uom: 'Unidad' }]]);
      (db as unknown as { execute: ReturnType<typeof vi.fn> }).execute.mockRejectedValueOnce(
        new Error('history probe failed'),
      );

      await expect(updateSellable(ctx(db), 'fp-14', { uom: 'mL' }, actor)).rejects.toThrow(
        'history probe failed',
      );
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
