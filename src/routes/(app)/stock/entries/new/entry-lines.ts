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
