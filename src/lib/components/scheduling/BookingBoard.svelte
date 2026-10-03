<script lang="ts">
  /**
   * The BOARD view of a calendar page: bookings as cards in one column per
   * value of the chosen axis — status, staff, or any custom select column on
   * appointments. Dragging a card to another column WRITES that value through
   * the same paths the grid's subcolumns use (owner ask 2026-10-02): status
   * via `onstatus`, staff via `onstaff`, a custom column via the shared store.
   */
  import BoardView from '$lib/components/data-view/BoardView.svelte';
  import SegmentedControl from '$lib/components/ui/SegmentedControl.svelte';
  import * as m from '$lib/paraglide/messages';
  import { formatDate, formatTime } from '$lib/utils/format';
  import type { CalendarBooking, CalendarResource } from './calendar-window';
  import { BOOKING_STATUSES, bookingStatusLabel } from './booking-status';
  import { PROP_PREFIX, type BookingCustomValues } from './kit/booking-custom-values.svelte';

  let {
    bookings,
    resources,
    eventTypes,
    timeZone,
    customValues,
    axis,
    onaxis,
    onopen,
    onstatus,
    onstaff,
  }: {
    bookings: CalendarBooking[];
    resources: CalendarResource[];
    eventTypes: Array<{ id: string; title: string }>;
    timeZone: string;
    customValues: BookingCustomValues;
    /** `status` | `staff` | `prop:<id>` (the page persists it). */
    axis: string;
    onaxis: (axis: string) => void;
    onopen: (id: string) => void;
    /** Present = cards drag between status columns. */
    onstatus?: (id: string, status: string) => Promise<void> | void;
    /** Present = cards drag between staff columns. */
    onstaff?: (
      id: string,
      next: { start: string; end: string; resourceId: string },
    ) => Promise<unknown> | void;
  } = $props();

  const prop = $derived(
    axis.startsWith(PROP_PREFIX)
      ? (customValues.selectDefs.find((d) => d.id === axis.slice(PROP_PREFIX.length)) ?? null)
      : null,
  );
  const axisKind = $derived(prop ? 'prop' : axis === 'staff' ? 'staff' : 'status');
  $effect(() => {
    if (prop) customValues.ensure(bookings.map((b) => b.id));
  });

  const axisItems = $derived([
    { value: 'status', label: m.sched_cal_status() },
    { value: 'staff', label: m.cal_staff() },
    ...customValues.selectDefs.map((d) => ({ value: PROP_PREFIX + d.id, label: d.label })),
  ]);
  const columns = $derived.by(() => {
    if (prop && prop.rules.type === 'select')
      return prop.rules.options
        .filter((o) => !o.archivedAt)
        .map((o) => ({ id: o.id, label: o.label, color: o.color }));
    if (axisKind === 'staff')
      return resources.map((r) => ({ id: r.id, label: r.name, color: r.color ?? null }));
    return BOOKING_STATUSES.map((s) => ({ id: s, label: bookingStatusLabel(s) }));
  });
  function columnOf(b: CalendarBooking): string | null {
    if (prop) return customValues.valueOf(b.id, prop);
    return axisKind === 'staff' ? b.resourceId || null : b.status;
  }
  const canMove = $derived(
    prop ? true : axisKind === 'staff' ? onstaff !== undefined : onstatus !== undefined,
  );
  async function move(b: CalendarBooking, columnId: string | null) {
    if (prop) {
      if (customValues.editable[b.id] === false) return;
      await customValues.apply(prop, [b.id], columnId);
    } else if (axisKind === 'staff') {
      if (columnId) await onstaff?.(b.id, { start: b.start, end: b.end, resourceId: columnId });
    } else if (columnId) await onstatus?.(b.id, columnId);
  }
  const resourceName = (id: string) => resources.find((r) => r.id === id)?.name ?? '—';
  const resourceColor = (id: string) => resources.find((r) => r.id === id)?.color ?? null;
  const eventTitle = (id: string) => eventTypes.find((e) => e.id === id)?.title ?? '—';
  const sorted = $derived([...bookings].sort((a, b) => a.start.localeCompare(b.start)));
</script>

<div class="bb-bar">
  <span class="t-caption bb-label">{m.board_group_by()}</span>
  <SegmentedControl
    items={axisItems}
    value={axisItems.some((i) => i.value === axis) ? axis : 'status'}
    aria-label={m.board_group_by()}
    onValueChange={onaxis}
  />
</div>
<BoardView
  {columns}
  rows={sorted}
  {columnOf}
  rowKey={(b) => b.id}
  onopen={(b) => onopen(b.id)}
  onmove={canMove ? move : undefined}
>
  {#snippet card(b)}
    <span class="bc-top">
      <span class="t-caption bc-time"
        >{formatDate(new Date(b.start), { day: 'numeric', month: 'short', timeZone })} · {formatTime(
          b.start,
          timeZone,
        )} – {formatTime(b.end, timeZone)}</span
      >
      {#if resourceColor(b.resourceId)}<span
          class="bc-dot"
          style="background:{resourceColor(b.resourceId)}"
          title={resourceName(b.resourceId)}
        ></span>{/if}
    </span>
    <span class="bc-name truncate">{b.attendeeName ?? '—'}</span>
    <span class="t-caption bc-meta truncate">{eventTitle(b.eventTypeId)}</span>
  {/snippet}
</BoardView>

<style>
  .bb-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-bottom: var(--space-2);
  }
  .bb-label {
    color: var(--color-text-secondary);
  }
  .bc-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-1);
  }
  .bc-time {
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .bc-dot {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    flex-shrink: 0;
  }
  .bc-name {
    font-weight: 500;
    color: var(--color-text-primary);
  }
  .bc-meta {
    color: var(--color-text-tertiary);
  }
</style>
