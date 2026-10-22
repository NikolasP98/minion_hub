import { describe, expect, it } from 'vitest';
import {
  completionLines,
  completionLinesFor,
  mergeCompleteResults,
  mergeConsumptionRows,
  stockQty,
  type ConsumptionRow,
} from './consumption-lines';

const row = (over: Partial<ConsumptionRow>): ConsumptionRow => ({
  bookingId: 'b1',
  itemId: 'i1',
  itemName: 'Item',
  uom: 'bottle',
  consumptionUom: 'ml',
  unitsPerStockUom: 50,
  subunitsPerStockUom: null,
  diagramEnabled: true,
  expected: 10,
  actual: 10,
  ...over,
});

describe('completionLines', () => {
  it('converts the confirmed consumption to stock qty and keeps both numbers', () => {
    expect(completionLines([row({ actual: 10 })])).toEqual([
      { itemId: 'i1', qty: 0.2, qtyConsumption: 10 },
    ]);
  });

  it('passes the quantity through when the item has no consumption conversion', () => {
    expect(completionLines([row({ unitsPerStockUom: null, actual: 3 })])).toEqual([
      { itemId: 'i1', qty: 3, qtyConsumption: 3 },
    ]);
  });

  it('drops non-positive rows instead of blocking the completion', () => {
    const lines = completionLines([
      row({ itemId: 'a', actual: 0 }),
      row({ itemId: 'b', actual: -1 }),
      row({ itemId: 'c', actual: 25 }),
    ]);
    expect(lines?.map((l) => l.itemId)).toEqual(['c']);
  });

  it('is [] when every row was dragged to zero (explicit "nothing used")', () => {
    expect(completionLines([row({ actual: 0 })])).toEqual([]);
  });

  it('is null when there are no rows (endpoint realizes accruals as-is)', () => {
    expect(completionLines([])).toBeNull();
  });
});

describe('stockQty', () => {
  it('treats a zero/absent conversion as 1:1', () => {
    expect(stockQty(0, 4)).toBe(4);
    expect(stockQty(null, 4)).toBe(4);
  });
});

describe('completionLinesFor', () => {
  it('splits a merged visit row list by member, each converted on its own', () => {
    const rows = [
      row({ bookingId: 'lead', itemId: 'control-ink', actual: 0 }),
      row({ bookingId: 'botox', itemId: 'botox-vial', actual: 20, unitsPerStockUom: 100 }),
      row({ bookingId: 'afinamiento', itemId: 'serum', actual: 5, unitsPerStockUom: 50 }),
    ];
    expect(completionLinesFor(rows, 'botox')).toEqual([
      { itemId: 'botox-vial', qty: 0.2, qtyConsumption: 20 },
    ]);
    expect(completionLinesFor(rows, 'afinamiento')).toEqual([
      { itemId: 'serum', qty: 0.1, qtyConsumption: 5 },
    ]);
  });

  it('is null for a member with no rows (the lead service, usually)', () => {
    const rows = [row({ bookingId: 'botox', actual: 20 })];
    expect(completionLinesFor(rows, 'lead')).toBeNull();
  });
});

describe('mergeCompleteResults', () => {
  it('keeps the first result as-is when it is the only one', () => {
    const r = { ok: true, entryId: 'e1', stockWarning: null };
    expect(mergeCompleteResults(null, r)).toBe(r);
  });

  it('keeps the first non-null stockWarning and ANDs ok', () => {
    const warn = { code: 'short_bin', message: 'short' };
    const merged = mergeCompleteResults(
      { ok: true, entryId: 'e1', stockWarning: null },
      { ok: false, entryId: 'e2', stockWarning: warn },
    );
    expect(merged).toEqual({ ok: false, entryId: 'e1', stockWarning: warn });
  });
});

describe('completionLinesFor zero handling', () => {
  it('is null for a member with no rows and [] for one whose rows are all 0', () => {
    const rows = [row({ bookingId: 'a', actual: 0 }), row({ bookingId: 'b', actual: 5 })];
    expect(completionLinesFor(rows, 'none')).toBeNull();
    expect(completionLinesFor(rows, 'a')).toEqual([]);
  });
});

describe('mergeConsumptionRows', () => {
  const r = (itemId: string, actual: number) => ({ itemId, actual });

  it('lets the accrual win over the default for the same item', () => {
    expect(mergeConsumptionRows([r('x', 30)], [r('x', 0)])).toEqual([r('x', 30)]);
  });

  it('keeps a 0-default item beside an accrued sibling', () => {
    expect(mergeConsumptionRows([r('x', 30)], [r('y', 0), r('x', 10)])).toEqual([
      r('y', 0),
      r('x', 30),
    ]);
  });

  it('handles defaults-only and accruals-only', () => {
    expect(mergeConsumptionRows([], [r('y', 0)])).toEqual([r('y', 0)]);
    expect(mergeConsumptionRows([r('x', 3)], [])).toEqual([r('x', 3)]);
  });
});
