/**
 * Grouping the catalog along one taxonomy axis — shared by the /pos/sell nested
 * table and the /pos/catalog board so both always agree on bucket membership,
 * bucket order, and what "unclassified" means.
 */

import {
  CATEGORY_ORDER,
  LINE_LABELS,
  LINE_ORDER,
  ZONE_LABELS,
  ZONE_ORDER,
  type CategoryName,
  type Taxonomy,
} from './taxonomy';

export type GroupAxis = 'none' | 'zone' | 'line' | 'category';

/** Minimal shape this module needs — keeps it usable from both pages' row types. */
export interface Groupable {
  taxonomy: Taxonomy;
}

export interface Group<T> {
  /** Stable across re-renders and re-sorts: the slug, never the index. */
  key: string;
  label: string;
  rows: T[];
}

function axisOf<T extends Groupable>(
  axis: Exclude<GroupAxis, 'none'>,
): { order: readonly string[]; label: (k: string) => string; of: (r: T) => string } {
  switch (axis) {
    case 'zone':
      return {
        order: ZONE_ORDER,
        label: (k) => ZONE_LABELS[k as keyof typeof ZONE_LABELS] ?? k,
        of: (r) => r.taxonomy.zone,
      };
    case 'line':
      return {
        order: LINE_ORDER,
        label: (k) => LINE_LABELS[k as keyof typeof LINE_LABELS] ?? k,
        of: (r) => r.taxonomy.line,
      };
    case 'category':
      return {
        order: CATEGORY_ORDER,
        label: (k) => k,
        of: (r) => r.taxonomy.category as CategoryName,
      };
  }
}

/**
 * Buckets `rows` along `axis`, in the axis's canonical display order.
 *
 * EMPTY groups are dropped. With 17 zones and 20 lines against ~80 products,
 * keeping them would render a wall of empty columns on the board and a wall of
 * empty accordion rows in the table — the display order exists to rank the
 * buckets that DO exist, not to reserve a slot for every possible value.
 *
 * Any value not in the canonical order still appears, sorted after the known
 * ones, so a future taxonomy addition degrades to "listed last" rather than
 * "silently dropped from the UI".
 */
export function groupBy<T extends Groupable>(rows: T[], axis: GroupAxis): Group<T>[] {
  if (axis === 'none') return [{ key: 'all', label: '', rows }];
  const { order, label, of } = axisOf<T>(axis);

  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const k = of(row);
    const bucket = buckets.get(k);
    if (bucket) bucket.push(row);
    else buckets.set(k, [row]);
  }

  const rank = new Map(order.map((k, i) => [k, i]));
  return [...buckets.entries()]
    .sort(([a], [b]) => {
      const ra = rank.get(a) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b) ?? Number.MAX_SAFE_INTEGER;
      return ra !== rb ? ra - rb : a.localeCompare(b);
    })
    .map(([key, groupRows]) => ({ key, label: label(key), rows: groupRows }));
}

/**
 * A catalog row as the shared `DataTable` sees it when grouping is on.
 *
 * `DataTable.getSubRows` walks a tree of a SINGLE row type, so group headers
 * have to be the same type as products. `__group` is what tells them apart —
 * every consumer that treats a row as sellable (adding to a cart, pricing it,
 * issuing stock for it) MUST gate on `isGroupRow` first. Without that gate a
 * click on "Labios" adds a fictional product to the ticket.
 */
export type TreeRow<T> = T & {
  __group?: { key: string; label: string; count: number };
  __children?: TreeRow<T>[];
};

export function isGroupRow<T>(row: TreeRow<T>): boolean {
  return row.__group != null;
}

/**
 * Flat list → one synthetic parent per group, products as its children.
 *
 * The synthetic row carries the group's identity in `__group` and blanks the
 * money/stock fields it has no meaning for, so a header can never render a
 * price or be mistaken for a sellable by a cell renderer.
 */
export function toTreeRows<T extends Groupable & { productId: string }>(
  rows: T[],
  axis: GroupAxis,
): TreeRow<T>[] {
  if (axis === 'none') return rows as TreeRow<T>[];
  return groupBy(rows, axis).map(
    (g) =>
      ({
        ...g.rows[0],
        // Prefixed so a group can never collide with a real product id in
        // DataTable's expanded/selected id sets.
        productId: `__group:${axis}:${g.key}`,
        name: g.label,
        code: '',
        unitPrice: null,
        stockQty: null,
        itemId: null,
        // Blanked here rather than special-cased per renderer: `category` is a
        // plain accessor column in the POS table (no custom cell snippet), so
        // leaving the spread value would print the first child's category on the
        // header row. Blank the synthetic row once and every renderer is correct.
        category: null,
        __group: { key: g.key, label: g.label, count: g.rows.length },
        __children: g.rows as TreeRow<T>[],
      }) as TreeRow<T>,
  );
}
