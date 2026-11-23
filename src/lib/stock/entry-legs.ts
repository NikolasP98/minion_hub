/**
 * Stock-entry → ledger-leg expansion. Pure, no DB, no server imports — it
 * lives in `$lib` (not `$server/services/stock.logic.ts`, which re-exports it)
 * because the `/stock/entries/new` form previews the very same movement the
 * server will post. One function, one sign convention, both sides.
 */

export const ENTRY_TYPES = ['receipt', 'issue', 'transfer', 'adjustment', 'exchange'] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

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

/**
 * Expand one entry line into its ledger legs (unsigned qty → signed deltas).
 * A transfer's "in" leg carries `rate: null` — the orchestration fills it
 * with the "out" leg's `rateUsed` once it has read the from-bin, which
 * preserves total value across the move instead of re-pricing it.
 *
 * A leg's `warehouseId` is only as good as the line handed in: a half-filled
 * draft line yields a leg with an empty id, which the preview drops. The
 * server path validates with `validateEntryLine` first, so it never sees one.
 */
export function expandLine(type: EntryType, line: EntryLineLike): LegPlan[] {
  switch (type) {
    case 'receipt':
      return [{ warehouseId: line.toWarehouseId ?? '', qtyDelta: line.qty, rate: line.rate }];
    case 'issue':
      return [{ warehouseId: line.fromWarehouseId ?? '', qtyDelta: -line.qty, rate: null }];
    case 'transfer':
      return [
        { warehouseId: line.fromWarehouseId ?? '', qtyDelta: -line.qty, rate: null },
        { warehouseId: line.toWarehouseId ?? '', qtyDelta: line.qty, rate: null },
      ];
    // An exchange (canje, spec 142) line is one side of the trade: an outgoing
    // line leaves its from-warehouse, an incoming one enters its to-warehouse
    // at the rate submit computes from the outgoing value.
    case 'adjustment':
    case 'exchange':
      return line.toWarehouseId
        ? [{ warehouseId: line.toWarehouseId, qtyDelta: line.qty, rate: line.rate }]
        : [{ warehouseId: line.fromWarehouseId ?? '', qtyDelta: -line.qty, rate: null }];
  }
}

// ── Exchange (canje, spec 142) ───────────────────────────────────────────────

export type ExchangeErrorCode =
  'exchange_party_required' | 'exchange_needs_both_sides' | 'exchange_item_both_sides';

/**
 * Whole-entry rules of a canje, checked at submit (a draft may be incomplete):
 * at least one outgoing and one incoming line, no item on both sides, and a
 * supplier. Returns the first broken rule's code, or null.
 */
export function validateExchange(
  lines: Array<Pick<EntryLineLike, 'fromWarehouseId' | 'toWarehouseId'> & { itemId: string }>,
  partyId: string | null,
): ExchangeErrorCode | null {
  const out = new Set(lines.filter((l) => l.fromWarehouseId).map((l) => l.itemId));
  const inn = lines.filter((l) => l.toWarehouseId).map((l) => l.itemId);
  if (out.size === 0 || inn.length === 0) return 'exchange_needs_both_sides';
  if (inn.some((id) => out.has(id))) return 'exchange_item_both_sides';
  if (!partyId) return 'exchange_party_required';
  return null;
}

/**
 * Unit rates for a canje's incoming lines: the outgoing value (rounded to
 * 4 dp) spread by quantity, so every incoming unit carries the same value. The
 * LAST line takes the remainder, so Σ(qty × rate) === outValue to 4 dp. The
 * rate itself is not rounded: rounding it could push the remainder negative
 * when one line holds thousands of units.
 */
export function splitExchangeValue(outValue: number, inLines: Array<{ qty: number }>): number[] {
  const total = Math.round(outValue * 10_000) / 10_000;
  const totalQty = inLines.reduce((s, l) => s + l.qty, 0);
  if (!(totalQty > 0) || total === 0) return inLines.map(() => 0);
  const rate = total / totalQty;
  const others = inLines.slice(0, -1).reduce((s, l) => s + l.qty * rate, 0);
  return inLines.map((l, i) => (i < inLines.length - 1 ? rate : (total - others) / l.qty));
}
