<script lang="ts">
  /**
   * The TABLE view of a calendar page: the same loaded bookings the grid shows,
   * as a `DataTable` registered on `scheduling.bookings`, so the org's custom
   * columns (the calendar's subcolumn sources) are real, editable columns here
   * — one store (`customValues`) behind both views.
   */
  import { Badge } from '$lib/components/ui';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import * as m from '$lib/paraglide/messages';
  import { formatDate, formatTime } from '$lib/utils/format';
  import type { CalendarBooking, CalendarResource } from './calendar-window';
  import { DEFAULT_STATUS_TONES } from './BookingCalendar.svelte';
  import { bookingStatusLabel } from './booking-status';
  import { BOOKINGS_TABLE, type BookingCustomValues } from './kit/booking-custom-values.svelte';

  let {
    bookings,
    resources,
    eventTypes,
    customValues,
    scopeKey,
    onopen,
  }: {
    bookings: CalendarBooking[];
    resources: CalendarResource[];
    eventTypes: Array<{ id: string; title: string }>;
    customValues: BookingCustomValues;
    /** Org-scoped cache key for the table's custom cells. */
    scopeKey: string;
    onopen: (id: string) => void;
  } = $props();

  // Every shown row needs its custom cells; the store de-duplicates.
  $effect(() => {
    customValues.ensure(bookings.map((b) => b.id));
  });

  const resourceName = (id: string) => resources.find((r) => r.id === id)?.name ?? '—';
  const eventTitle = (id: string) => eventTypes.find((e) => e.id === id)?.title ?? '—';
  const columns: DataColumn<CalendarBooking>[] = [
    {
      key: 'when',
      label: m.cal_table_col_when(),
      accessor: (b) =>
        `${formatDate(new Date(b.start), { day: 'numeric', month: 'short' })} ${formatTime(b.start)}`,
      sortFn: (a, b) => a.start.localeCompare(b.start),
    },
    { key: 'client', label: m.sched_cal_client(), accessor: (b) => b.attendeeName ?? '—' },
    { key: 'service', label: m.sched_cal_service(), accessor: (b) => eventTitle(b.eventTypeId) },
    { key: 'staff', label: m.cal_staff(), accessor: (b) => resourceName(b.resourceId) },
    {
      key: 'status',
      label: m.sched_cal_status(),
      custom: true,
      accessor: (b) => bookingStatusLabel(b.status),
      filter: {
        kind: 'enum',
        options: () =>
          [...new Set(bookings.map((b) => b.status))].map((s) => ({
            value: s,
            label: bookingStatusLabel(s),
          })),
        match: (b) => b.status,
      },
    },
  ];
</script>

<DataTable
  {columns}
  data={bookings}
  getRowId={(b) => b.id}
  tableId={BOOKINGS_TABLE}
  customProperties={{
    bundle: customValues.bundle(),
    recordId: (b) => b.id,
    scopeKey,
    onrefresh: () => customValues.refetch(Object.keys(customValues.values)),
  }}
  initialSort={{ key: 'when', dir: 'asc' }}
  searchPlaceholder={m.data_table_search()}
  searchFields={(b) =>
    `${b.attendeeName ?? ''} ${eventTitle(b.eventTypeId)} ${resourceName(b.resourceId)}`}
  onRowClick={(b) => onopen(b.id)}
  emptyMessage={m.sched_empty_bookings()}
>
  {#snippet cell(b, col)}
    {#if col.key === 'status'}
      {@const tone = DEFAULT_STATUS_TONES[b.status]}
      <Badge variant={tone ? 'semantic' : undefined} value={tone ?? undefined} size="sm"
        >{bookingStatusLabel(b.status)}</Badge
      >
    {/if}
  {/snippet}
</DataTable>
