import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { accrueConsumption, releaseAccruals, resolveDefaultWarehouse, realizeAccruals, accrualSummaryForSources, availableToPromise } from './stock-accruals.service';

beforeEach(() => {
  vi.clearAllMocks();
});

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

describe('resolveDefaultWarehouse', () => {
  it('prefers the flagged default over the earliest-created', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[
      { id: 'w-old', isDefault: false },
      { id: 'w-def', isDefault: true },
    ]]);
    expect(await resolveDefaultWarehouse(ctx(db))).toBe('w-def');
  });
  it('falls back to the earliest-created; null when no warehouses', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'w-old', isDefault: false }], []]);
    expect(await resolveDefaultWarehouse(ctx(db))).toBe('w-old');
    expect(await resolveDefaultWarehouse(ctx(db))).toBeNull();
  });
});

describe('accrueConsumption', () => {
  it('accrues explicit lines with server-side uom conversion and bin-rate cost', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [], // existing accruals for source (none)
      [{ id: 'w1', isDefault: true }], // warehouses (default resolution)
      [{ id: 'i1', unitsPerStockUom: '500' }], // items (500 ml per caja)
      [{ itemId: 'i1', valuationRate: '100' }], // bins (S/100 per caja)
      [], // delete open rows
      [], // insert new rows
    ]);
    const n = await accrueConsumption(ctx(db), {
      source: 'booking',
      sourceId: 'b1',
      finProductId: 'p1',
      lines: [{ itemId: 'i1', qtyConsumption: 5 }], // 5 ml → 0.01 caja → est S/1
    });
    expect(n).toBe(1);
    expect(db.insert).toHaveBeenCalled();
  });

  it('computes defaults from stk_consumption when no lines are passed', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [], // existing accruals
      [{ id: 'w1', isDefault: false }], // warehouses
      [{ itemId: 'i1', qtyPerUnit: '2' }], // mapping: 2 per unit
      [{ id: 'i1', unitsPerStockUom: null }], // item (no conversion)
      [], // bins (no bin yet → cost 0)
      [], // delete
      [], // insert
    ]);
    const n = await accrueConsumption(ctx(db), { source: 'booking', sourceId: 'b1', finProductId: 'p1' });
    expect(n).toBe(1);
  });

  it('is a no-op when the source is already settled (realized rows exist)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'a1', status: 'realized' }]]);
    const n = await accrueConsumption(ctx(db), {
      source: 'booking',
      sourceId: 'b1',
      finProductId: 'p1',
      lines: [{ itemId: 'i1', qtyConsumption: 5 }],
    });
    expect(n).toBe(0);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('is a no-op when the org has no warehouses', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[], []]); // no accruals, no warehouses
    const n = await accrueConsumption(ctx(db), {
      source: 'booking',
      sourceId: 'b1',
      finProductId: 'p1',
      lines: [{ itemId: 'i1', qtyConsumption: 5 }],
    });
    expect(n).toBe(0);
  });

  it('is a no-op for an unmapped product (no lines, empty stk_consumption)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[], [{ id: 'w1', isDefault: true }], []]); // no accruals, warehouse, empty mapping
    const n = await accrueConsumption(ctx(db), { source: 'booking', sourceId: 'b1', finProductId: 'p1' });
    expect(n).toBe(0);
  });

  it('all-unknown item lines → no-op, does NOT wipe the existing open set', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [], // existing accruals
      [{ id: 'w1', isDefault: true }], // warehouses
      [], // items lookup — none of the line items exist
      [], // bins
    ]);
    const n = await accrueConsumption(ctx(db), {
      source: 'booking',
      sourceId: 'b1',
      finProductId: 'p1',
      lines: [{ itemId: 'ghost', qtyConsumption: 5 }],
    });
    expect(n).toBe(0);
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe('releaseAccruals', () => {
  it('flips only open rows and reports the count', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'a1' }, { id: 'a2' }]]); // update(...).returning()
    const n = await releaseAccruals(ctx(db), 'booking', 'b1');
    expect(n).toBe(2);
    expect(db.update).toHaveBeenCalled();
  });
});

const actor = { id: 'u1', name: 'Test User' };

describe('realizeAccruals', () => {
  it('no open accruals + no lines → clean no-op', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [], // open accruals
      [], // findEntryBySource
    ]);
    const r = await realizeAccruals(ctx(db), { source: 'booking', sourceId: 'b1', actor });
    expect(r).toEqual({ entry: null, realized: 0, stockWarning: null });
  });

  it('a pre-existing SUBMITTED entry heals accruals without a second issue (idempotent retry)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [
        { id: 'a1', itemId: 'i1', qty: '0.01', qtyConsumption: '5', finProductId: 'p1', warehouseId: 'w1' },
      ], // open accruals
      [{ id: 'e1', orgId: 'org-1', status: 'submitted', type: 'issue' }], // findEntryBySource
      [{ itemId: 'i1', qtyDelta: '-0.01', valueDelta: '-1' }], // ledger rows for e1
      [], // update accrual a1 → realized
    ]);
    const r = await realizeAccruals(ctx(db), { source: 'booking', sourceId: 'b1', actor });
    expect(r.entry?.id).toBe('e1');
    expect(r.realized).toBe(1);
    expect(r.stockWarning).toBeNull();
  });

  it('a draft that fails to submit returns stockWarning, leaves accruals open (negative-stock completion path)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [
        { id: 'a1', itemId: 'i1', qty: '10', qtyConsumption: '10', finProductId: 'p1', warehouseId: 'w1' },
      ], // open accruals
      [{ id: 'e1', orgId: 'org-1', status: 'draft', type: 'issue' }], // findEntryBySource → draft
      // submitEntry's internal sequence:
      [{ id: 'e1', orgId: 'org-1', status: 'draft', type: 'issue', humanId: null }], // entry for update
      [{ id: 'l1', entryId: 'e1', itemId: 'i1', qty: '10', uom: null, rate: null, fromWarehouseId: 'w1', toWarehouseId: null, lineNo: 0 }], // lines
      [{ id: 'i1' }], // item existence
      [{ id: 'w1' }], // warehouse existence
      [{ qty: '2', valuationRate: '1' }], // bin: only 2 in stock → negative_stock
    ]);
    const r = await realizeAccruals(ctx(db), { source: 'booking', sourceId: 'b1', actor });
    expect(r.stockWarning).toMatchObject({ code: 'negative_stock', draftEntryId: 'e1' });
    expect(r.realized).toBe(0);
    expect(db.update).not.toHaveBeenCalled(); // accruals untouched — still open
  });
});

describe('accrualSummaryForSources', () => {
  it('folds per-source status counts and values', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[
      { sourceId: 'b1', status: 'open', estValue: '10', realizedValue: null, realizedEntryId: null },
      { sourceId: 'b1', status: 'open', estValue: '5', realizedValue: null, realizedEntryId: null },
      { sourceId: 'b2', status: 'realized', estValue: '7', realizedValue: '8', realizedEntryId: 'e1' },
    ]]);
    const out = await accrualSummaryForSources(ctx(db), 'booking', ['b1', 'b2']);
    const b1 = out.find((s) => s.sourceId === 'b1')!;
    const b2 = out.find((s) => s.sourceId === 'b2')!;
    expect(b1).toMatchObject({ open: 2, realized: 0, estValue: 15 });
    expect(b2).toMatchObject({ open: 0, realized: 1, realizedValue: 8, realizedEntryId: 'e1' });
  });
  it('returns [] for an empty id list without querying', async () => {
    const { db } = createMockDb();
    expect(await accrualSummaryForSources(ctx(db), 'booking', [])).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe('availableToPromise', () => {
  it('bin qty minus open committed qty', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ qty: '10' }], // bin
      [{ total: '3' }], // open accruals sum
    ]);
    expect(await availableToPromise(ctx(db), 'i1', 'w1')).toBe(7);
  });
});
