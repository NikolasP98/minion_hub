<script lang="ts">
  /**
   * The team calendar — the SAME `BookingCalendar` grid and page kit
   * `/pos/appointments` runs on (spec 2026-09-27 S3). It replaced the
   * `@event-calendar/core` renderer plus its `CalendarStore`, `CalendarToolbar`,
   * `EventHoverCard` and `MoveConfirmDialog`, so this surface gains the runway,
   * colour sources, configurable hover/block fields, drag-move + resize,
   * merge-on-drop, the create tray and the detail drawer, and keeps what was
   * only ever here: the agenda view, the staff/kind filters and the per-viewer
   * "show linked tags" preference.
   *
   * Everything scheduling-specific reaches the grid through props, snippets and
   * callbacks — nothing about this route lives inside the component.
   */
  import type { PageData } from './$types';
  import { CalendarDays, Check, Plus, UserX, X } from 'lucide-svelte';
  import { onDestroy, untrack } from 'svelte';
  import { invalidate, goto, replaceState } from '$lib/navigation';
  import { page } from '$app/state';
  import {
    Button,
    EmptyState,
    MultiSelectFilter,
    PageHeader,
    Select,
    Toggle,
    iconSizes,
  } from '$lib/components/ui';
  import { PageShell } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import BookingCalendar from '$lib/components/scheduling/BookingCalendar.svelte';
  import DataView from '$lib/components/data-view/DataView.svelte';
  import BookingTable from '$lib/components/scheduling/BookingTable.svelte';
  import BookingBoard from '$lib/components/scheduling/BookingBoard.svelte';
  import { createBookingCustomValues } from '$lib/components/scheduling/kit/booking-custom-values.svelte';
  import BookingDetailDrawer from '$lib/components/scheduling/BookingDetailDrawer.svelte';
  import BookingCreateDrawer, {
    type BookingCreateTarget,
  } from '$lib/components/scheduling/BookingCreateDrawer.svelte';
  import type { CreatedBooking } from '$lib/components/scheduling/AppointmentForm.svelte';
  import TagFilter from '$lib/components/tags/TagFilter.svelte';
  import {
    calendarCacheRange,
    calendarLoadDays,
    calendarWindowScope,
    type CalendarBooking,
    type CalendarPageView,
    type CalendarView,
  } from '$lib/components/scheduling/calendar-window';
  import { mondayOf } from '$lib/components/scheduling/runway';
  import { visibleTagOptions } from '$lib/components/scheduling/tag-filter-range';
  import { createCalendarWindowCache } from '$lib/components/scheduling/kit/window-cache.svelte';
  import { createSettledDay } from '$lib/components/scheduling/kit/settled-day.svelte';
  import { createBookingMover } from '$lib/components/scheduling/kit/booking-mover';
  import { createCalendarPrefs } from '$lib/components/scheduling/kit/calendar-prefs.svelte';
  import { canAct } from '$lib/access/can.svelte';
  import { fetchJson } from '$lib/api/fetch-json';
  import { toastError } from '$lib/state/ui/toast.svelte';
  import { instantDateKey } from '$lib/time/zoned';

  let { data }: { data: PageData } = $props();

  async function refresh(): Promise<void> {
    await invalidate('scheduling:data');
  }

  // ── Week cache for the calendar's infinite scrolling ──────────────────────
  // Identical wiring to `/pos/appointments` (`window-cache.svelte.ts`), over the
  // narrower scheduling payload: no tickets, no accrual chips.
  type WindowPayload = Pick<PageData, 'bookings' | 'tagOptions'>;
  const winCache = createCalendarWindowCache<WindowPayload>({
    fetchWindow: async (from, to, signal) => {
      const res = await fetch(`/api/scheduling/calendar?from=${from}&to=${to}`, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { calendarScope, ...payload } = (await res.json()) as WindowPayload & {
        calendarScope: string | null;
      };
      return { calendarScope, payload };
    },
    merge: (parts) => {
      const bookings: WindowPayload['bookings'] = [];
      const tags = new Map<string, WindowPayload['tagOptions'][number]>();
      for (const week of parts) {
        bookings.push(...week.bookings);
        for (const t of week.tagOptions) if (!tags.has(t.id)) tags.set(t.id, t);
      }
      return { bookings, tagOptions: [...tags.values()] };
    },
  });
  onDestroy(winCache.dispose);
  /** What the calendar renders: the union of the loaded weeks. */
  const cal = $derived(winCache.data);

  /** The calendar's last reported visible range — what "near the screen" means
   *  for the tag filter. */
  let visibleFirst = $state('');
  let visibleLast = $state('');
  function onRange(first: string, last: string) {
    visibleFirst = first;
    visibleLast = last;
    winCache.setVisibleRange(first, last, { prefetch: true });
  }

  function seedWindow(current: PageData): Map<string, WindowPayload> {
    const out = new Map<string, WindowPayload>();
    const bucket = (day: string) => {
      const key = mondayOf(day);
      let week = out.get(key);
      // `tagOptions` is window-wide and merge deduplicates it across buckets.
      if (!week) out.set(key, (week = { bookings: [], tagOptions: current.tagOptions }));
      return week;
    };
    for (const booking of current.bookings)
      bucket(instantDateKey(new Date(booking.start), current.orgTz)).bookings.push(booking);
    return out;
  }

  let reconciledGeneration = '';
  $effect(() => {
    const current = data;
    const activeOrgId = page.data.activeOrgId;
    const generation = JSON.stringify([
      activeOrgId,
      current.calendarScope,
      current.pageView,
      current.day,
    ]);
    untrack(() => {
      const mutationRefresh = reconciledGeneration === generation;
      reconciledGeneration = generation;
      winCache.reconcile({
        activeScope: calendarWindowScope(activeOrgId, current.orgTz),
        seedScope: current.calendarScope,
        seedRange: calendarLoadDays(current.day, current.view),
        seed: seedWindow(current),
      });
      if (!mutationRefresh) {
        const range = calendarCacheRange(current.day, current.pageView);
        visibleFirst = range.first;
        visibleLast = range.last;
        winCache.setVisibleRange(range.first, range.last, { prefetch: range.prefetch });
      }
      if (mutationRefresh && current.view !== 'day') winCache.refetchVisible();
    });
  });

  // ── Per-viewer "show linked tags" (server-side preference, this surface only)
  // Off ⇒ boxes and the filter show a booking's OWN event tags, never the ones
  // inherited from its client or its service.
  // svelte-ignore state_referenced_locally
  let showInheritedTags = $state(data.showInheritedTags);
  // Mirror the prop on every later load (the toggle writes the server preference,
  // so a reload must not fight the optimistic local value it already matches).
  $effect(() => {
    showInheritedTags = data.showInheritedTags;
  });
  async function setShowInheritedTags(next: boolean) {
    const previous = showInheritedTags;
    showInheritedTags = next; // optimistic — visual feedback before the round trip
    try {
      await fetchJson('/api/me/preferences/calendar', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: { showInheritedTags: next } }),
      });
    } catch {
      showInheritedTags = previous;
      toastError(m.sched_cal_show_linked_tags_error());
    }
  }

  // ── Staff + kind filters (client-side over the loaded window) ─────────────
  // Seeded from `?staff=`/`?kind=` so deep links keep working, then local: a
  // toggle must not re-run the load for data the page already holds.
  // svelte-ignore state_referenced_locally
  let staff = $state(new Set(data.staff));
  // svelte-ignore state_referenced_locally
  let kindId = $state(data.kindId);
  const staffOptions = $derived(
    data.resources.map((r) => ({ value: r.id, label: r.name, color: r.color ?? undefined })),
  );
  const kindOptions = $derived([
    { value: '', label: m.sched_cal_all_kinds() },
    ...data.kinds.map((k) => ({ value: k.id, label: k.name })),
  ]);
  /** Day view draws one column per resource, so a staff filter narrows the
   *  columns as well as the boxes. */
  const visibleResources = $derived(
    staff.size === 0 ? data.resources : data.resources.filter((r) => staff.has(r.id)),
  );

  // Tag filter (own, client and service tags) — session-local, empty = all.
  let tagFilter = $state<Set<string>>(new Set());

  /** One pass: drop inherited tags when the preference is off, then apply the
   *  staff / kind / tag filters. The grid only ever sees what it should draw. */
  const visibleBookings = $derived(
    cal.bookings
      .map((b): CalendarBooking =>
        showInheritedTags || !b.tags?.length
          ? b
          : { ...b, tags: b.tags.filter((t) => t.origin === 'own') },
      )
      .filter(
        (b) =>
          (staff.size === 0 || staff.has(b.resourceId)) &&
          (!kindId || b.kindId === kindId) &&
          (tagFilter.size === 0 || (b.tags ?? []).some((t) => tagFilter.has(t.id))),
      ),
  );

  const canEdit = $derived(canAct('scheduling', 'edit'));
  const canCreate = $derived(canAct('scheduling', 'create'));
  /** The create tray's own gate — same capability the button uses. */
  const canBook = $derived(canCreate);
  let detailId = $state<string | null>(null);

  /** The focused day per the URL, which the runway moves with a shallow replace —
   *  so it runs AHEAD of `data.day` (`settled-day.svelte.ts` owns the workaround). */
  const settled = createSettledDay({
    pageDay: () => data.day,
    view: () => data.view,
    replaceUrl: (params) => replaceState(`?${params}`, page.state),
  });
  const currentDay = $derived(settled.currentDay);
  const replaceDate = settled.replaceDate;
  /** Same organization-day rule as the grid. */
  const localDay = (iso: string) => instantDateKey(new Date(iso), data.orgTz);
  const mutationScope = $derived(`scheduling:${page.data.activeOrgId ?? 'unknown'}`);

  /** Tags the filter offers: the ones on bookings currently ON SCREEN plus the
   *  selected ones — and, with the preference off, own-scope tags only. */
  const filterTagOptions = $derived(
    visibleTagOptions({
      options: showInheritedTags ? cal.tagOptions : cal.tagOptions.filter((t) => !t.origin),
      bookings: visibleBookings,
      range:
        data.view === 'day'
          ? { first: currentDay, last: currentDay }
          : visibleFirst && visibleLast
            ? { first: visibleFirst, last: visibleLast }
            : null,
      selected: tagFilter,
      dayOf: localDay,
    }),
  );

  /** View + focused date live in the URL, so refresh and Back both behave. */
  function navigate(next: { view?: CalendarPageView; date?: string }) {
    const params = new URLSearchParams({
      view: next.view ?? data.pageView,
      date: next.date ?? currentDay,
    });
    return goto(`?${params}`, { keepFocus: true, noScroll: true });
  }

  /** Empty grid space → the create TRAY with the snapped slot prefilled.
   *  `/scheduling/bookings/new` stays a route for deep links; nothing in the
   *  grid navigates to it any more. */
  let createTarget = $state<BookingCreateTarget | null>(null);
  function newAt(day: string, time: string, resourceId: string | null) {
    createTarget = { day, time, resourceId };
  }
  async function onCreated(booking: CreatedBooking) {
    createTarget = null;
    const day = localDay(booking.startTime);
    await refresh();
    if (day !== currentDay) await navigate({ date: day });
  }

  /** Per-viewer calendar prefs — `hub-scheduling-calendar-*` localStorage keys
   *  (the POS surface keeps its own `hub-pos-calendar-*` namespace). */
  const prefs = createCalendarPrefs('scheduling');
  /** One custom-column store for the grid, the table and the board. */
  const customValues = createBookingCustomValues();
  $effect(() => {
    void customValues.load();
  });
  const pageView = $derived(
    data.pageView === 'table' || data.pageView === 'board' ? data.pageView : 'calendar',
  );

  /** Drag/resize/merge/detach commits — `booking-mover.ts`, on this surface's
   *  own API base (`/api/scheduling/bookings` + its `[id]/group` twin). */
  const mover = createBookingMover({
    apiBase: '/api/scheduling/bookings',
    onError: (detail) => toastError(m.sched_move_failed(), detail),
    refresh,
  });
</script>

<svelte:head><title>{m.sched_calendar_title()} · {m.nav_scheduling()}</title></svelte:head>

<PageShell
  archetype="collection"
  scroll="region"
  labelledBy="scheduling-calendar-title"
  class="scheduling-calendar-surface"
>
  <PageHeader
    titleId="scheduling-calendar-title"
    title={m.sched_calendar_title()}
    subtitle={m.sched_calendar_subtitle()}
  >
    {#snippet leading()}
      <CalendarDays size={iconSizes.md} class="text-accent shrink-0" />
    {/snippet}
    {#snippet primaryActions()}
      <Button
        size="sm"
        onclick={() => (createTarget = { day: currentDay })}
        disabled={data.eventTypes.length === 0 || !canCreate}
        title={canCreate ? undefined : m.no_permission()}
      >
        <Plus size={iconSizes.sm} />
        {m.appt_new_title()}
      </Button>
    {/snippet}
  </PageHeader>

  {#if data.resources.length === 0}
    <EmptyState title={m.sched_empty_resources()} />
  {:else}
    <DataView
      views={['calendar', 'table', 'board']}
      value={pageView}
      onchange={(v) =>
        navigate({ view: v === 'calendar' ? data.view : v === 'board' ? 'board' : 'table' })}
    >
      {#snippet children({ switcher, view: dv })}
        {#if dv === 'table' || dv === 'board'}
          <div class="dv-bar">
            {@render switcher()}
            <TagFilter
              scope="event"
              tags={filterTagOptions}
              selected={tagFilter}
              onselect={(next) => (tagFilter = next)}
              ontagschange={() => refresh()}
            />
          </div>
          {#if dv === 'table'}
            <BookingTable
              bookings={visibleBookings}
              resources={visibleResources}
              eventTypes={data.eventTypes}
              timeZone={data.orgTz}
              {customValues}
              scopeKey="scheduling:scheduling.bookings"
              onopen={(id) => (detailId = id)}
              {canEdit}
              onstatus={canEdit ? mover.setStatus : undefined}
              onstaff={canEdit ? mover.moveBooking : undefined}
            />
          {:else}
            <BookingBoard
              bookings={visibleBookings}
              resources={visibleResources}
              eventTypes={data.eventTypes}
              timeZone={data.orgTz}
              {customValues}
              axis={prefs.boardBy}
              onaxis={prefs.setBoardBy}
              onopen={(id) => (detailId = id)}
              onstatus={canEdit ? mover.setStatus : undefined}
              onstaff={canEdit ? mover.moveBooking : undefined}
            />
          {/if}
        {:else}
          <BookingCalendar
            view={data.view}
            date={currentDay}
            timeZone={data.orgTz}
            {mutationScope}
            bookings={visibleBookings}
            resources={visibleResources}
            eventTypes={data.eventTypes}
            kinds={data.kinds}
            tagOptions={cal.tagOptions}
            categories={data.categories}
            hours={data.hours}
            features={{ agenda: true, split: false }}
            blockColorBy={prefs.blockColorBy}
            sliverColorBy={prefs.sliverColorBy}
            oncolorby={prefs.setColorBy}
            weekDays={prefs.weekDays}
            onweekdays={prefs.setWeekDays}
            pxPerHour={prefs.pxPerHour}
            onpxperhour={prefs.setPxPerHour}
            subBy={prefs.subBy}
            onsubby={prefs.setSubBy}
            {customValues}
            onview={(view, date) => navigate({ view, date })}
            ondate={(date, opts) => (opts?.silent ? replaceDate(date) : navigate({ date }))}
            onrange={onRange}
            busy={winCache.busy}
            windows={winCache.windows}
            onwindowretry={winCache.retry}
            onopen={(id) => (detailId = id)}
            onslot={canCreate ? newAt : undefined}
            onmove={canEdit ? mover.moveBooking : undefined}
          >
            {#snippet toolbarStart()}{@render switcher()}{/snippet}
            {#snippet tools()}
              <MultiSelectFilter
                class="cal-staff-filter"
                label={m.sched_cal_staff()}
                options={staffOptions}
                selected={staff}
                onToggle={(v) => {
                  const next = new Set(staff);
                  if (next.has(v)) next.delete(v);
                  else next.add(v);
                  staff = next;
                }}
                onClear={() => (staff = new Set())}
                allLabel={m.sched_cal_all_staff()}
              />
              <Select
                aria-label={m.sched_kind_label()}
                size="sm"
                value={kindId ?? ''}
                options={kindOptions}
                onchange={(v) => (kindId = v ? String(v) : null)}
              />
              <TagFilter
                scope="event"
                tags={filterTagOptions}
                selected={tagFilter}
                onselect={(next) => (tagFilter = next)}
                ontagschange={() => refresh()}
              />
              <Toggle
                size="sm"
                checked={showInheritedTags}
                label={m.sched_cal_show_linked_tags()}
                onchange={setShowInheritedTags}
              />
            {/snippet}

            {#snippet actions(b)}
              {#if b.status === 'accepted' || b.status === 'pending'}
                <span
                  class="hc-act"
                  data-tip={canEdit ? m.sched_mark_complete() : m.no_permission()}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={m.sched_mark_complete()}
                    disabled={!canEdit}
                    onclick={() => mover.setStatus(b.id, 'completed')}
                  >
                    <Check size={iconSizes.sm} />
                  </Button>
                </span>
                <span class="hc-act" data-tip={canEdit ? m.sched_mark_noShow() : m.no_permission()}>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={m.sched_mark_noShow()}
                    disabled={!canEdit}
                    onclick={() => mover.setStatus(b.id, 'no_show')}
                  >
                    <UserX size={iconSizes.sm} />
                  </Button>
                </span>
                <span
                  class="hc-act"
                  data-tip={canEdit ? m.sched_cancel_booking() : m.no_permission()}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={m.sched_cancel_booking()}
                    disabled={!canEdit}
                    onclick={() => mover.setStatus(b.id, 'cancelled')}
                  >
                    <X size={iconSizes.sm} />
                  </Button>
                </span>
              {/if}
            {/snippet}
          </BookingCalendar>
        {/if}
      {/snippet}
    </DataView>
  {/if}
</PageShell>

<BookingDetailDrawer
  bookingId={detailId}
  apiBase="/api/scheduling/bookings"
  {canEdit}
  onclose={() => (detailId = null)}
  onchanged={() => refresh()}
  onnavigate={(id) => (detailId = id)}
  resources={data.resources}
  timeZone={data.orgTz}
  {mutationScope}
/>

<!-- The create tray books through THIS surface's own endpoint and capability
     (the panel defaults to the POS pair, which a scheduler may not hold). -->
<BookingCreateDrawer
  target={createTarget}
  eventTypes={data.eventTypes}
  resources={data.resources}
  timeZone={data.orgTz}
  {mutationScope}
  bookEndpoint="/api/scheduling/bookings"
  {canBook}
  onclose={() => (createTarget = null)}
  onbooked={onCreated}
/>

<style>
  .dv-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-bottom: var(--space-2);
  }
</style>
