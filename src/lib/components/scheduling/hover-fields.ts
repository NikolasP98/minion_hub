/**
 * Which rows the calendar hover card shows, and in which order — the same
 * enable/disable + drag-reorder contract a `DataTable` column layout has, so a
 * viewer who must not see the appointment's stock cost can drop that row.
 *
 * Pure on purpose: the merge rule is the only logic worth a test, and the
 * component just renders `order` minus `hidden`.
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

/** Shape persisted in localStorage (per viewer, POS calendar only). */
export type HoverFieldPrefs = { hidden: string[]; order: string[] };

export const HOVER_FIELDS_KEY = 'hub-pos-calendar-hover-fields';

const KNOWN: ReadonlySet<string> = new Set(HOVER_FIELDS);

/**
 * Stored prefs → renderable layout. Same merge rule as `DataTable`'s column
 * layout: keys the build no longer has are dropped, keys it gained since the
 * prefs were written are appended in default order (so a new field is visible
 * by default rather than silently missing), duplicates collapse.
 */
export function mergeHoverFields(stored: Partial<HoverFieldPrefs> | null | undefined): {
  hidden: Set<HoverField>;
  order: HoverField[];
} {
  const kept: HoverField[] = [];
  for (const k of stored?.order ?? [])
    if (KNOWN.has(k) && !kept.includes(k as HoverField)) kept.push(k as HoverField);
  return {
    hidden: new Set((stored?.hidden ?? []).filter((k): k is HoverField => KNOWN.has(k))),
    order: [...kept, ...HOVER_FIELDS.filter((k) => !kept.includes(k))],
  };
}

/** The body rows to render, in order. */
export const visibleHoverFields = (
  order: HoverField[],
  hidden: ReadonlySet<HoverField>,
): HoverField[] => order.filter((k) => !hidden.has(k));

/** Drag-reorder: drop `key` onto `target`'s slot (down = after, up = before —
 *  the semantics `DataTable`'s menu drop has). */
export function moveHoverField(order: HoverField[], key: string, target: string): HoverField[] {
  const from = order.indexOf(key as HoverField);
  const to = order.indexOf(target as HoverField);
  if (from < 0 || to < 0 || from === to) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, order[from]);
  return next;
}
