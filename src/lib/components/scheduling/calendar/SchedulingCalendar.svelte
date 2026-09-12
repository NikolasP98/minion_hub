<script lang="ts">
  // The one view component (pass 2): @event-calendar/core owns rendering,
  // drag/resize/select, and per-view layout (day/week/month/agenda map to its
  // resourceTimeGridDay/timeGridWeek/dayGridMonth/listMonth views). CalendarStore
  // still owns data (events keyed by id, span-aware fetch, staff/kind filters).
  import {
    Calendar,
    ResourceTimeGrid,
    TimeGrid,
    DayGrid,
    List,
    Interaction,
  } from '@event-calendar/core';
  import '@event-calendar/core/index.css';
  import './ec-skin.css';
  import { goto } from '$lib/navigation';
  import { languageTag } from '$lib/paraglide/runtime';
  import { canAct } from '$lib/access/can.svelte';
  import EventHoverCard from './EventHoverCard.svelte';
  import MoveConfirmDialog from './MoveConfirmDialog.svelte';
  import {
    hhmm,
    calendarWallTime,
    calendarMoveIso,
    resolveEventColor,
    ymd,
    type CalendarStore,
  } from './calendar.svelte';
  import * as m from '$lib/paraglide/messages';
  import type { CalendarView, CalEvent, CalTag } from './types';

  let {
    store,
    view,
    day,
    resources,
    onTitleChange,
  }: {
    store: CalendarStore;
    view: CalendarView;
    day: string;
    resources: { id: string; name: string; color: string | null }[];
    onTitleChange?: (title: string) => void;
  } = $props();

  const VIEW_ID: Record<CalendarView, string> = {
    day: 'resourceTimeGridDay',
    week: 'timeGridWeek',
    month: 'dayGridMonth',
    agenda: 'listMonth',
  };

  const canEdit = $derived(canAct('scheduling', 'edit'));

  // Resource list after the staff filter (empty selection = every active resource).
  const filteredResources = $derived(
    resources.filter((r) => store.staff.size === 0 || store.staff.has(r.id)),
  );
  const ecResources = $derived(
    filteredResources.map((r) => ({
      id: r.id,
      title: r.name,
      eventBackgroundColor: r.color ?? undefined,
    })),
  );

  function escapeHtml(s: string): string {
    return s.replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
    );
  }

  /** Recomputed per call (not cached) so a locale switch is picked up without remount. */
  function originLabel(origin: 'own' | 'contact' | 'product'): string {
    if (origin === 'contact') return m.calendar_tag_origin_contact();
    if (origin === 'product') return m.calendar_tag_origin_service();
    return m.calendar_tag_origin_own();
  }

  /** hh:mm · service · client, staff dot, up to 4 tag dots + "+N" grouped by
   *  origin (own → contact → product, contact/product only when the
   *  per-user "linked tags" toggle is on). Raw HTML — the library injects it
   *  outside Svelte's render tree (no scoped class hashing reaches it), so
   *  its styling lives in `:global(.ec-chip*)` below. */
  function chipHtml(ev: CalEvent): string {
    const seen = new Set<string>();
    const grouped: { tag: CalTag; origin: 'own' | 'contact' | 'product' }[] = [];
    const groups: [CalTag[], 'own' | 'contact' | 'product'][] = [[ev.tags, 'own']];
    if (store.showInheritedTags) {
      groups.push([ev.contactTags, 'contact'], [ev.productTags, 'product']);
    }
    for (const [tags, origin] of groups) {
      for (const tag of tags) {
        if (seen.has(tag.id)) continue;
        seen.add(tag.id);
        grouped.push({ tag, origin });
      }
    }
    const shown = grouped.slice(0, 4);
    const extra = Math.max(0, grouped.length - 4);
    const dots = shown
      .map(
        ({ tag, origin }) =>
          `<span class="ec-chip-tag" data-origin="${origin}" style="--c:${tag.color ?? 'var(--color-accent)'}" title="${escapeHtml(tag.name)} · ${escapeHtml(originLabel(origin))}"></span>`,
      )
      .join('');
    const more = extra > 0 ? `<span class="ec-chip-more">+${extra}</span>` : '';
    const client = ev.attendeeName
      ? ` <span class="ec-chip-a">· ${escapeHtml(ev.attendeeName)}</span>`
      : '';
    const tagsRow = dots || more ? `<span class="ec-chip-tags">${dots}${more}</span>` : '';
    return (
      `<span class="ec-chip"><span class="ec-chip-dot" style="--c:${ev.resourceColor ?? 'var(--color-accent)'}"></span>` +
      `<span class="ec-chip-t">${hhmm(ev.start)}</span> <span class="ec-chip-s">${escapeHtml(ev.eventTypeTitle)}</span>${client}${tagsRow}</span>`
    );
  }

  // TODO(handoff): define fold-spanning event rendering when local end <= start;
  // preserve stored instants. See proposals/2026-09-10-hub-calendar-utc-offset-dropped.md.
  const ecEvents = $derived(
    store.visible.map((ev) => ({
      id: ev.id,
      start: calendarWallTime(ev.start),
      end: calendarWallTime(ev.end),
      resourceIds: [ev.resourceId],
      backgroundColor: resolveEventColor(ev, store.kindOf(ev)),
      classNames: [ev.status],
      extendedProps: ev,
    })),
  );

  // ── Hover card: one floating instance anchored on eventMouseEnter ──
  let hoverEvent = $state<CalEvent | null>(null);
  let hoverAnchor = $state<HTMLElement | null>(null);

  // ── Move/resize confirm ──
  let moveOpen = $state(false);
  let moveEvent = $state<CalEvent | null>(null);
  let moveOldStart = $state('');
  let moveOldEnd = $state('');
  let moveNewStart = $state('');
  let moveNewEnd = $state('');
  let moveNewResourceId = $state<string | null>(null);
  let moveRevert: (() => void) | null = null;

  interface DropOrResizeInfo {
    event: { id: string; start: Date; end: Date; extendedProps: CalEvent };
    oldEvent: { start: Date; end: Date };
    newResource?: { id: string };
    revert: () => void;
  }
  function openMove(info: DropOrResizeInfo) {
    moveEvent = info.event.extendedProps;
    // Callback Dates are lossy during a fold; unchanged endpoints come from storage.
    moveOldStart = moveEvent.start;
    moveOldEnd = moveEvent.end;
    moveNewStart = calendarMoveIso(info.event.start, info.oldEvent.start, moveOldStart);
    moveNewEnd = calendarMoveIso(info.event.end, info.oldEvent.end, moveOldEnd);
    moveNewResourceId = info.newResource?.id ?? null;
    moveRevert = info.revert;
    moveOpen = true;
  }
  function revertMove() {
    moveRevert?.();
  }
  function applyMove(id: string, patch: Partial<CalEvent>) {
    store.patchEvent(id, patch);
  }

  // The component instance exposes the imperative API (prev/next/gotoDate/
  // unselect); its declared type is the generic Svelte 5 component shell, so
  // narrow at the call sites (same pattern as TimeOffCalendar's `CalApi`).
  interface EcApi {
    prev(): void;
    next(): void;
    gotoDate(d: Date | string): void;
    unselect(): void;
  }
  let ecInstance = $state<unknown>();
  const ec = () => ecInstance as EcApi | undefined;

  // Seeds the library's mutable options object once from the initial props;
  // the `$effect`s right below keep every prop-derived field in sync on every
  // later change (documented pattern — see hub CLAUDE.md "Green baseline").
  // svelte-ignore state_referenced_locally
  let options = $state<Record<string, unknown>>({
    // Neutral internal axis; ecEvents supplies viewer-local wall fields.
    timeZone: 'UTC',
    view: VIEW_ID[view],
    date: new Date(`${day}T00:00:00`),
    headerToolbar: { start: '', center: '', end: '' },
    firstDay: 1,
    locale: languageTag(),
    height: 'auto',
    slotMinTime: '07:00',
    slotMaxTime: '21:00',
    slotDuration: '00:15',
    snapDuration: '00:15',
    slotEventOverlap: false, // crop only on real conflict — overlaps share width
    nowIndicator: true,
    dayMaxEvents: true,
    editable: canEdit,
    selectable: canEdit,
    dragScroll: true,
    resources: [],
    events: [],
    eventContent: (info: { event: { extendedProps: CalEvent } }) => ({
      html: chipHtml(info.event.extendedProps),
    }),
    eventMouseEnter: (info: { el: HTMLElement; event: { extendedProps: CalEvent } }) => {
      hoverEvent = info.event.extendedProps;
      hoverAnchor = info.el;
    },
    eventMouseLeave: () => {
      hoverEvent = null;
      hoverAnchor = null;
    },
    datesSet: (info: { start: Date; end: Date; view: { title: string } }) => {
      onTitleChange?.(info.view.title);
      void store.ensure(info.start, info.end);
    },
    eventDrop: openMove,
    eventResize: openMove,
    select: (info: { start: Date; allDay: boolean; resource?: { id: string } }) => {
      const params = new URLSearchParams({ date: ymd(info.start) });
      if (!info.allDay) {
        params.set(
          'time',
          `${String(info.start.getHours()).padStart(2, '0')}:${String(info.start.getMinutes()).padStart(2, '0')}`,
        );
      }
      if (info.resource) params.set('resource', info.resource.id);
      ec()?.unselect();
      void goto(`/scheduling/bookings/new?${params}`);
    },
  });

  $effect(() => {
    options.view = VIEW_ID[view];
  });
  $effect(() => {
    options.date = new Date(`${day}T00:00:00`);
  });
  $effect(() => {
    options.resources = ecResources;
  });
  $effect(() => {
    options.events = ecEvents;
  });
  $effect(() => {
    options.locale = languageTag();
  });
  $effect(() => {
    options.editable = canEdit;
    options.selectable = canEdit;
  });

  // Toolbar-driven navigation calls the instance directly for an instant move
  // (the `?date=` URL round-trip above still keeps the page's own state in sync).
  export function gotoDate(d: string) {
    ec()?.gotoDate(d);
  }
  export function prev() {
    ec()?.prev();
  }
  export function next() {
    ec()?.next();
  }
</script>

<div class="sc">
  <Calendar
    bind:this={ecInstance}
    plugins={[ResourceTimeGrid, TimeGrid, DayGrid, List, Interaction]}
    {options}
  />
</div>

<EventHoverCard
  event={hoverEvent}
  kind={hoverEvent ? store.kindOf(hoverEvent) : undefined}
  anchor={hoverAnchor}
  showInheritedTags={store.showInheritedTags}
/>

<MoveConfirmDialog
  bind:open={moveOpen}
  event={moveEvent}
  oldStart={moveOldStart}
  oldEnd={moveOldEnd}
  newStart={moveNewStart}
  newEnd={moveNewEnd}
  newResourceId={moveNewResourceId}
  {resources}
  revert={revertMove}
  onSaved={applyMove}
/>

<style>
  .sc {
    min-width: 0;
    height: 100%;
  }
  .sc :global(.ec) {
    height: 100%;
  }
  /* Chip content — injected as raw HTML via eventContent, so it never gets
     Svelte's scoped-class hash; styled globally like the other .ec-* hooks. */
  :global(.ec-chip) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-0-5);
    min-width: 0;
    overflow: hidden;
  }
  :global(.ec-chip-dot) {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--c);
    flex-shrink: 0;
  }
  :global(.ec-chip-t) {
    font-weight: 600;
    flex-shrink: 0;
  }
  :global(.ec-chip-s),
  :global(.ec-chip-a) {
    opacity: 0.85;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.ec-chip-tags) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-0-5);
    margin-left: var(--space-0-5);
  }
  :global(.ec-chip-tag) {
    width: 5px;
    height: 5px;
    border-radius: var(--radius-full);
    background: var(--c);
    flex-shrink: 0;
  }
  /* Inherited (contact/product) tag dots get a ring so they read as distinct
     from the event's own tags, which stay plain. */
  :global(.ec-chip-tag[data-origin='contact']) {
    box-shadow: 0 0 0 1.5px var(--color-surface-1);
    outline: 1px solid var(--c);
  }
  :global(.ec-chip-tag[data-origin='product']) {
    border-radius: var(--radius-xs);
  }
  :global(.ec-chip-more) {
    font-size: var(--font-size-telemetry);
    opacity: 0.8;
  }
  :global(.ec-event.cancelled),
  :global(.ec-event.no_show) {
    opacity: 0.45;
    text-decoration: line-through;
  }
</style>
