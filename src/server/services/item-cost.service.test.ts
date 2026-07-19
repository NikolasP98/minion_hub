import { describe, it, expect } from 'vitest';
import { rollupFlatCost } from './item-cost.service';

describe('rollupFlatCost', () => {
  it('no mappings → not costable, zero', () => {
    expect(rollupFlatCost([], new Map())).toEqual({ cost: 0, costable: false, partial: false, lines: [] });
  });

  it('sums materials, converting consumption→stock uom', () => {
    // A: 500 ml/caja, uses 250 ml → 0.5 caja × rate 100 = 50
    // B: no conversion, uses 2 units × rate 3 = 6
    const rates = new Map([
      ['A', 100],
      ['B', 3],
    ]);
    const r = rollupFlatCost(
      [
        { itemId: 'A', qtyPerUnit: 250, unitsPerStockUom: 500 },
        { itemId: 'B', qtyPerUnit: 2, unitsPerStockUom: null },
      ],
      rates,
    );
    expect(r.cost).toBe(56);
    expect(r.costable).toBe(true);
    expect(r.partial).toBe(false);
  });

  it('missing bin rate → partial + understated, never a silent fake zero', () => {
    const r = rollupFlatCost([{ itemId: 'A', qtyPerUnit: 1, unitsPerStockUom: null }], new Map());
    expect(r.partial).toBe(true);
    expect(r.costable).toBe(true);
    expect(r.cost).toBe(0);
  });
});
