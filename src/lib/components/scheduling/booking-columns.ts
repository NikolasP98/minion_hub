/**
 * The column definitions of the bookings table (`scheduling.bookings`), shared
 * by `BookingTable` and by a page that filters its OTHER views (the
 * appointments calendar and board) through the same `filters` object: the
 * filter menu, the chips and `applyFilters` all resolve keys, kinds, options
 * and match functions from this one list, so a filter can never select
 * different events in the table than it does in the calendar.
 */
import type { DataColumn } from '$lib/components/data-table/DataTable.svelte';
import * as m from '$lib/paraglide/messages';
import { formatDate, formatTime } from '$lib/utils/format';
import type { CalendarResource } from './calendar-window';
import type { BookingBox } from './booking-groups';
import { servicesTitle } from './visit';
import { BOOKING_STATUSES, bookingStatusLabel } from './booking-status';

export interface BookingColumnOpts {
  resources: readonly CalendarResource[];
  eventTypes: readonly { id: string; title: string }[];
  timeZone: string;
  /** The rows the enum filters list values from (the loaded events). */
  rows: readonly BookingBox[];
  /** Inline cell editing — only where the host passed the matching write. */
  editableStatus?: boolean;
  editableStaff?: boolean;
}

export function bookingBoxColumns(opts: BookingColumnOpts): DataColumn<BookingBox>[] {
  const { resources, eventTypes, timeZone, rows } = opts;
  const eventTitle = (id: string) => eventTypes.find((e) => e.id === id)?.title ?? '—';
  return [
    {
      key: 'when',
      label: m.cal_table_col_when(),
      accessor: (box) =>
        `${formatDate(new Date(box.start), { day: 'numeric', month: 'short', timeZone })} ${formatTime(box.start, timeZone)}`,
      sortFn: (a, b) => a.start.localeCompare(b.start),
    },
    { key: 'client', label: m.sched_cal_client(), accessor: (box) => box.lead.attendeeName ?? '—' },
    {
      key: 'service',
      label: m.sched_cal_service(),
      // Custom-rendered so a multi-service event can caption its service count
      // under the joined titles; the accessor stays the joined titles, which is
      // what sort, search and filter read.
      custom: true,
      accessor: (box) => servicesTitle(box.members, eventTitle),
    },
    {
      key: 'staff',
      label: m.cal_staff(),
      // The accessor is the select VALUE (what the editor draft carries); the
      // table renders the option label.
      accessor: (box) => box.lead.resourceId,
      editable: opts.editableStaff,
      type: 'select',
      options: () => resources.map((r) => ({ value: r.id, label: r.name })),
    },
    {
      key: 'status',
      label: m.sched_cal_status(),
      // Custom-rendered (semantic badge) AND editable — the catalog's price /
      // kind columns do the same: the table's select editor opens over the
      // custom cell on click-again / Enter (owner: "fixed in the catalog page,
      // it should be fixed across the board").
      custom: true,
      accessor: (box) => box.statusLead.status,
      editable: opts.editableStatus,
      type: 'select',
      options: () => BOOKING_STATUSES.map((st) => ({ value: st, label: bookingStatusLabel(st) })),
      filter: {
        kind: 'enum',
        options: () =>
          [...new Set(rows.map((box) => box.statusLead.status))].map((s) => ({
            value: s,
            label: bookingStatusLabel(s),
          })),
        match: (box) => box.statusLead.status,
      },
    },
  ];
}
