/**
 * Pure payload math for the consumption confirmation dialog
 * (`ConsumptionConfirmDialog.svelte`).
 *
 * Every row carries BOTH quantities: `expected` — the service's default
 * consumption (`stk_consumption.qtyPerUnit`, or the already-accrued
 * `stk_accruals.qtyConsumption`) — and `actual`, what the user confirms was
 * really used. Expected stays on the accrual row server-side, actual becomes
 * the stock entry, so variance analysis has both numbers.
 */

export type ConsumptionRow = {
  /** Which visit member this row belongs to — a merged visit's dialog loads
   *  every member's rows into one list and completes each separately. */
  bookingId: string;
  itemId: string;
  itemName: string;
  /** Stock UOM (bottle, box…). */
  uom: string;
  /** Consumption UOM (ml, unit…) when the item is measured finer than stock. */
  consumptionUom: string | null;
  unitsPerStockUom: number | null;
  subunitsPerStockUom: number | null;
  diagramEnabled: boolean;
  /** Default / accrued expectation — the reference, never edited. */
  expected: number;
  /** What the user confirms was consumed, in the consumption UOM. */
  actual: number;
};

export type CompletionLine = { itemId: string; qty: number; qtyConsumption: number };

/** `POST …/bookings/[id]/complete` response (both the POS and scheduling paths). */
export type CompleteResult = {
  ok: boolean;
  entryId: string | null;
  stockWarning: { code: string; message: string } | null;
};

/** Consumption UOM → stock UOM (10 ml out of a 50 ml bottle = 0.2 bottles). */
export function stockQty(unitsPerStockUom: number | null, qtyConsumption: number): number {
  return unitsPerStockUom ? qtyConsumption / unitsPerStockUom : qtyConsumption;
}

/**
 * The `lines` body for `POST …/bookings/[id]/complete`. A row dragged to zero
 * is dropped rather than rejected. No rows at all (stock off / read failed) is
 * `null` = "realize the open accruals as-is"; rows that were all dragged to
 * zero is `[]` = "the user confirmed nothing was used" (releases the accruals).
 */
export function completionLines(rows: ConsumptionRow[]): CompletionLine[] | null {
  if (!rows.length) return null;
  return rows
    .filter((r) => r.actual > 0)
    .map((r) => ({
      itemId: r.itemId,
      qty: stockQty(r.unitsPerStockUom, r.actual),
      qtyConsumption: r.actual,
    }));
}

/**
 * Dialog rows = the member's open accruals plus its service's default map,
 * keyed by item, accrual winning — so a 0-default item is still asked for when
 * a sibling item accrued. Order: defaults first, then accrual-only extras.
 */
export function mergeConsumptionRows<T extends { itemId: string }>(
  accrualRows: T[],
  defaultRows: T[],
): T[] {
  const accrued = new Map(accrualRows.map((r) => [r.itemId, r]));
  const merged = defaultRows.map((d) => accrued.get(d.itemId) ?? d);
  const seen = new Set(defaultRows.map((d) => d.itemId));
  return [...merged, ...accrualRows.filter((a) => !seen.has(a.itemId))];
}

/**
 * `completionLines`, scoped to one visit member — the merged dialog's row
 * list carries every member's rows tagged with `bookingId` (one `/complete`
 * POST per member), so the split happens here, in one tested place, instead
 * of inline in the component.
 */
export function completionLinesFor(
  rows: ConsumptionRow[],
  bookingId: string,
): CompletionLine[] | null {
  return completionLines(rows.filter((r) => r.bookingId === bookingId));
}

/**
 * Merges the `/complete` responses of a multi-member visit into one result
 * for the host's `oncompleted`: the first stock warning wins (each is
 * already actionable on its own; concatenating messages would bury it), and
 * one failed `ok` fails the whole merge — same idea as `Promise.all`.
 */
export function mergeCompleteResults(a: CompleteResult | null, b: CompleteResult): CompleteResult {
  if (!a) return b;
  return {
    ok: a.ok && b.ok,
    entryId: a.entryId ?? b.entryId,
    stockWarning: a.stockWarning ?? b.stockWarning,
  };
}
