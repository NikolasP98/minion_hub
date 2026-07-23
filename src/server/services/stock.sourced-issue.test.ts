import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { stkEntries, stkEntryLines, stkItems } from '$server/db/pg-schema/stock';
import { createSourcedIssue } from './stock.service';

beforeEach(() => {
  vi.clearAllMocks();
});

// pg rows are typed for PostgresJsDatabase; the mock db is structural — cast.
const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });
const actor = { id: 'u1', name: 'Test User' };

/**
 * Hand-rolled tx mock (not the generic createMockDb() chain proxy — that proxy
 * mints a fresh vi.fn() on every `.values(...)` access, so it can't capture
 * *what* was inserted, only that `insert` was called). Same technique as
 * audit-coverage.test.ts: stable vi.fn()s keyed by real table-object identity,
 * so `table === stkEntries` etc. just works without mocking the schema.
 */
function buildTx(itemRows: Array<{ id: string; unitsPerStockUom: string | null }> = []) {
  const insertCalls: Array<{ table: unknown; rows: unknown[] }> = [];
  const insert = vi.fn((table: unknown) => ({
    values: (rows: unknown) => {
      const rowsArr = Array.isArray(rows) ? rows : [rows];
      insertCalls.push({ table, rows: rowsArr });
      if (table === stkEntries) {
        return { returning: () => Promise.resolve([{ id: 'entry1', ...(rowsArr[0] as object) }]) };
      }
      return Promise.resolve(undefined);
    },
  }));
  const select = vi.fn(() => ({
    from: (table: unknown) => ({
      where: () => Promise.resolve(table === stkItems ? itemRows : []),
    }),
  })); // no duplicate found; optional item rows support authoritative UOM conversion
  const execute = vi.fn().mockResolvedValue(undefined);
  return { tx: { insert, select, execute }, insertCalls };
}

function ctxWithTx(tx: unknown) {
  return {
    db: { transaction: (cb: (t: unknown) => unknown) => cb(tx) },
    tenantId: 'org-1',
  } as never;
}

describe('createSourcedIssue — draft creation', () => {
  it('inserts a draft issue entry stamped with source/sourceId metadata and the given lines', async () => {
    const { tx, insertCalls } = buildTx();

    const entry = await createSourcedIssue(ctxWithTx(tx), {
      source: 'pos',
      sourceId: 't-1',
      warehouseId: 'wh1',
      partyId: 'party-1',
      note: 'POS ticket #t-1',
      lines: [
        { itemId: 'item1', qty: 2 },
        { itemId: 'item2', qty: 1 },
      ],
      actor,
      metadata: { register: 'r1' },
    });

    expect(entry).toMatchObject({ id: 'entry1', status: 'draft', type: 'issue' });

    const entryInsert = insertCalls.find((c) => c.table === stkEntries);
    expect(entryInsert).toBeTruthy();
    const entryRow = entryInsert!.rows[0] as Record<string, unknown>;
    expect(entryRow.type).toBe('issue');
    expect(entryRow.status).toBe('draft');
    expect(entryRow.partyId).toBe('party-1');
    expect(entryRow.note).toBe('POS ticket #t-1');
    expect(entryRow.createdBy).toBe('u1');
    expect(entryRow.metadata).toEqual({ source: 'pos', sourceId: 't-1', register: 'r1' });

    const lineInsert = insertCalls.find((c) => c.table === stkEntryLines);
    expect(lineInsert).toBeTruthy();
    expect(lineInsert!.rows).toEqual([
      {
        orgId: 'org-1',
        entryId: 'entry1',
        itemId: 'item1',
        qty: '2',
        uom: null,
        rate: null,
        fromWarehouseId: 'wh1',
        toWarehouseId: null,
        lineNo: 0,
      },
      {
        orgId: 'org-1',
        entryId: 'entry1',
        itemId: 'item2',
        qty: '1',
        uom: null,
        rate: null,
        fromWarehouseId: 'wh1',
        toWarehouseId: null,
        lineNo: 1,
      },
    ]);
  });

  it('converts consumption UOM authoritatively and ignores the caller stock fallback', async () => {
    const { tx, insertCalls } = buildTx([{ id: 'item-h', unitsPerStockUom: '15' }]);

    await createSourcedIssue(ctxWithTx(tx), {
      source: 'pos',
      sourceId: 't-h',
      warehouseId: 'wh1',
      lines: [{ itemId: 'item-h', qty: 999, qtyConsumption: 10 }],
      actor,
    });

    const lineInsert = insertCalls.find((c) => c.table === stkEntryLines);
    expect(lineInsert?.rows).toEqual([
      {
        orgId: 'org-1',
        entryId: 'entry1',
        itemId: 'item-h',
        qty: '0.6667',
        uom: null,
        rate: null,
        fromWarehouseId: 'wh1',
        toWarehouseId: null,
        lineNo: 0,
      },
    ]);
  });
});

describe('createSourcedIssue — submit path', () => {
  it('submit:true carries the entry through submitEntry to status submitted', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [], // dup check — no existing entry
      [{ id: 'entry1', orgId: 'org-1', type: 'issue', status: 'draft' }], // stk_entries insert returning
      [], // stk_entry_lines insert
      [{ id: 'entry1', orgId: 'org-1', status: 'draft', type: 'issue', humanId: 'STE-PRESET' }], // submitEntry: select entry for update
      [
        {
          id: 'l1',
          entryId: 'entry1',
          itemId: 'item1',
          qty: '5',
          uom: null,
          rate: null,
          fromWarehouseId: 'wh1',
          toWarehouseId: null,
          lineNo: 0,
        },
      ], // select lines
      [{ id: 'item1' }], // item existence
      [{ id: 'wh1' }], // warehouse existence
      [{ qty: '10', valuationRate: '1' }], // locked bin — enough stock
      [], // insert ledger
      [], // writeBins upsert
      [{ id: 'entry1', orgId: 'org-1', status: 'submitted', type: 'issue', humanId: 'STE-PRESET' }], // update entries returning
      [], // recordAudit insert
    ]);

    const entry = await createSourcedIssue(ctx(db), {
      source: 'pos_refill',
      sourceId: 't-2',
      warehouseId: 'wh1',
      lines: [{ itemId: 'item1', qty: 5 }],
      submit: true,
      actor,
    });

    expect(entry.status).toBe('submitted');
  });
});

describe('createSourcedIssue — duplicate guard', () => {
  it('throws duplicate_source when a non-cancelled entry already exists for (source, sourceId)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'existing-entry' }]]); // dup check hits
    await expect(
      createSourcedIssue(ctx(db), {
        source: 'pos',
        sourceId: 't-1',
        warehouseId: 'wh1',
        lines: [{ itemId: 'item1', qty: 1 }],
        actor,
      }),
    ).rejects.toMatchObject({ code: 'duplicate_source' });
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe('createSourcedIssue — no_lines guard', () => {
  it('throws no_lines before touching the db when lines is empty', async () => {
    const { db } = createMockDb();
    await expect(
      createSourcedIssue(ctx(db), {
        source: 'pos',
        sourceId: 't-1',
        warehouseId: 'wh1',
        lines: [],
        actor,
      }),
    ).rejects.toMatchObject({ code: 'no_lines' });
    expect(db.select).not.toHaveBeenCalled();
  });
});
