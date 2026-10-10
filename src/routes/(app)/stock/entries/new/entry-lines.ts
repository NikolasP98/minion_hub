import { expandLine, type EntryType } from '$lib/stock/entry-legs';
import type { UomConvertible } from '$lib/components/stock/stock-ui';

/** One row of a stock entry draft (`/stock/entries/new`). */
export type EntryLine = {
  itemId: string;
  qty: string;
  rate: string;
  fromWarehouseId: string;
  toWarehouseId: string;
};

/**
 * Adds a picked item to the line list without ever creating a second line
 * for the same item — picking a line that's already there increments its
 * qty instead of duplicating it.
 *
 * Exception: if the item already has two-or-more lines that each have a
 * warehouse side set, and those sides are all distinct (a deliberate
 * transfer/adjustment split across warehouses), leave them alone and add a
 * new line rather than guessing which one to fold the pick into.
 *
 * `makeLine` builds the line to use when nothing merges (new item, or the
 * split-warehouse exception) — callers own the defaulting logic for a brand
 * new line's warehouse/rate fields.
 */
export function mergePickedLine(
  lines: EntryLine[],
  itemId: string,
  makeLine: () => EntryLine,
  pickedQty = 1,
): { lines: EntryLine[]; mergedIndex: number | null } {
  const matchIndexes = lines.reduce<number[]>((acc, l, i) => {
    if (l.itemId === itemId) acc.push(i);
    return acc;
  }, []);

  const warehouseKey = (l: EntryLine) => `${l.fromWarehouseId}|${l.toWarehouseId}`;
  const isDeliberateSplit =
    matchIndexes.length >= 2 &&
    matchIndexes.every((i) => lines[i].fromWarehouseId || lines[i].toWarehouseId) &&
    new Set(matchIndexes.map((i) => warehouseKey(lines[i]))).size === matchIndexes.length;

  if (matchIndexes.length === 0 || isDeliberateSplit) {
    return { lines: [...lines, makeLine()], mergedIndex: null };
  }

  const idx = matchIndexes[0];
  const next = lines.slice();
  next[idx] = { ...next[idx], qty: String(Number(next[idx].qty || 0) + pickedQty) };
  return { lines: next, mergedIndex: idx };
}

/** How the rate column is typed: per unit (what the server stores) or as
 *  the whole line's amount (what a supplier invoice usually shows). */
export type RateMode = 'unit' | 'total';

/** The per-unit rate the server expects, from what was typed in `mode`. */
export function unitRate(typed: string, qty: string, mode: RateMode): number | null {
  if (typed === '') return null;
  const value = Number(typed);
  if (mode === 'unit') return value;
  const q = Number(qty);
  return q > 0 ? Math.round((value / q) * 10_000) / 10_000 : value;
}

/** Re-express every typed rate when the mode flips, so nothing silently
 *  changes meaning: unit→total multiplies by qty, total→unit divides. */
export function convertRates(lines: EntryLine[], from: RateMode, to: RateMode): EntryLine[] {
  if (from === to) return lines;
  return lines.map((l) => {
    if (l.rate === '') return l;
    const q = Number(l.qty);
    if (!(q > 0)) return l;
    const v = Number(l.rate);
    const next = to === 'total' ? v * q : v / q;
    return { ...l, rate: String(Math.round(next * 10_000) / 10_000) };
  });
}

// ── Stock-change preview (owner ask 2026-10-10) ──────────────────────────────

/** On-hand per bin, keyed `itemId:warehouseId` — the loader's `bins` payload. */
export type OnHandByBin = Map<string, number>;

export function binKey(itemId: string, warehouseId: string): string {
  return `${itemId}:${warehouseId}`;
}

export type StockPreviewLeg = {
  warehouseId: string;
  before: number;
  after: number;
  /** Signed, so a transfer's two legs read -qty / +qty. */
  delta: number;
};

export type StockPreview = {
  /** The item's STOCK unit — what the ledger counts and what qty is typed in. */
  uom: string;
  legs: StockPreviewLeg[];
  /**
   * The same movement expressed in the unit services consume the item in,
   * when the item declares a different one (e.g. 3 caja ≈ 1500 ml). Null when
   * the item is bought and consumed in the same unit, or has no factor set.
   */
  equivalent: { qty: number; uom: string } | null;
};

/**
 * What this line will do to the on-hand balance, per warehouse it touches.
 * Signs and warehouses come from `expandLine` — the SAME expansion
 * stock.service.ts posts with, so the preview can't drift from the ledger.
 *
 * Returns null when there is nothing to preview yet: no entry type, the item
 * isn't in the loaded catalog, a non-positive qty, or no warehouse picked.
 * A (item, warehouse) pair with no bin row is a true zero — `stk_bins` is a
 * complete, rebuildable cache of `stk_ledger`, so absence is 0 on hand, not
 * an unknown.
 */
export function previewStockChange(
  type: EntryType | null,
  line: EntryLine,
  item: UomConvertible | undefined,
  onHand: OnHandByBin,
): StockPreview | null {
  const qty = Number(line.qty);
  if (!type || !item || !(qty > 0)) return null;
  const legs = expandLine(type, {
    qty,
    rate: null,
    fromWarehouseId: line.fromWarehouseId || null,
    toWarehouseId: line.toWarehouseId || null,
  })
    .filter((leg) => leg.warehouseId !== '')
    .map((leg) => {
      const before = onHand.get(binKey(line.itemId, leg.warehouseId)) ?? 0;
      return {
        warehouseId: leg.warehouseId,
        before,
        after: before + leg.qtyDelta,
        delta: leg.qtyDelta,
      };
    });
  if (legs.length === 0) return null;
  const perStockUom = Number(item.unitsPerStockUom);
  const consumptionUom = item.consumptionUom;
  return {
    uom: item.uom,
    legs,
    equivalent:
      consumptionUom && consumptionUom !== item.uom && perStockUom > 0
        ? { qty: qty * perStockUom, uom: consumptionUom }
        : null,
  };
}

// ── Provider autofill (owner ask 2026-10-10) ─────────────────────────────────

/**
 * The supplier to drop into the "Contraparte" picker, or null for "don't
 * touch it". Runs exactly ONCE per page — the caller flips
 * `providerAutofilled` the first time an item lands in the lines (whatever
 * the outcome) and the first time the user picks a party themselves, so a
 * later pick, or a deliberate clear, is never overwritten.
 *
 * Only receipts: an issue or a transfer has no provider, and a transfer has
 * no counterparty at all.
 */
export function autofillPartyId(state: {
  type: EntryType | null;
  partyId: string | null;
  providerAutofilled: boolean;
  itemSupplierPartyId: string | null | undefined;
}): string | null {
  if (state.type !== 'receipt') return null;
  if (state.providerAutofilled) return null;
  if (state.partyId) return null;
  return state.itemSupplierPartyId ?? null;
}
