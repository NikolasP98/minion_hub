<script lang="ts">
  /**
   * The TABLE view of a calendar page: the same loaded bookings the grid shows,
   * as a `DataTable` registered on `scheduling.bookings`, so the org's custom
   * columns (the calendar's subcolumn sources) are real, editable columns here
   * — one store (`customValues`) behind both views.
   *
   * One row = one EVENT, not one service: the rows sharing a `groupId` collapse
   * into a single `BookingBox` via `groupBookings`, as the grid draws them
   * (owner ask 2026-10-08). Every cell reads the box — the whole span, the
   * lead's client/chair/custom values, the `statusLead`'s status — and an
   * inline edit on a multi-service event writes the WHOLE event.
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
  import { groupBookings, type BookingBox } from './booking-groups';
  import { servicesTitle } from './visit';
  import type { MoveOpts } from './move-conflict';
  import { BOOKING_STATUSES, bookingStatusLabel } from './booking-status';
  import { BOOKINGS_TABLE, type BookingCustomValues } from './kit/booking-custom-values.svelte';

  let {
    bookings,
    resources,
    eventTypes,
    timeZone,
    customValues,
    scopeKey,
    onopen,
    canEdit = false,
    onstatus,
    onvisitstatus,
    onstaff,
  }: {
    bookings: CalendarBooking[];
    resources: CalendarResource[];
    eventTypes: Array<{ id: string; title: string }>;
    timeZone: string;
    customValues: BookingCustomValues;
    /** Org-scoped cache key for the table's custom cells. */
    scopeKey: string;
    onopen: (id: string) => void;
    /** Inline cell editing (owner ask 2026-10-02 "enable cell control"): the
     *  Status and Staff cells edit in place through the same writes the board
     *  uses; custom columns edit through the shared store already. */
    canEdit?: boolean;
    onstatus?: (id: string, status: string) => Promise<void> | void;
    /** The Status cell of a MULTI-service event: the whole event in one call. */
    onvisitstatus?: (id: string, status: string) => Promise<void> | void;
    onstaff?: (
      id: string,
      next: { start: string; end: string; resourceId: string },
      opts?: MoveOpts,
    ) => Promise<unknown> | void;
  } = $props();

  /** One box per event, so a 3-service appointment is ONE row. */
  const boxes = $derived(groupBookings(bookings));

  /** One commit per cell: the draft carries every editable column, so only
   *  the changed one is written. A multi-service event writes through the
   *  visit-wide verbs; a single-service one keeps the per-row PATCHes. */
  async function saveRow(box: BookingBox, draft: EditDraft): Promise<RowSaveResult> {
    const visit = box.members.length > 1;
    const id = box.lead.id;
    if (draft.status !== undefined && draft.status !== box.statusLead.status) {
      if (visit) await onvisitstatus?.(id, draft.status);
      else await onstatus?.(id, draft.status);
    }
    if (draft.staff !== undefined && draft.staff !== box.lead.resourceId && draft.staff)
      await onstaff?.(
        id,
        { start: box.start, end: box.end, resourceId: draft.staff },
        visit ? { group: true } : undefined,
      );
    return true;
  }

  // Every shown row needs its custom cells, keyed by the event's LEAD row (the
  // event holds one value, not one per service); the store de-duplicates.
  $effect(() => {
    customValues.ensure(boxes.map((box) => box.lead.id));
  });

  const resourceName = (id: string) => resources.find((r) => r.id === id)?.name ?? '—';
  const eventTitle = (id: string) => eventTypes.find((e) => e.id === id)?.title ?? '—';
  const columns = $derived<DataColumn<BookingBox>[]>([
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
      accessor: (box) => box.statusLead.status,
      editable: onstatus !== undefined,
      type: 'select',
      options: () => BOOKING_STATUSES.map((st) => ({ value: st, label: bookingStatusLabel(st) })),
      filter: {
        kind: 'enum',
        options: () =>
          [...new Set(boxes.map((box) => box.statusLead.status))].map((s) => ({
            value: s,
            label: bookingStatusLabel(s),
          })),
        match: (box) => box.statusLead.status,
      },
    },
  ]);
</script>

<!-- Opening the drawer is a row ACTION, not the row click: a row click would
     swallow the click that selects a cell, and the drawer's dialog then sits
     over the double-click that opens the editor. -->
{#snippet openAction(box: BookingBox)}
  <Button
    variant="ghost"
    size="xs"
    shape="icon"
    aria-label={m.cal_table_open()}
    title={m.cal_table_open()}
    onclick={() => onopen(box.lead.id)}
  >
    <PanelRightOpen size={iconSizes.sm} />
  </Button>
{/snippet}

<DataTable
  {columns}
  data={boxes}
  getRowId={(box) => box.key}
  tableId={BOOKINGS_TABLE}
  customProperties={{
    bundle: customValues.bundle(),
    recordId: (box) => box.lead.id,
    scopeKey,
    onrefresh: () => customValues.refetch(Object.keys(customValues.values)),
  }}
  initialSort={{ key: 'when', dir: 'asc' }}
  searchPlaceholder={m.data_table_search()}
  searchFields={(box) =>
    `${box.lead.attendeeName ?? ''} ${servicesTitle(box.members, eventTitle)} ${resourceName(
      box.lead.resourceId,
    )}`}
  rowActions={openAction}
  {canEdit}
  onSaveRow={saveRow}
  emptyMessage={m.sched_empty_bookings()}
>
  {#snippet cell(box, col)}
    {#if col.key === 'status'}
      {@const tone = DEFAULT_STATUS_TONES[box.statusLead.status]}
      <Badge variant={tone ? 'semantic' : undefined} value={tone ?? undefined} size="sm"
        >{bookingStatusLabel(box.statusLead.status)}</Badge
      >
    {:else if col.key === 'service'}
      <span class="bt-service">
        <span class="truncate">{servicesTitle(box.members, eventTitle)}</span>
        {#if box.members.length > 1}
          <span class="t-caption bt-count">{m.cal_visit_title({ n: box.members.length })}</span>
        {/if}
      </span>
    {/if}
  {/snippet}
</DataTable>

<style>
  .bt-service {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }
  .bt-count {
    color: var(--color-text-tertiary);
  }
</style>
