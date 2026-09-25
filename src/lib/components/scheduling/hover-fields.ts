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

/** Fixed field tree, in DEFAULT order. The time range is the card's anchor and
 *  is deliberately absent — it is never toggleable.
 *
 *  `status` is a head-slot field: it renders next to the time range, so its
 *  position in `order` is ignored and its menu row carries no drag handle.
 *
 *  A node's `children` are SUB-ITEMS of one block (owner ask 2026-09-25: "I'd
 *  like them to move as a single block, and would like to configure what
 *  subitems to include"): the client's phone is a caption line under the name,
 *  not a row of its own. Sub-items are toggleable but never orderable — they
 *  move with, and are hidden with, their parent — so they appear only in
 *  `hidden`, never in `order`. `phone` was a top-level field until then; a
 *  stored `order` containing it is migrated by `mergeFields` simply dropping it
 *  (unknown at top level) while its `hidden` entry, if any, survives.
 *
 *  TODO(handoff): `client` has exactly ONE sub-item today because the POS
 *  calendar payload carries no other client-level DISPLAY data — `partyId` /
 *  `crmContactId` are opaque ids and `attendeeEmail` (plus the contact's
 *  document number) is read by `listBookings` but never projected in
 *  `/pos/appointments/+page.server.ts`. The owner's ask ("configure what
 *  subitems to include") is therefore only half met: the mechanism is generic,
 *  the vocabulary is one key. Adding email/document = project the fields in that
 *  load (mind `maskAttendeePii`, which masks email server-side) + one tree entry
 *  + one label. Ledger: meta-repo
 *  `proposals/2026-09-25-hub-pos-calendar-color-followups.md`. */
export const HOVER_FIELD_TREE = [
  { key: 'status' },
  { key: 'title' },
  { key: 'staff' },
  { key: 'client', children: ['phone'] },
  { key: 'tags' },
  { key: 'notes' },
  { key: 'chips' },
  { key: 'actions' },
] as const;

export type HoverField = (typeof HOVER_FIELD_TREE)[number]['key'];

export type HoverSubField = Extract<
  (typeof HOVER_FIELD_TREE)[number],
  { children: readonly string[] }
>['children'][number];

/** Widened view of the tree — the literal tuple's leaf nodes carry no `children`
 *  property at all, so reading it off the union needs the optional-property
 *  shape (one cast, at the single place that walks the tree). */
const TREE: readonly { key: HoverField; children?: readonly HoverSubField[] }[] = HOVER_FIELD_TREE;

/** Top-level orderable keys, in DEFAULT order. */
export const HOVER_FIELDS: readonly HoverField[] = TREE.map((n) => n.key);

/** Sub-items of one top-level field, in render order (empty for a leaf). */
export const hoverChildren = (key: string): readonly HoverSubField[] =>
  TREE.find((n) => n.key === key)?.children ?? [];

/** Every sub-item key — the extra vocabulary `hidden` may legitimately hold. */
export const HOVER_SUB_FIELDS: readonly HoverSubField[] = TREE.flatMap((n) => n.children ?? []);

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
export function mergeFields<K extends string, S extends string = never>(
  stored: Partial<FieldPrefs> | null | undefined,
  all: readonly K[],
  /** Sub-item keys: legal in `hidden`, never in `order`. */
  subKeys: readonly S[] = [],
): { hidden: Set<K | S>; order: K[] } {
  const known: ReadonlySet<string> = new Set(all);
  const toggleable: ReadonlySet<string> = new Set<string>([...all, ...subKeys]);
  const kept: K[] = [];
  for (const k of stored?.order ?? [])
    if (known.has(k) && !kept.includes(k as K)) kept.push(k as K);
  return {
    hidden: new Set((stored?.hidden ?? []).filter((k): k is K | S => toggleable.has(k))),
    order: [...kept, ...all.filter((k) => !kept.includes(k))],
  };
}

/** The rows to render, in order. `hidden` is keyed loosely because it also holds
 *  sub-item keys, which never appear in `order`. */
export const visibleFields = <K extends string>(order: K[], hidden: ReadonlySet<string>): K[] =>
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
  mergeFields(stored, HOVER_FIELDS, HOVER_SUB_FIELDS);

export const visibleHoverFields = (order: HoverField[], hidden: ReadonlySet<string>) =>
  visibleFields(order, hidden);

export const moveHoverField = (order: HoverField[], key: string, target: string) =>
  moveField(order, key, target);
