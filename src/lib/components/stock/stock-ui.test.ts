import { describe, it, expect } from 'vitest';
import { buildWarehouseTree, entryStatusVariant, gaugeMax } from './stock-ui';

describe('buildWarehouseTree', () => {
  it('orders depth-first with children indented under their parent', () => {
    const rows = [
      { id: 'a', name: 'Main', parentId: null },
      { id: 'b', name: 'Aisle 1', parentId: 'a' },
      { id: 'c', name: 'Bin 1', parentId: 'b' },
      { id: 'd', name: 'Aisle 2', parentId: 'a' },
    ];
    const tree = buildWarehouseTree(rows);
    expect(tree.map((r) => [r.id, r.depth])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
      ['d', 1],
    ]);
  });

  it('surfaces a dangling/cyclic parentId as a root instead of dropping it', () => {
    const rows = [
      { id: 'x', name: 'X', parentId: 'y' }, // y doesn't exist
      { id: 'y', name: 'Y', parentId: 'x' }, // would be a 2-cycle if both existed
    ];
    const tree = buildWarehouseTree(rows);
    expect(tree.map((r) => r.id).sort()).toEqual(['x', 'y']);
  });
});

describe('entryStatusVariant', () => {
  it('maps submitted/cancelled/draft to success/error/info', () => {
    expect(entryStatusVariant('submitted').value).toBe('success');
    expect(entryStatusVariant('cancelled').value).toBe('error');
    expect(entryStatusVariant('draft').value).toBe('info');
  });
});

describe('gaugeMax', () => {
  it('divides units by subunits when both are set (1 caja = 500ml / 10 bottles = 50ml)', () => {
    expect(gaugeMax({ uom: 'caja', unitsPerStockUom: 500, subunitsPerStockUom: 10 })).toBe(50);
  });

  it('falls back to unitsPerStockUom when subunits are not set', () => {
    expect(gaugeMax({ uom: 'caja', unitsPerStockUom: 500, subunitsPerStockUom: null })).toBe(500);
  });

  it('returns 0 when the conversion is not configured', () => {
    expect(gaugeMax({ uom: 'caja', unitsPerStockUom: null, subunitsPerStockUom: null })).toBe(0);
  });

  it('ignores non-positive subunits', () => {
    expect(gaugeMax({ uom: 'caja', unitsPerStockUom: 500, subunitsPerStockUom: 0 })).toBe(500);
  });
});
