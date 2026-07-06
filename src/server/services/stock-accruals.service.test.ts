import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { accrueConsumption, releaseAccruals, resolveDefaultWarehouse } from './stock-accruals.service';

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
