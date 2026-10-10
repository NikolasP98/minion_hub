/**
 * Interchangeable event colouring for the calendar (owner directive
 * 2026-09-25): two independent per-viewer choices — the event BLOCK (the box's
 * tinted background) and the SLIVER (its thick left border) — each driven by a
 * "select"-type column that already carries a persisted colour.
 *
 * Every source below is real domain colour data (`sched_event_kinds.color`,
 * `sched_resources.color`, `sched_event_types.color`, `crm_tags.color`,
 * `fin_product_categories.color`), so the resolver returns a raw CSS colour.
 * `status` is the one exception: it keeps the FIXED semantic tone ramp
 * (`STATUS_TONE` → `--color-{info,warning,success,danger}-surface`), so it
 * resolves to `null` and the caller applies the `tone-*` class instead — a
 * status level must read the same hue everywhere (governance severity ramp).
 *
 * TODO(handoff): the owner also asked for "custom select columns" to be
 * pickable here. No custom-property / select-option system exists in the schema
 * yet — the only custom storage is the untyped `crm_contacts.custom_fields`
 * jsonb, which carries no option list and no colours — so this enumerates only
 * the real coloured columns. Adding `custom` is a one-entry change to
 * `COLOR_SOURCES` plus a colour on the booking payload once the table-properties
 * work lands. See minion-meta specs/2026-09-22-hub-table-properties-spec.md.
 */
import type { CalendarBooking, CalendarResource } from './calendar-window';

export const COLOR_SOURCES = [
  'status',
  'kind',
  'staff',
  'service',
  'tags',
  'category',
  'none',
] as const;

export type ColorSource = (typeof COLOR_SOURCES)[number];

/** Block tint default = the status ramp the calendar shipped with. */
export const DEFAULT_BLOCK_SOURCE: ColorSource = 'status';
/** Sliver default = the staff colour the calendar shipped with. */
export const DEFAULT_SLIVER_SOURCE: ColorSource = 'staff';

export interface BookingColorEventType {
  id: string;
  color?: string | null;
  /** The service's default event kind — middle step of the kind fallback. */
  kindId?: string | null;
}

export interface BookingColorKind {
  id: string;
  /** Only for the colour picker's value preview — `bookingColor` never reads it. */
  name?: string | null;
  color: string;
  isDefault?: boolean;
}

export interface BookingColorCtx {
  resources: CalendarResource[];
  eventTypes: BookingColorEventType[];
  kinds: BookingColorKind[];
}

export function isColorSource(value: string | null): value is ColorSource {
  return value != null && (COLOR_SOURCES as readonly string[]).includes(value);
}

export function parseColorSource(value: string | null, fallback: ColorSource): ColorSource {
  return isColorSource(value) ? value : fallback;
}

/**
 * The colour `source` paints for one booking, or `null` when it has none: the
 * column is unset, no tag carries a colour, or the source is `status`/`none`.
 * Pure — the caller decides the fallback (tone class for the block, accent for
 * the sliver).
 */
export function bookingColor(
  source: ColorSource,
  booking: CalendarBooking,
  ctx: BookingColorCtx,
): string | null {
  switch (source) {
    case 'staff':
      return ctx.resources.find((r) => r.id === booking.resourceId)?.color ?? null;
    case 'service':
      return ctx.eventTypes.find((e) => e.id === booking.eventTypeId)?.color ?? null;
    case 'kind': {
      const id = kindIdOf(booking, ctx);
      return (id ? ctx.kinds.find((k) => k.id === id)?.color : null) ?? null;
    }
    case 'tags':
      // Server order is own → client → service; first tag with a colour wins,
      // exactly like `resolveEventColor` on the scheduling calendar.
      return booking.tags?.find((t) => t.color)?.color ?? null;
    case 'category':
      // `fin_products.category` is plain text; its colour is org-owned data on
      // `fin_product_categories` and is resolved in the page load.
      return booking.categoryColor ?? null;
    case 'status':
    case 'none':
      return null;
  }
}

/** Same chain as the scheduling calendar's `kindOf`: the booking's own kind,
 *  then its service's default, then the org's default kind. */
function kindIdOf(booking: CalendarBooking, ctx: BookingColorCtx): string | null {
  return (
    booking.kindId ??
    ctx.eventTypes.find((e) => e.id === booking.eventTypeId)?.kindId ??
    ctx.kinds.find((k) => k.isDefault)?.id ??
    ctx.kinds[0]?.id ??
    null
  );
}

/** Sources a day column can be SUBDIVIDED by (owner ask 2026-10-02: "custom
 *  subcolumns to classify events"). `category` groups on the category NAME the
 *  window payload carries since HC-020 (`CalendarBooking.category`). */
export const SUBCOLUMN_SOURCES: readonly ColorSource[] = [
  'none',
  'status',
  'kind',
  'staff',
  'service',
  'tags',
  'category',
];

/**
 * The VALUE of `source` on one booking — the id a subcolumn groups by — or
 * `null` when the booking has none (it lands in the trailing "unclassified"
 * subcolumn). Same resolution as `bookingColor`, minus the colour.
 */
export function bookingFacet(
  source: ColorSource,
  booking: CalendarBooking,
  ctx: BookingColorCtx,
): string | null {
  switch (source) {
    case 'status':
      return booking.status;
    case 'staff':
      return booking.resourceId || null;
    case 'service':
      return booking.eventTypeId || null;
    case 'kind':
      return kindIdOf(booking, ctx);
    case 'tags':
      // The lowest tag id, independent of the server's origin order — a
      // multi-tag booking belongs to EVERY tag lane (`bookingFacets`); this is
      // only the single-valued view of it.
      return bookingFacets('tags', booking, ctx)[0];
    case 'category':
      return booking.category ?? null;
    case 'none':
      return null;
  }
}

/**
 * EVERY lane `source` files one booking under (HC-017): all of its tag ids
 * for `tags` (deduped across origins, sorted by id so the two server orders
 * own→contact and contact→own yield the same list), a one-element array for
 * every single-valued source. `[null]` = unclassified.
 */
export function bookingFacets(
  source: ColorSource,
  booking: CalendarBooking,
  ctx: BookingColorCtx,
): (string | null)[] {
  if (source !== 'tags') return [bookingFacet(source, booking, ctx)];
  const ids = [...new Set((booking.tags ?? []).map((t) => t.id))].sort();
  return ids.length ? ids : [null];
}
