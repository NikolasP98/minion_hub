<script lang="ts">
  /**
   * The TABLE view of a calendar page: the same loaded bookings the grid shows,
   * as a `DataTable` registered on `scheduling.bookings`, so the org's custom
   * columns (the calendar's subcolumn sources) are real, editable columns here
   * — one store (`customValues`) behind both views.
   */
  import { PanelRightOpen } from 'lucide-svelte';
  import { Badge, Button, iconSizes } from '$lib/components/ui';
  import DataTable, {
    type DataColumn,
    type EditDraft,
  } from '$lib/components/data-table/DataTable.svelte';
  import type { RowSaveResult } from '$lib/components/data-table/row-save';
  import * as m from '$lib/paraglide/messages';
  import { formatDate, formatTime } from '$lib/utils/format';
  import { DEFAULT_STATUS_TONES } from './BookingCalendar.svelte';
  import type { CalendarBooking, CalendarResource } from './calendar-window';
  import { BOOKING_STATUSES, bookingStatusLabel } from './booking-status';
  import { BOOKINGS_TABLE, type BookingCustomValues } from './kit/booking-custom-values.svelte';

  let {
    bookings,
    resources,
    eventTypes,
    customValues,
    scopeKey,
    onopen,
    canEdit = false,
    onstatus,
    onstaff,
  }: {
    bookings: CalendarBooking[];
    resources: CalendarResource[];
    eventTypes: Array<{ id: string; title: string }>;
    customValues: BookingCustomValues;
    /** Org-scoped cache key for the table's custom cells. */
    scopeKey: string;
    onopen: (id: string) => void;
    /** Inline cell editing (owner ask 2026-10-02 "enable cell control"): the
     *  Status and Staff cells edit in place through the same writes the board
     *  uses; custom columns edit through the shared store already. */
    canEdit?: boolean;
    onstatus?: (id: string, status: string) => Promise<void> | void;
    onstaff?: (
      id: string,
      next: { start: string; end: string; resourceId: string },
    ) => Promise<unknown> | void;
  } = $props();

  /** One commit per cell: the draft carries every editable column, so only
   *  the changed one is written. */
  async function saveRow(b: CalendarBooking, draft: EditDraft): Promise<RowSaveResult> {
    if (draft.status !== undefined && draft.status !== b.status)
      await onstatus?.(b.id, draft.status);
    if (draft.staff !== undefined && draft.staff !== b.resourceId && draft.staff)
      await onstaff?.(b.id, { start: b.start, end: b.end, resourceId: draft.staff });
    return true;
  }

  // Every shown row needs its custom cells; the store de-duplicates.
  $effect(() => {
    customValues.ensure(bookings.map((b) => b.id));
  });

  const resourceName = (id: string) => resources.find((r) => r.id === id)?.name ?? '—';
  const eventTitle = (id: string) => eventTypes.find((e) => e.id === id)?.title ?? '—';
  const columns = $derived<DataColumn<CalendarBooking>[]>([
    {
      key: 'when',
      label: m.cal_table_col_when(),
      accessor: (b) =>
        `${formatDate(new Date(b.start), { day: 'numeric', month: 'short' })} ${formatTime(b.start)}`,
      sortFn: (a, b) => a.start.localeCompare(b.start),
    },
    { key: 'client', label: m.sched_cal_client(), accessor: (b) => b.attendeeName ?? '—' },
    { key: 'service', label: m.sched_cal_service(), accessor: (b) => eventTitle(b.eventTypeId) },
    {
      key: 'staff',
      label: m.cal_staff(),
      // The accessor is the select VALUE (what the editor draft carries); the
      // table renders the option label.
      accessor: (b) => b.resourceId,
      editable: onstaff !== undefined,
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
      accessor: (b) => b.status,
      editable: onstatus !== undefined,
      type: 'select',
      options: () => BOOKING_STATUSES.map((st) => ({ value: st, label: bookingStatusLabel(st) })),
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
  ]);
</script>

<!-- Opening the drawer is a row ACTION, not the row click: a row click would
     swallow the click that selects a cell, and the drawer's dialog then sits
     over the double-click that opens the editor. -->
{#snippet openAction(b: CalendarBooking)}
  <Button
    variant="ghost"
    size="xs"
    shape="icon"
    aria-label={m.cal_table_open()}
    title={m.cal_table_open()}
    onclick={() => onopen(b.id)}
  >
    <PanelRightOpen size={iconSizes.sm} />
  </Button>
{/snippet}

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
  rowActions={openAction}
  {canEdit}
  onSaveRow={saveRow}
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
