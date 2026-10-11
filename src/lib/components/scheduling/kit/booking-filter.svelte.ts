/**
 * ONE booking filter for all three views (owner: "I want the more
 * sophisticated filter from its table view to span across the different
 * views"). The table's filter state lives in the PAGE, not in `BookingTable`,
 * so it survives a view switch (table/board unmount, the page does not).
 * Columns are the table's own definitions plus the org's custom properties,
 * so the menu lists exactly what the table lists and `applyFilters` keeps
 * exactly the events the table would show. Extracted from
 * `pos/appointments` so `scheduling/calendar` shares it instead of drifting.
 */
import { applyFilters } from '$lib/components/data-table/apply-filters';
import { columnMatchOf, filterColumnMetas } from '$lib/components/data-table/filter-columns';
import { customPropertyColumns } from '$lib/components/data-table/custom-properties/columns';
import {
  isFilterActive,
  isFilterGroup,
  type FilterGroup,
  type FilterValue,
} from '$lib/components/data-table/filters';
import { customPropertyColumnKey } from '$lib/tables/custom-properties';
import { bookingBoxColumns } from '$lib/components/scheduling/booking-columns';
import { groupBookings, type BookingBox } from '$lib/components/scheduling/booking-groups';
import type { CalendarBooking } from '$lib/components/scheduling/calendar-window';
import type { createBookingCustomValues } from './booking-custom-values.svelte';

type Resources = Parameters<typeof bookingBoxColumns>[0]['resources'];
type EventTypes = Parameters<typeof bookingBoxColumns>[0]['eventTypes'];

export function createBookingFilter(opts: {
  bookings: () => CalendarBooking[];
  resources: () => Resources;
  eventTypes: () => EventTypes;
  timeZone: () => string;
  customValues: ReturnType<typeof createBookingCustomValues>;
}) {
  let filters = $state<Record<string, FilterValue>>({});
  let advanced = $state<FilterGroup | null>(null);
  /** One box per event — the table's and the board's row shape. */
  const boxes = $derived(groupBookings(opts.bookings()));
  const columns = $derived([
    ...bookingBoxColumns({
      resources: opts.resources(),
      eventTypes: opts.eventTypes(),
      timeZone: opts.timeZone(),
      rows: boxes,
    }),
    ...customPropertyColumns<BookingBox>(opts.customValues.bundle(), (box) => box.lead.id).map(
      (c) => c.column,
    ),
  ]);
  const metas = $derived(filterColumnMetas(columns, boxes));
  const activeKeys = $derived.by(() => {
    const keys = Object.entries(filters)
      .filter(([, value]) => isFilterActive(value))
      .map(([key]) => key);
    const walk = (group: FilterGroup) => {
      for (const item of group.items)
        if (isFilterGroup(item)) walk(item);
        else keys.push(item.key);
    };
    if (advanced) walk(advanced);
    return keys;
  });
  /** A custom-property filter reads values the views load per VISIBLE row, so
   *  the whole loaded window has to be fetched before it can judge them —
   *  until a record's values arrive it counts as unset (same as the table). */
  $effect(() => {
    const customKeys = new Set(
      opts.customValues.defs.map((def) => customPropertyColumnKey(def.id)),
    );
    if (activeKeys.some((key) => customKeys.has(key)))
      opts.customValues.ensure(boxes.map((box) => box.lead.id));
  });
  const keptIds = $derived.by(() => {
    if (activeKeys.length === 0) return null;
    const kept = applyFilters(boxes, filters, advanced, columnMatchOf(columns));
    return new Set(kept.flatMap((box) => box.members.map((member) => member.id)));
  });
  /** What every view renders: the filter applies to the whole EVENT, so a
   *  multi-service appointment is kept or dropped as one. */
  const shown = $derived(
    keptIds ? opts.bookings().filter((b) => keptIds.has(b.id)) : opts.bookings(),
  );

  return {
    get filters() {
      return filters;
    },
    set filters(v) {
      filters = v;
    },
    get advanced() {
      return advanced;
    },
    set advanced(v) {
      advanced = v;
    },
    get metas() {
      return metas;
    },
    get shown() {
      return shown;
    },
  };
}
