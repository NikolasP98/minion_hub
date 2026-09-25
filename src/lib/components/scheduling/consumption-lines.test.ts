import { describe, expect, it } from 'vitest';
import { completionLines, stockQty, type ConsumptionRow } from './consumption-lines';

const row = (over: Partial<ConsumptionRow>): ConsumptionRow => ({
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

  it('is null when nothing positive is left (endpoint realizes accruals as-is)', () => {
    expect(completionLines([])).toBeNull();
    expect(completionLines([row({ actual: 0 })])).toBeNull();
  });
});

describe('stockQty', () => {
  it('treats a zero/absent conversion as 1:1', () => {
    expect(stockQty(0, 4)).toBe(4);
    expect(stockQty(null, 4)).toBe(4);
  });
});
