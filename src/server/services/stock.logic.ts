/**
 * Pure stock-valuation math (ERPNext moving-average model). No DB — the
 * orchestration (stock.service.ts) reads/writes bins around these functions
 * inside one withOrgCore tx with `select ... for update` on the touched bins.
 * Mirrors the projects.service.ts / projects.logic.ts split (pure logic gets
 * its own file so it's unit-testable without a mocked db).
 */

export const ENTRY_TYPES = ['receipt', 'issue', 'transfer', 'adjustment'] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];
export const ENTRY_STATUSES = ['draft', 'submitted', 'cancelled'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export interface BinState {
  qty: number;
  rate: number;
}
export const EMPTY_BIN: BinState = { qty: 0, rate: 0 };

const EPS = 1e-9;

/**
 * Apply a signed (qtyDelta, valueDelta) movement to a bin and derive the new
 * valuation rate — the ONE formula this whole module rests on. `value = qty *
 * rate` is a running sum; adding a movement's own value contribution and
 * re-deriving `rate = value / qty` IS the moving-average method. Because it
 * only depends on the bin's current snapshot plus this movement's own
 * numbers, it is also exactly invertible: negate (qtyDelta, valueDelta) and
 * re-apply to the CURRENT bin to reverse it — the basis for cancelEntry, and
 * why rebuildBins can just replay the ledger's own qty_after/valuation_rate
 * snapshots instead of re-running this arithmetic.
 */
export function applyLedgerDelta(bin: BinState, qtyDelta: number, valueDelta: number): BinState {
  const newQty = bin.qty + qtyDelta;
  const newValue = bin.qty * bin.rate + valueDelta;
  const rate = Math.abs(newQty) > EPS ? newValue / newQty : 0;
  // A valuation rate is a unit cost — it can never be negative. That only arises
  // from an over-issued / out-of-order bin (an issue posted before its receipt,
  // driving running value negative while qty is positive). Carry the last known
  // good rate rather than persisting a nonsensical negative one. No effect on
  // healthy chronological postings (rate stays ≥ 0); guards the future hub-UI
  // path against backdated entries.
  const newRate = rate < 0 ? bin.rate : rate;
  return { qty: newQty, rate: newRate };
}

/**
 * Value contributed by one movement leg. Incoming (qtyDelta >= 0) legs value
 * at the given `rate` (falling back to the bin's current rate only if none
 * was supplied — e.g. a transfer's "in" leg, filled by the caller from the
 * "out" leg's rateUsed). Outgoing legs ALWAYS consume at the bin's current
 * rate — a line's own `rate` field is ignored for issues/negative
 * adjustments (ERPNext rule: you don't choose what you paid for stock that's
 * leaving).
 */
export function computeLegValue(bin: BinState, qtyDelta: number, rate: number | null): { valueDelta: number; rateUsed: number } {
  if (qtyDelta >= 0) {
    const r = rate ?? bin.rate;
    return { valueDelta: qtyDelta * r, rateUsed: r };
  }
  return { valueDelta: qtyDelta * bin.rate, rateUsed: bin.rate };
}

/** True when applying `qtyDelta` would take the bin negative (epsilon-safe). */
export function wouldGoNegative(bin: BinState, qtyDelta: number): boolean {
  return bin.qty + qtyDelta < -EPS;
}

// ── Entry-line → ledger-leg expansion ──────────────────────────────────────

export interface EntryLineLike {
  qty: number; // positive magnitude, as entered
  rate: number | null;
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
}

export interface LegPlan {
  warehouseId: string;
  qtyDelta: number; // signed
  /** Caller-supplied rate for 'in' legs; null = consume-at-bin-rate ('out')
   *  or "carry forward from the out-leg" (transfer's in-leg). */
  rate: number | null;
}

/** Structural validation — returns error strings (empty = valid). Existence
 *  of the item/warehouse rows themselves is checked by the DB-touching
 *  caller, not here. */
export function validateEntryLine(type: EntryType, line: EntryLineLike): string[] {
  const errs: string[] = [];
  if (!(line.qty > 0)) errs.push('qty must be > 0');
  if (type === 'receipt') {
    if (!line.toWarehouseId) errs.push('receipt requires to_warehouse');
    if (line.rate == null) errs.push('receipt requires a rate');
  } else if (type === 'issue') {
    if (!line.fromWarehouseId) errs.push('issue requires from_warehouse');
  } else if (type === 'transfer') {
    if (!line.fromWarehouseId || !line.toWarehouseId) errs.push('transfer requires from_warehouse and to_warehouse');
    else if (line.fromWarehouseId === line.toWarehouseId) errs.push('transfer requires two different warehouses');
  } else if (type === 'adjustment') {
    const has = [line.fromWarehouseId, line.toWarehouseId].filter(Boolean).length;
    if (has !== 1) errs.push('adjustment requires exactly one of from_warehouse / to_warehouse');
    if (line.toWarehouseId && line.rate == null) errs.push('a positive (found-stock) adjustment requires a rate');
  }
  return errs;
}

/**
 * Expand one entry line into its ledger legs (unsigned qty → signed deltas).
 * A transfer's "in" leg carries `rate: null` — the orchestration fills it
 * with the "out" leg's `rateUsed` once it has read the from-bin, which
 * preserves total value across the move instead of re-pricing it.
 */
export function expandLine(type: EntryType, line: EntryLineLike): LegPlan[] {
  switch (type) {
    case 'receipt':
      return [{ warehouseId: line.toWarehouseId!, qtyDelta: line.qty, rate: line.rate }];
    case 'issue':
      return [{ warehouseId: line.fromWarehouseId!, qtyDelta: -line.qty, rate: null }];
    case 'transfer':
      return [
        { warehouseId: line.fromWarehouseId!, qtyDelta: -line.qty, rate: null },
        { warehouseId: line.toWarehouseId!, qtyDelta: line.qty, rate: null },
      ];
    case 'adjustment':
      return line.toWarehouseId
        ? [{ warehouseId: line.toWarehouseId, qtyDelta: line.qty, rate: line.rate }]
        : [{ warehouseId: line.fromWarehouseId!, qtyDelta: -line.qty, rate: null }];
  }
}

// ── Warehouse tree ──────────────────────────────────────────────────────────

export interface WarehouseNode {
  id: string;
  parentId: string | null;
}

/** True if setting `id`'s parent to `newParentId` would create a cycle
 *  (including newParentId === id, or a self-loop reachable through the
 *  existing tree). Walks the existing parent chain from newParentId. */
export function wouldCreateCycle(warehouses: WarehouseNode[], id: string, newParentId: string | null): boolean {
  if (!newParentId) return false;
  if (newParentId === id) return true;
  const byId = new Map(warehouses.map((w) => [w.id, w]));
  let cur: string | null = newParentId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === id) return true;
    if (seen.has(cur)) return true; // pre-existing cycle in the data — treat as blocked
    seen.add(cur);
    cur = byId.get(cur)?.parentId ?? null;
  }
  return false;
}

// ── Item composition DAG (Slice 1b) ──────────────────────────────────────────

export interface ComponentEdge {
  parentItemId: string;
  childItemId: string;
  qty: number;
}

/** Group edges by parent — the shape both walks below want. */
export function edgesByParent(edges: ComponentEdge[]): Map<string, ComponentEdge[]> {
  const out = new Map<string, ComponentEdge[]>();
  for (const e of edges) {
    const list = out.get(e.parentItemId) ?? [];
    list.push(e);
    out.set(e.parentItemId, list);
  }
  return out;
}

/**
 * Would adding parent→child close a loop?
 *
 * NOTE this is NOT `wouldCreateCycle` (above): that one walks a single
 * `parentId` chain because warehouses form a TREE. Components form a DAG — an
 * item can be a component of many recipes — so there is no chain to walk;
 * correctness needs a reachability search instead. Adding parent→child cycles
 * exactly when `child` can already reach `parent`.
 */
export function wouldCreateComponentCycle(edges: ComponentEdge[], parentItemId: string, childItemId: string): boolean {
  if (parentItemId === childItemId) return true; // self-edge
  const byParent = edgesByParent(edges);
  const seen = new Set<string>();
  const stack = [childItemId];
  while (stack.length) {
    const cur = stack.pop() as string;
    if (cur === parentItemId) return true; // child already reaches parent
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const e of byParent.get(cur) ?? []) stack.push(e.childItemId);
  }
  return false;
}

export interface ItemCostResult {
  cost: number;
  /** Some leaf in this subtree has no valuation ⇒ `cost` is an UNDERSTATED
   *  lower bound. Propagates upward: one unpriced ingredient makes every
   *  recipe containing it partial, at any depth. Without this a composite
   *  would report a confident number built on a missing price. */
  partial: boolean;
}

/**
 * Recursive cost of one item: a leaf (no components) costs `leafRate(id)`;
 * a composite costs Σ (edge qty × child cost), to any depth.
 *
 * `memo` makes a diamond (two recipes sharing a sub-recipe) evaluate once, not
 * twice — it still contributes per use, since each edge multiplies its own qty.
 * `path` is a belt-and-braces guard: writes are cycle-checked, but bad data
 * must never hang a request — a node revisited on the current path contributes
 * 0 (and is marked partial) instead of recursing forever.
 */
export function rollupItemCost(
  rootId: string,
  byParent: Map<string, ComponentEdge[]>,
  leafRate: (id: string) => number,
  memo: Map<string, ItemCostResult> = new Map(),
  path: Set<string> = new Set(),
): ItemCostResult {
  const cached = memo.get(rootId);
  if (cached !== undefined) return cached;
  if (path.has(rootId)) return { cost: 0, partial: true }; // cycle — never recurse
  const kids = byParent.get(rootId);
  if (!kids || kids.length === 0) {
    const rate = leafRate(rootId);
    // A rate of 0 is "nobody valued this", not "it is free".
    const result: ItemCostResult = { cost: rate, partial: !(rate > 0) };
    memo.set(rootId, result);
    return result;
  }
  path.add(rootId);
  let cost = 0;
  let partial = false;
  for (const e of kids) {
    const child = rollupItemCost(e.childItemId, byParent, leafRate, memo, path);
    cost += e.qty * child.cost;
    partial = partial || child.partial;
  }
  path.delete(rootId);
  const result: ItemCostResult = { cost: round4(cost), partial };
  memo.set(rootId, result);
  return result;
}

// ── rebuildBins replay ───────────────────────────────────────────────────────

export interface LedgerReplayRow {
  itemId: string;
  warehouseId: string;
  seq: number; // strictly increasing insert order (stk_ledger.id)
  qtyAfter: number;
  valuationRate: number;
}

export interface BinSnapshot {
  itemId: string;
  warehouseId: string;
  qty: number;
  rate: number;
}

/**
 * Recovery path: bins are a cache, the ledger is truth. Each ledger row
 * already carries the resulting bin snapshot (qty_after, valuation_rate) —
 * replay is just "take the latest row per (item, warehouse)", not
 * re-running the moving-average arithmetic.
 */
export function replayBins(rows: LedgerReplayRow[]): Map<string, BinSnapshot> {
  const out = new Map<string, BinSnapshot>();
  for (const r of [...rows].sort((a, b) => a.seq - b.seq)) {
    const key = `${r.itemId}:${r.warehouseId}`;
    out.set(key, { itemId: r.itemId, warehouseId: r.warehouseId, qty: r.qtyAfter, rate: r.valuationRate });
  }
  return out;
}

export function binKey(itemId: string, warehouseId: string): string {
  return `${itemId}:${warehouseId}`;
}

// ── Per-item consumption-uom conversion (P5.1b) ─────────────────────────────

/** Converts a quantity expressed in an item's CONSUMPTION uom into its STOCK
 *  uom (the ledger/entry-line unit). Identity when unitsPerStockUom is unset
 *  (the item has no separate consumption uom). E.g. 5 ml of a 500 ml/caja
 *  item → 5 / 500 = 0.01 caja. */
export function consumptionToStockQty(item: { unitsPerStockUom: number | null }, qty: number): number {
  return item.unitsPerStockUom ? qty / item.unitsPerStockUom : qty;
}

/** Round to 4 decimal places — the precision converted (fractional) stock
 *  quantities are stored/displayed at. */
export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Cross-field item validation shared by create/update: a consumption uom
 *  only makes sense once the conversion factor to the stock uom is known. */
export function validateItemUomConfig(input: { consumptionUom?: string | null; unitsPerStockUom?: number | null }): string | null {
  if (input.consumptionUom && !input.unitsPerStockUom) return 'consumptionUom requires unitsPerStockUom to be set';
  return null;
}
