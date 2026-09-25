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
 * is dropped rather than rejected; when nothing positive is left the result is
 * `null`, which the endpoint reads as "realize the open accruals as-is".
 */
export function completionLines(rows: ConsumptionRow[]): CompletionLine[] | null {
  const lines = rows
    .filter((r) => r.actual > 0)
    .map((r) => ({
      itemId: r.itemId,
      qty: stockQty(r.unitsPerStockUom, r.actual),
      qtyConsumption: r.actual,
    }));
  return lines.length ? lines : null;
}
