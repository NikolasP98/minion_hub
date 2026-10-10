/**
 * Stock-entry → ledger-leg expansion. Pure, no DB, no server imports — it
 * lives in `$lib` (not `$server/services/stock.logic.ts`, which re-exports it)
 * because the `/stock/entries/new` form previews the very same movement the
 * server will post. One function, one sign convention, both sides.
 */

export const ENTRY_TYPES = ['receipt', 'issue', 'transfer', 'adjustment'] as const;
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
    case 'adjustment':
      return line.toWarehouseId
        ? [{ warehouseId: line.toWarehouseId, qtyDelta: line.qty, rate: line.rate }]
        : [{ warehouseId: line.fromWarehouseId ?? '', qtyDelta: -line.qty, rate: null }];
  }
}
