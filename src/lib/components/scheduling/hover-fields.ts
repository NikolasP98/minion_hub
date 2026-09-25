/**
 * Which lines the calendar's two event surfaces show, and in which order — the
 * hover CARD and the grid BLOCK — with the same enable/disable + drag-reorder
 * contract a `DataTable` column layout has, so a viewer who must not see the
 * appointment's stock cost can drop that row, and one who needs the customer
 * name on a 15-minute block can promote it and hide the time.
 *
 * Pure on purpose: the merge rule is the only logic worth a test, and the
 * components just render `order` minus `hidden`. The three helpers are generic
 * over the key union so both field lists share them; `*HoverField*` stay as
 * named wrappers because the card's call sites and tests predate the block.
 */

/** Fixed field list, in DEFAULT order. The time range is the card's anchor and
 *  is deliberately absent — it is never toggleable.
 *
 *  `status` is a head-slot field: it renders next to the time range, so its
 *  position in `order` is ignored and its menu row carries no drag handle. */
export const HOVER_FIELDS = [
  'status',
  'title',
  'staff',
  'client',
  'phone',
  'tags',
  'chips',
  'actions',
] as const;

export type HoverField = (typeof HOVER_FIELDS)[number];

/** Lines an event BLOCK (the grid chip) shows, in DEFAULT order — which is
 *  today's shipped rendering exactly, so a viewer who never opens the menu sees
 *  no change.
 *
 *  `tags` is a corner-slot field: the marks are absolutely positioned in the
 *  block's top-right corner (a 30-minute block has no room for an in-flow row),
 *  so its position in `order` is ignored and its menu row carries no drag
 *  handle. There is deliberately NO `status` field — the chip carries no status
 *  glyph or badge, only the status TONE of its background. */
export const BLOCK_FIELDS = ['time', 'service', 'client', 'tags'] as const;

export type BlockField = (typeof BLOCK_FIELDS)[number];

/** Shape persisted in localStorage (per viewer, POS calendar only). */
export type FieldPrefs = { hidden: string[]; order: string[] };
export type HoverFieldPrefs = FieldPrefs;

export const HOVER_FIELDS_KEY = 'hub-pos-calendar-hover-fields';
export const BLOCK_FIELDS_KEY = 'hub-pos-calendar-block-fields';

/**
 * Stored prefs → renderable layout. Same merge rule as `DataTable`'s column
 * layout: keys the build no longer has are dropped, keys it gained since the
 * prefs were written are appended in default order (so a new field is visible
 * by default rather than silently missing), duplicates collapse.
 */
export function mergeFields<K extends string>(
  stored: Partial<FieldPrefs> | null | undefined,
  all: readonly K[],
): { hidden: Set<K>; order: K[] } {
  const known: ReadonlySet<string> = new Set(all);
  const kept: K[] = [];
  for (const k of stored?.order ?? [])
    if (known.has(k) && !kept.includes(k as K)) kept.push(k as K);
  return {
    hidden: new Set((stored?.hidden ?? []).filter((k): k is K => known.has(k))),
    order: [...kept, ...all.filter((k) => !kept.includes(k))],
  };
}

/** The rows to render, in order. */
export const visibleFields = <K extends string>(order: K[], hidden: ReadonlySet<K>): K[] =>
  order.filter((k) => !hidden.has(k));

/** Drag-reorder: drop `key` onto `target`'s slot (down = after, up = before —
 *  the semantics `DataTable`'s menu drop has). */
export function moveField<K extends string>(order: K[], key: string, target: string): K[] {
  const from = order.indexOf(key as K);
  const to = order.indexOf(target as K);
  if (from < 0 || to < 0 || from === to) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, order[from]);
  return next;
}

export const mergeHoverFields = (stored: Partial<FieldPrefs> | null | undefined) =>
  mergeFields(stored, HOVER_FIELDS);

export const visibleHoverFields = (order: HoverField[], hidden: ReadonlySet<HoverField>) =>
  visibleFields(order, hidden);

export const moveHoverField = (order: HoverField[], key: string, target: string) =>
  moveField(order, key, target);
