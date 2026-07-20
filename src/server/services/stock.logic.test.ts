import { describe, it, expect } from 'vitest';
import {
  applyLedgerDelta,
  computeLegValue,
  wouldGoNegative,
  validateEntryLine,
  expandLine,
  wouldCreateCycle,
  wouldCreateComponentCycle,
  rollupItemCost,
  edgesByParent,
  type ComponentEdge,
  replayBins,
  binKey,
  consumptionToStockQty,
  round4,
  validateItemUomConfig,
  EMPTY_BIN,
  type BinState,
} from './stock.logic';

describe('applyLedgerDelta — moving-average valuation', () => {
  it('a receipt into an empty bin sets rate = the incoming rate', () => {
    const next = applyLedgerDelta(EMPTY_BIN, 10, 10 * 5);
    expect(next).toEqual({ qty: 10, rate: 5 });
  });

  it('blends two receipts at different rates into a weighted average', () => {
    // 10 @ 5 = 50, then 10 @ 15 = 150 → 20 units worth 200 → rate 10
    let bin: BinState = applyLedgerDelta(EMPTY_BIN, 10, 50);
    bin = applyLedgerDelta(bin, 10, 150);
    expect(bin.qty).toBe(20);
    expect(bin.rate).toBe(10);
  });

  it('an issue consumes at the CURRENT bin rate and leaves the rate unchanged', () => {
    // ERPNext moving-average sequence: receipt 10@5, receipt 10@15 → rate 10.
    // Issue 5 → qty 15, value 150 (unchanged rate), rate stays 10.
    let bin: BinState = applyLedgerDelta(EMPTY_BIN, 10, 50);
    bin = applyLedgerDelta(bin, 10, 150);
    const { valueDelta } = computeLegValue(bin, -5, null);
    bin = applyLedgerDelta(bin, -5, valueDelta);
    expect(bin.qty).toBe(15);
    expect(bin.rate).toBe(10);
  });

  it('is exactly invertible: negate (qtyDelta, valueDelta) and re-apply restores the prior bin', () => {
    const before: BinState = { qty: 7, rate: 3 };
    const qtyDelta = 4;
    const valueDelta = 4 * 20; // receipt of 4 @ rate 20
    const after = applyLedgerDelta(before, qtyDelta, valueDelta);
    const reversed = applyLedgerDelta(after, -qtyDelta, -valueDelta);
    expect(reversed.qty).toBeCloseTo(before.qty, 9);
    expect(reversed.rate).toBeCloseTo(before.rate, 9);
  });

  it('an emptied bin (qty → 0) resets rate to 0 instead of dividing by zero', () => {
    const bin: BinState = { qty: 5, rate: 8 };
    const next = applyLedgerDelta(bin, -5, -40);
    expect(next).toEqual({ qty: 0, rate: 0 });
  });

  it('never persists a negative rate — an over-issued bin carries its prior rate', () => {
    // Bin over-issued into negative value (issue posted before its receipt): qty
    // goes positive again but running value is negative → naive rate would be < 0.
    // qty 2 @ rate 10 (value 20); a receipt of 1 whose value contribution is
    // -100 (corrupted upstream) → newQty 3, newValue -80 → naive rate -26.7.
    const bin: BinState = { qty: 2, rate: 10 };
    const next = applyLedgerDelta(bin, 1, -100);
    expect(next.qty).toBe(3);
    expect(next.rate).toBe(10); // carried, not -26.7
  });
});

describe('computeLegValue', () => {
  it('incoming legs value at the supplied rate', () => {
    expect(computeLegValue(EMPTY_BIN, 10, 7)).toEqual({ valueDelta: 70, rateUsed: 7 });
  });
  it('incoming legs with no rate fall back to the bin rate (e.g. transfer in-leg placeholder)', () => {
    const bin: BinState = { qty: 5, rate: 4 };
    expect(computeLegValue(bin, 3, null)).toEqual({ valueDelta: 12, rateUsed: 4 });
  });
  it('outgoing legs ALWAYS consume at the bin rate, ignoring any supplied rate', () => {
    const bin: BinState = { qty: 5, rate: 4 };
    expect(computeLegValue(bin, -2, 999)).toEqual({ valueDelta: -8, rateUsed: 4 });
  });
});

describe('wouldGoNegative — the negative-stock guard', () => {
  it('blocks an issue larger than the bin', () => {
    expect(wouldGoNegative({ qty: 5, rate: 1 }, -6)).toBe(true);
  });
  it('allows an issue that exactly empties the bin', () => {
    expect(wouldGoNegative({ qty: 5, rate: 1 }, -5)).toBe(false);
  });
  it('never blocks an incoming (positive) delta', () => {
    expect(wouldGoNegative({ qty: 0, rate: 0 }, 100)).toBe(false);
  });
});

describe('validateEntryLine', () => {
  const line = (over: Partial<Parameters<typeof validateEntryLine>[1]> = {}) => ({
    qty: 1,
    rate: null,
    fromWarehouseId: null,
    toWarehouseId: null,
    ...over,
  });

  it('receipt requires to_warehouse + a rate', () => {
    expect(validateEntryLine('receipt', line())).toEqual(
      expect.arrayContaining(['receipt requires to_warehouse', 'receipt requires a rate']),
    );
    expect(validateEntryLine('receipt', line({ toWarehouseId: 'w1', rate: 5 }))).toEqual([]);
  });

  it('issue requires from_warehouse and does not need a rate', () => {
    expect(validateEntryLine('issue', line())).toEqual(['issue requires from_warehouse']);
    expect(validateEntryLine('issue', line({ fromWarehouseId: 'w1' }))).toEqual([]);
  });

  it('transfer requires two distinct warehouses', () => {
    expect(validateEntryLine('transfer', line({ fromWarehouseId: 'w1', toWarehouseId: 'w1' }))).toEqual([
      'transfer requires two different warehouses',
    ]);
    expect(validateEntryLine('transfer', line({ fromWarehouseId: 'w1', toWarehouseId: 'w2' }))).toEqual([]);
  });

  it('adjustment requires exactly one warehouse side; a positive (to_) side needs a rate', () => {
    expect(validateEntryLine('adjustment', line())).toEqual(
      expect.arrayContaining(['adjustment requires exactly one of from_warehouse / to_warehouse']),
    );
    expect(validateEntryLine('adjustment', line({ toWarehouseId: 'w1' }))).toEqual([
      'a positive (found-stock) adjustment requires a rate',
    ]);
    expect(validateEntryLine('adjustment', line({ toWarehouseId: 'w1', rate: 3 }))).toEqual([]);
    expect(validateEntryLine('adjustment', line({ fromWarehouseId: 'w1' }))).toEqual([]);
  });

  it('rejects a non-positive qty', () => {
    expect(validateEntryLine('issue', line({ qty: 0, fromWarehouseId: 'w1' }))).toEqual(['qty must be > 0']);
  });
});

describe('expandLine', () => {
  it('receipt → one in-leg on to_warehouse at the line rate', () => {
    expect(expandLine('receipt', { qty: 10, rate: 5, fromWarehouseId: null, toWarehouseId: 'w1' })).toEqual([
      { warehouseId: 'w1', qtyDelta: 10, rate: 5 },
    ]);
  });
  it('issue → one out-leg on from_warehouse, rate null (consume at bin rate)', () => {
    expect(expandLine('issue', { qty: 4, rate: null, fromWarehouseId: 'w1', toWarehouseId: null })).toEqual([
      { warehouseId: 'w1', qtyDelta: -4, rate: null },
    ]);
  });
  it('transfer → an out-leg and an in-leg, both with rate null (filled in by orchestration)', () => {
    expect(expandLine('transfer', { qty: 3, rate: null, fromWarehouseId: 'w1', toWarehouseId: 'w2' })).toEqual([
      { warehouseId: 'w1', qtyDelta: -3, rate: null },
      { warehouseId: 'w2', qtyDelta: 3, rate: null },
    ]);
  });
  it('adjustment with to_warehouse → an in-leg at the line rate', () => {
    expect(expandLine('adjustment', { qty: 2, rate: 9, fromWarehouseId: null, toWarehouseId: 'w1' })).toEqual([
      { warehouseId: 'w1', qtyDelta: 2, rate: 9 },
    ]);
  });
  it('adjustment with from_warehouse → an out-leg', () => {
    expect(expandLine('adjustment', { qty: 2, rate: null, fromWarehouseId: 'w1', toWarehouseId: null })).toEqual([
      { warehouseId: 'w1', qtyDelta: -2, rate: null },
    ]);
  });
});

describe('wouldCreateCycle — warehouse tree', () => {
  const tree = [
    { id: 'root', parentId: null },
    { id: 'a', parentId: 'root' },
    { id: 'b', parentId: 'a' },
  ];
  it('a warehouse cannot be its own parent', () => {
    expect(wouldCreateCycle(tree, 'a', 'a')).toBe(true);
  });
  it('a warehouse cannot be reparented under its own descendant', () => {
    expect(wouldCreateCycle(tree, 'a', 'b')).toBe(true);
  });
  it('reparenting to an unrelated node is fine', () => {
    expect(wouldCreateCycle(tree, 'b', 'root')).toBe(false);
  });
  it('clearing the parent (null) never creates a cycle', () => {
    expect(wouldCreateCycle(tree, 'a', null)).toBe(false);
  });
});

describe('replayBins — rebuildBins recovery path', () => {
  it('reproduces bins by taking the LATEST ledger row per (item, warehouse)', () => {
    const rows = [
      { itemId: 'i1', warehouseId: 'w1', seq: 1, qtyAfter: 10, valuationRate: 5 },
      { itemId: 'i1', warehouseId: 'w1', seq: 3, qtyAfter: 15, valuationRate: 10 },
      { itemId: 'i1', warehouseId: 'w1', seq: 2, qtyAfter: 20, valuationRate: 10 }, // out of order input
      { itemId: 'i2', warehouseId: 'w1', seq: 1, qtyAfter: 4, valuationRate: 2 },
    ];
    const bins = replayBins(rows);
    expect(bins.get(binKey('i1', 'w1'))).toEqual({ itemId: 'i1', warehouseId: 'w1', qty: 15, rate: 10 });
    expect(bins.get(binKey('i2', 'w1'))).toEqual({ itemId: 'i2', warehouseId: 'w1', qty: 4, rate: 2 });
  });

  it('an item never ledgered has no bin', () => {
    expect(replayBins([]).size).toBe(0);
  });

  it('matches the running-total bin state a full apply/cancel sequence would produce', () => {
    // receipt 10@5, receipt 10@15 (rate→10), issue 5 (rate stays 10), cancel the
    // first receipt (reversing row) → replay must land on the SAME final bin a
    // live sequential apply would.
    let bin: BinState = applyLedgerDelta(EMPTY_BIN, 10, 50);
    const seq: Array<{ itemId: string; warehouseId: string; seq: number; qtyAfter: number; valuationRate: number }> = [];
    seq.push({ itemId: 'i', warehouseId: 'w', seq: 1, qtyAfter: bin.qty, valuationRate: bin.rate });

    bin = applyLedgerDelta(bin, 10, 150);
    seq.push({ itemId: 'i', warehouseId: 'w', seq: 2, qtyAfter: bin.qty, valuationRate: bin.rate });

    const { valueDelta: issueValue } = computeLegValue(bin, -5, null);
    bin = applyLedgerDelta(bin, -5, issueValue);
    seq.push({ itemId: 'i', warehouseId: 'w', seq: 3, qtyAfter: bin.qty, valuationRate: bin.rate });

    // Cancel the first receipt: reverse (10, 50).
    bin = applyLedgerDelta(bin, -10, -50);
    seq.push({ itemId: 'i', warehouseId: 'w', seq: 4, qtyAfter: bin.qty, valuationRate: bin.rate });

    const replayed = replayBins(seq);
    expect(replayed.get(binKey('i', 'w'))).toEqual({ itemId: 'i', warehouseId: 'w', qty: bin.qty, rate: bin.rate });
  });
});

describe('consumptionToStockQty — per-item uom conversion (P5.1b)', () => {
  it('converts 5ml of a 500ml/caja item to 0.01 caja', () => {
    expect(consumptionToStockQty({ unitsPerStockUom: 500 }, 5)).toBeCloseTo(0.01, 9);
  });
  it('is the identity when the item has no unitsPerStockUom (consumption uom == stock uom)', () => {
    expect(consumptionToStockQty({ unitsPerStockUom: null }, 7)).toBe(7);
  });
});

describe('round4', () => {
  it('rounds to 4 decimal places', () => {
    expect(round4(5 / 500)).toBe(0.01);
    expect(round4(1 / 3)).toBe(0.3333);
  });
});

describe('validateItemUomConfig', () => {
  it('rejects a consumptionUom set without a unitsPerStockUom', () => {
    expect(validateItemUomConfig({ consumptionUom: 'ml', unitsPerStockUom: null })).toMatch(/unitsPerStockUom/);
  });
  it('allows a consumptionUom with a unitsPerStockUom', () => {
    expect(validateItemUomConfig({ consumptionUom: 'ml', unitsPerStockUom: 500 })).toBeNull();
  });
  it('allows no consumptionUom at all (stock uom == consumption uom)', () => {
    expect(validateItemUomConfig({ consumptionUom: null, unitsPerStockUom: null })).toBeNull();
  });
});

// ── Item composition DAG ────────────────────────────────────────────────────
// The cooking model: potato/milk/salt -> mash; chicken/batter -> fried chicken;
// mash + fried chicken -> plate.
const e = (parentItemId: string, childItemId: string, qty: number): ComponentEdge => ({ parentItemId, childItemId, qty });

describe('wouldCreateComponentCycle — DAG reachability', () => {
  it('rejects a self-edge', () => {
    expect(wouldCreateComponentCycle([], 'mash', 'mash')).toBe(true);
  });

  it('allows an item to be a component of TWO different recipes (a DAG, not a tree)', () => {
    // salt is already in mash; adding it to the sauce too is legitimate —
    // this is exactly what wouldCreateCycle (tree/single-parent) cannot model.
    const edges = [e('mash', 'salt', 2)];
    expect(wouldCreateComponentCycle(edges, 'sauce', 'salt')).toBe(false);
  });

  it('allows a diamond: two recipes sharing a sub-recipe', () => {
    const edges = [e('plate', 'mash', 1), e('plate', 'chicken', 1), e('mash', 'salt', 2)];
    expect(wouldCreateComponentCycle(edges, 'chicken', 'salt')).toBe(false);
  });

  it('rejects a direct back-edge (child already reaches parent)', () => {
    const edges = [e('mash', 'potato', 3)];
    expect(wouldCreateComponentCycle(edges, 'potato', 'mash')).toBe(true);
  });

  it('rejects an INDIRECT back-edge several levels up', () => {
    const edges = [e('plate', 'chicken', 1), e('chicken', 'batter', 1), e('batter', 'flour', 2)];
    // flour -> plate would close plate -> chicken -> batter -> flour -> plate
    expect(wouldCreateComponentCycle(edges, 'flour', 'plate')).toBe(true);
  });

  it('terminates on pre-existing bad data instead of hanging', () => {
    const edges = [e('a', 'b', 1), e('b', 'a', 1)]; // already cyclic
    expect(wouldCreateComponentCycle(edges, 'c', 'a')).toBe(false);
  });
});

describe('rollupItemCost — recursive cost', () => {
  const rates: Record<string, number> = { potato: 2, milk: 5, salt: 1, chicken: 20, flour: 3 };
  const leafRate = (id: string) => rates[id] ?? 0;

  it('a leaf costs its own rate', () => {
    expect(rollupItemCost('potato', new Map(), leafRate).cost).toBe(2);
  });

  it('a one-level recipe sums qty x child cost', () => {
    // mash = 3 potato (2) + 1 milk (5) + 2 salt (1) = 6 + 5 + 2 = 13
    const byParent = edgesByParent([e('mash', 'potato', 3), e('mash', 'milk', 1), e('mash', 'salt', 2)]);
    expect(rollupItemCost('mash', byParent, leafRate).cost).toBe(13);
  });

  it('recurses through sub-recipes to arbitrary depth', () => {
    // batter = 2 flour (3) = 6
    // fried  = 1 chicken (20) + 1 batter (6) = 26
    // plate  = 1 fried (26) + 1 mash (13) = 39
    const byParent = edgesByParent([
      e('plate', 'fried', 1),
      e('plate', 'mash', 1),
      e('fried', 'chicken', 1),
      e('fried', 'batter', 1),
      e('batter', 'flour', 2),
      e('mash', 'potato', 3),
      e('mash', 'milk', 1),
      e('mash', 'salt', 2),
    ]);
    expect(rollupItemCost('batter', byParent, leafRate).cost).toBe(6);
    expect(rollupItemCost('fried', byParent, leafRate).cost).toBe(26);
    expect(rollupItemCost('plate', byParent, leafRate).cost).toBe(39);
  });

  it('multiplies quantities down the tree', () => {
    // 2 batter per fried => 2 x (2 flour x 3) = 12
    const byParent = edgesByParent([e('fried', 'batter', 2), e('batter', 'flour', 2)]);
    expect(rollupItemCost('fried', byParent, leafRate).cost).toBe(12);
  });

  it('counts a shared sub-recipe once per use, not once overall', () => {
    // both halves use salt; each contributes its own qty
    const byParent = edgesByParent([e('plate', 'mash', 1), e('plate', 'sauce', 1), e('mash', 'salt', 2), e('sauce', 'salt', 3)]);
    expect(rollupItemCost('plate', byParent, leafRate).cost).toBe(5);
  });

  it('an unpriced leaf contributes 0 AND marks the whole recipe partial', () => {
    const byParent = edgesByParent([e('mash', 'unknown-item', 4)]);
    expect(rollupItemCost('mash', byParent, leafRate)).toEqual({ cost: 0, partial: true });
  });

  it('partial propagates upward from any depth — one unpriced ingredient taints the plate', () => {
    const byParent = edgesByParent([e('plate', 'fried', 1), e('fried', 'batter', 1), e('batter', 'mystery', 2), e('plate', 'mash', 1), e('mash', 'salt', 1)]);
    const plate = rollupItemCost('plate', byParent, leafRate);
    expect(plate.partial).toBe(true);
    expect(plate.cost).toBe(1); // only the salt is known — an UNDERSTATED bound
  });

  it('a fully priced recipe is not partial', () => {
    const byParent = edgesByParent([e('mash', 'potato', 3), e('mash', 'milk', 1)]);
    expect(rollupItemCost('mash', byParent, leafRate)).toEqual({ cost: 11, partial: false });
  });

  it('does not hang on cyclic data (guard, not a substitute for the write check)', () => {
    const byParent = edgesByParent([e('a', 'b', 1), e('b', 'a', 1)]);
    expect(rollupItemCost('a', byParent, leafRate).cost).toBe(0);
  });
});
