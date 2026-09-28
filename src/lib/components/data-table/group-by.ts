/**
 * Grouping a row list along one axis — the generic core behind DataTable's
 * `groupBy` prop and behind every caller that used to bucket rows by hand.
 *
 * Lifted out of a domain module (provenance: the product-taxonomy grouping
 * shared by two sales screens) so the axis is a pair of callbacks instead of a
 * hard-coded taxonomy: `of(row)` names the bucket, `label(key, rows)` titles it,
 * `order(a, b)` ranks the keys.
 */

/** One bucket. `key` is stable across re-renders and re-sorts — never an index. */
export interface RowGroup<T> {
  key: string;
  label: string;
  rows: T[];
}

export interface GroupSpec<T> {
  /** Bucket name for a row. */
  of: (row: T) => string;
  /** Header text for a bucket. Defaults to the key itself. */
  label?: (key: string, rows: T[]) => string;
  /** Key comparator. Defaults to first-seen order (insertion). */
  order?: (a: string, b: string) => number;
  /** Start every bucket collapsed instead of open. */
  collapsed?: boolean;
}

/**
 * Buckets `rows` along the spec's axis.
 *
 * EMPTY groups cannot exist here by construction: only keys present in `rows`
 * produce a bucket, so a wide axis (17 zones against 80 rows) never renders a
 * wall of empty headers. A key the caller's `order` does not know still appears
 * — a comparator that returns 0 for it leaves it in first-seen position, so a
 * future axis value degrades to "listed with the rest" rather than "dropped".
 */
export function groupRows<T>(rows: readonly T[], spec: GroupSpec<T>): RowGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const key = spec.of(row);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }
  const out = [...buckets.entries()].map(([key, groupRowsOfKey]) => ({
    key,
    label: spec.label ? spec.label(key, groupRowsOfKey) : key,
    rows: groupRowsOfKey,
  }));
  if (spec.order) out.sort((a, b) => spec.order!(a.key, b.key));
  return out;
}

/**
 * A comparator that ranks keys by a canonical display order, with unknown keys
 * sorted after the known ones and ties broken alphabetically.
 */
export function orderByList(order: readonly string[]): (a: string, b: string) => number {
  const rank = new Map(order.map((key, index) => [key, index]));
  return (a, b) => {
    const ra = rank.get(a) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b) ?? Number.MAX_SAFE_INTEGER;
    return ra !== rb ? ra - rb : a.localeCompare(b);
  };
}

/**
 * A row as a table sees it when the CALLER builds the group tree itself and
 * feeds it through `getSubRows` (the pre-`groupBy` idiom, still supported).
 *
 * `getSubRows` walks a tree of a SINGLE row type, so group headers have to be
 * the same type as records. `__group` is what tells them apart — every caller
 * that treats a row as a real record MUST gate on `isGroupRow` first.
 */
export type TreeRow<T> = T & {
  __group?: { key: string; label: string; count: number };
  __children?: TreeRow<T>[];
};

export function isGroupRow<T>(row: TreeRow<T>): boolean {
  return row.__group != null;
}
