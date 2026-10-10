<script lang="ts">
  /**
   * The BOARD view of a calendar page: EVENTS as cards in one column per
   * value of the chosen axis — status, staff, or any custom select column on
   * appointments. Dragging a card to another column WRITES that value through
   * the same paths the grid's subcolumns use (owner ask 2026-10-02): status
   * via `onstatus`, staff via `onstaff`, a custom column via the shared store.
   *
   * One card = one EVENT, not one service: the N `sched_bookings` rows sharing
   * a `groupId` collapse into a single `BookingBox` through `groupBookings`,
   * the same way the grid draws them (owner ask 2026-10-08: "events just
   * become a single type"). Everything a card shows or writes therefore comes
   * off the box — the whole span, the lead's client/chair, the `statusLead`'s
   * status — and a drag on a multi-service card writes the WHOLE event.
   */
  import BoardView from '$lib/components/data-view/BoardView.svelte';
  import SegmentedControl from '$lib/components/ui/SegmentedControl.svelte';
  import * as m from '$lib/paraglide/messages';
  import { toastError } from '$lib/state/ui/toast.svelte';
  import { formatDate, formatTime } from '$lib/utils/format';
  import type { CalendarBooking, CalendarResource } from './calendar-window';
  import { groupBookings, type BookingBox } from './booking-groups';
  import { servicesTitle } from './visit';
  import type { MoveOpts } from './move-conflict';
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
    onvisitstatus,
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
    /** Present = single-service cards drag between status columns. */
    onstatus?: (id: string, status: string) => Promise<void> | void;
    /** The same drag on a MULTI-service card: the status of the whole event in
     *  one call. Without it those cards can't change status. */
    onvisitstatus?: (id: string, status: string) => Promise<void> | void;
    /** Present = cards drag between staff columns. `opts.group` is set for a
     *  multi-service event so the whole visit moves chairs at once. */
    onstaff?: (
      id: string,
      next: { start: string; end: string; resourceId: string },
      opts?: MoveOpts,
    ) => Promise<unknown> | void;
  } = $props();

  const prop = $derived(
    axis.startsWith(PROP_PREFIX)
      ? (customValues.selectDefs.find((d) => d.id === axis.slice(PROP_PREFIX.length)) ?? null)
      : null,
  );
  const axisKind = $derived(prop ? 'prop' : axis === 'staff' ? 'staff' : 'status');
  /** One box per event, earliest first. */
  const boxes = $derived(
    groupBookings(bookings).sort(
      (a, b) => a.start.localeCompare(b.start) || a.key.localeCompare(b.key),
    ),
  );
  // Custom values are the LEAD row's — the event has one value, not one per
  // service (same key the grid's subcolumns and the table's cells use).
  $effect(() => {
    if (prop) customValues.ensure(boxes.map((box) => box.lead.id));
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
  function columnOf(box: BookingBox): string | null {
    if (prop) return customValues.valueOf(box.lead.id, prop);
    return axisKind === 'staff' ? box.lead.resourceId || null : box.statusLead.status;
  }
  const canMove = $derived(
    prop ? true : axisKind === 'staff' ? onstaff !== undefined : onstatus !== undefined,
  );
  /** ONE write per move, whatever opened it (the card's "Move to…" menu or a
   *  drop); `false` = refused, so the board's live region can say so (HC-015). */
  async function move(box: BookingBox, columnId: string | null): Promise<boolean> {
    // A one-service event keeps today's per-row writes EXACTLY; only a real
    // multi-service event takes the visit-wide ones.
    const visit = box.members.length > 1;
    const id = box.lead.id;
    if (prop) {
      if (customValues.editable[id] === false) return false;
      // The board's lane is the LEAD's value (see `columnOf`), so the write is
      // the lead's too. `apply` already re-read the refused card (it snaps
      // back); say so.
      const { failed } = await customValues.apply(prop, [id], columnId);
      if (failed.length) toastError(m.custom_columns_save_failed());
      return failed.length === 0;
    }
    // Status and staff have no "unclassified" target: there is nothing to write.
    if (!columnId) return false;
    if (axisKind === 'staff')
      await onstaff?.(
        id,
        { start: box.start, end: box.end, resourceId: columnId },
        visit ? { group: true } : undefined,
      );
    else if (visit) await onvisitstatus?.(id, columnId);
    else await onstatus?.(id, columnId);
    return true;
  }
  const resourceName = (id: string) => resources.find((r) => r.id === id)?.name ?? '—';
  const resourceColor = (id: string) => resources.find((r) => r.id === id)?.color ?? null;
  const eventTitle = (id: string) => eventTypes.find((e) => e.id === id)?.title ?? '—';
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
  rows={boxes}
  {columnOf}
  rowKey={(box) => box.key}
  rowLabel={(box) => box.lead.attendeeName ?? '—'}
  onopen={(box) => onopen(box.lead.id)}
  onmove={canMove ? move : undefined}
>
  {#snippet card(box)}
    <span class="bc-top">
      <span class="t-caption bc-time"
        >{formatDate(new Date(box.start), {
          day: 'numeric',
          month: 'short',
          timeZone,
        })} · {formatTime(box.start, timeZone)} – {formatTime(box.end, timeZone)}</span
      >
      {#if resourceColor(box.lead.resourceId)}<span
          class="bc-dot"
          style="background:{resourceColor(box.lead.resourceId)}"
          title={resourceName(box.lead.resourceId)}
        ></span>{/if}
    </span>
    <span class="bc-name truncate">{box.lead.attendeeName ?? '—'}</span>
    <span class="t-caption bc-meta truncate">{servicesTitle(box.members, eventTitle)}</span>
    {#if box.members.length > 1}
      <span class="t-caption bc-meta">{m.cal_visit_title({ n: box.members.length })}</span>
    {/if}
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
