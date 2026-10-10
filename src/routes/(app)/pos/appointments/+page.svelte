<script lang="ts">
  import type { PageData } from './$types';
  import {
    CalendarDays,
    ChevronDown,
    ChevronRight,
    Plus,
    Check,
    X,
    UserX,
    ShoppingCart,
    GripVertical,
  } from 'lucide-svelte';
  import { onDestroy, untrack } from 'svelte';
  import { invalidate, goto, replaceState } from '$lib/navigation';
  import { page } from '$app/state';
  import { PageHeader, Button, Badge, MultiSelectFilter, iconSizes } from '$lib/components/ui';
  import { PageShell } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import ConsumptionConfirmDialog from '$lib/components/scheduling/ConsumptionConfirmDialog.svelte';
  import type { CompleteResult } from '$lib/components/scheduling/consumption-lines';
  import BookingCalendar, {
    CALENDAR_DROP_MIME,
    type CalendarAnchor,
  } from '$lib/components/scheduling/BookingCalendar.svelte';
  import BookingDetailDrawer from '$lib/components/scheduling/BookingDetailDrawer.svelte';
  import type { PayableEvent } from '$lib/components/scheduling/BookingDetailDrawer.svelte';
  import BookingCreateDrawer, {
    type BookingCreateTarget,
  } from '$lib/components/scheduling/BookingCreateDrawer.svelte';
  import type { CreatedBooking } from '$lib/components/scheduling/AppointmentForm.svelte';
  import TagFilter from '$lib/components/tags/TagFilter.svelte';
  import {
    calendarCacheRange,
    calendarLoadDays,
    calendarWindowScope,
    type CalendarPageView,
    type CalendarView,
  } from '$lib/components/scheduling/calendar-window';
  import DataView from '$lib/components/data-view/DataView.svelte';
  import BookingTable from '$lib/components/scheduling/BookingTable.svelte';
  import BookingBoard from '$lib/components/scheduling/BookingBoard.svelte';
  import { createBookingCustomValues } from '$lib/components/scheduling/kit/booking-custom-values.svelte';
  import { mondayOf } from '$lib/components/scheduling/runway';
  import { visibleTagOptions } from '$lib/components/scheduling/tag-filter-range';
  import { createCalendarWindowCache } from '$lib/components/scheduling/kit/window-cache.svelte';
  import { createSettledDay } from '$lib/components/scheduling/kit/settled-day.svelte';
  import { createBookingMover } from '$lib/components/scheduling/kit/booking-mover';
  import {
    createCalendarPrefs,
    knownStaff,
  } from '$lib/components/scheduling/kit/calendar-prefs.svelte';
  import { canAct } from '$lib/access/can.svelte';
  import { formatDate, formatMoney } from '$lib/utils/format';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
  import { groupPendingLines } from '$lib/components/pos/pending-groups';
  import { matchEventTypes } from '$lib/components/pos/pending-schedule';
  import { instantDateKey } from '$lib/time/zoned';
  import { resolveCalendarInstant } from '$lib/components/scheduling/calendar-time';
  import { dispatchSellChargeHandoff } from '$lib/components/pos/sell-charge-handoff';

  let { data }: { data: PageData } = $props();

  /** Every booking mutation here can move a sold line between "pending" and
   *  "scheduled" (book, cancel, no-show, drawer edits), so the /pos layout's
   *  Accounts badge (`pos:pending`) refreshes together with the grid. */
  async function refresh(): Promise<void> {
    await Promise.all([invalidate('pos:appointments'), invalidate('pos:pending')]);
  }

  // ── Week cache for the calendar's infinite scrolling ──────────────────────
  // The runway scrolls through a year without navigating, so the grid's data
  // can't be "whatever the last load fetched" any more. `createCalendarWindowCache`
  // (kit) keeps one payload per ISO week: `reconcile` admits same-scope SSR
  // seed data, visible-range commands fetch missing neighbours through
  // `GET /api/pos/appointments`, and distant weeks are dropped so an hour of
  // scrolling can't grow the tab without bound.
  type WindowPayload = Pick<PageData, 'bookings' | 'invoices' | 'accrualSummaries' | 'tagOptions'>;

  const winCache = createCalendarWindowCache<WindowPayload>({
    fetchWindow: async (from, to, signal) => {
      const res = await fetch(`/api/pos/appointments?from=${from}&to=${to}`, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { calendarScope, ...payload } = (await res.json()) as WindowPayload & {
        calendarScope: string | null;
      };
      return { calendarScope, payload };
    },
    merge: (parts) => {
      const bookings: WindowPayload['bookings'] = [];
      const invoices: WindowPayload['invoices'] = [];
      const accruals = new Map<string, WindowPayload['accrualSummaries'][number]>();
      const tags = new Map<string, WindowPayload['tagOptions'][number]>();
      for (const week of parts) {
        bookings.push(...week.bookings);
        invoices.push(...week.invoices);
        for (const a of week.accrualSummaries) accruals.set(a.sourceId, a);
        for (const t of week.tagOptions) if (!tags.has(t.id)) tags.set(t.id, t);
      }
      return {
        bookings,
        invoices,
        accrualSummaries: [...accruals.values()],
        tagOptions: [...tags.values()],
      };
    },
  });
  onDestroy(winCache.dispose);
  /** What the calendar renders: the union of the loaded weeks. */
  const cal = $derived(winCache.data);

  /** The calendar's last reported visible range — what "near the screen" means
   *  for the toolbar's tag filter (kept at page level: it isn't a cache
   *  concern, `window-cache.svelte.ts` tracks its own copy for eviction). */
  let visibleFirst = $state('');
  let visibleLast = $state('');
  /** The calendar settled on a new visible range (and on init). */
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
      if (!week) {
        // These are window-wide lists; merge deduplicates them across buckets.
        week = {
          bookings: [],
          invoices: [],
          accrualSummaries: current.accrualSummaries,
          tagOptions: current.tagOptions,
        };
        out.set(key, week);
      }
      return week;
    };
    for (const booking of current.bookings)
      bucket(instantDateKey(new Date(booking.start), current.orgTz)).bookings.push(booking);
    for (const invoice of current.invoices)
      bucket(instantDateKey(new Date(invoice.at), current.orgTz)).invoices.push(invoice);
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
      // Day's sole visible week is fully covered by its new seed. Other views
      // may retain on-screen weeks outside the refreshed server window. Keep
      // the runway's measured range on a same-route refresh; resetting it to
      // `data.day` would refresh the week the page first loaded instead.
      if (mutationRefresh && current.view !== 'day') winCache.refetchVisible();
    });
  });

  // ── Per-viewer calendar prefs (colour sources, week-days stepper, the
  // invoiced/scheduled split) — `calendar-prefs.svelte.ts` (kit). The 'pos'
  // namespace resolves to the exact keys these shipped with:
  // `hub-pos-calendar-color-block`, `hub-pos-calendar-color-sliver`,
  // `hub-pos-calendar-week-days`, `hub-pos-calendar-split`.
  const prefs = createCalendarPrefs('pos');

  // ── Staff filter — the persisted per-viewer selection SHARED with
  // /scheduling/calendar (`prefs.staff`, one localStorage key), pruned to staff
  // that still exist. Day view draws one column per resource, so it narrows the
  // columns as well as the boxes; week/month, table and board are not
  // resource-aware, so the bookings are filtered too. Empty = all.
  const staff = $derived(knownStaff(prefs.staff, data.resources));
  const staffOptions = $derived(
    data.resources.map((r) => ({ value: r.id, label: r.name, color: r.color ?? undefined })),
  );
  const visibleResources = $derived(
    staff.size === 0 ? data.resources : data.resources.filter((r) => staff.has(r.id)),
  );
  function toggleStaff(id: string) {
    const next = new Set(staff);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    prefs.setStaff([...next]);
  }

  // Toolbar tag filter (own, client and service tags) — session-local, empty = all.
  let tagFilter = $state<Set<string>>(new Set());
  const filtered = $derived(
    cal.bookings.filter(
      (b) =>
        (staff.size === 0 || staff.has(b.resourceId)) &&
        (tagFilter.size === 0 || b.tags?.some((t) => tagFilter.has(t.id))),
    ),
  );
  /** Optimistic status (owner ask 2026-09-29 — "let's try to go optimist on
   *  the UI feedback"): mapped through `mover.statusOf` so a cancel/no-show
   *  paints the calendar and the container's active-member derivation before
   *  the PATCH resolves, reverting on failure. */
  const visibleBookings = $derived(
    filtered.map((b) => ({ ...b, status: mover.statusOf(b.id, b.status) })),
  );

  type Booking = PageData['bookings'][number];

  /** The booking whose detail drawer is open — same surface as /scheduling. */
  // POS capabilities gate this surface (owner 2026-09-20: cashiers schedule
  // unlinked appointments here without a scheduling role); the calls go through
  // /api/pos/appointments*, which the central gate maps to pos:create/edit.
  const canSchedule = $derived(canAct('pos', 'edit') || canAct('pos', 'create'));
  let detailId = $state<string | null>(null);

  /**
   * The focused day per the URL, which the calendar's runway moves with a
   * shallow replace — so it runs AHEAD of `data.day` (the day the last load
   * ran for). Everything that builds a link or a prefilled form reads this;
   * reading `data.day` after a scroll would send the operator back to whatever
   * week the page was loaded on. `settled-day.svelte.ts` (kit) owns the
   * workaround; see its doc comment for why this isn't just `page.url`.
   */
  const settled = createSettledDay({
    pageDay: () => data.day,
    view: () => data.view,
    replaceUrl: (params) => replaceState(`?${params}`, page.state),
  });
  const currentDay = $derived(settled.currentDay);
  const localDay = (iso: string) => instantDateKey(new Date(iso), data.orgTz);
  /** What the filter popover lists: tags on the bookings currently ON SCREEN
   *  (`visibleFirst..visibleLast` is the calendar's visible range, not the
   *  wider loaded window; day view = the day itself) plus the selected ones. */
  const filterTagOptions = $derived(
    visibleTagOptions({
      options: cal.tagOptions,
      bookings: cal.bookings,
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

  /** Where the week runway last settled (HC-016): the grid is unmounted while
   *  Table/Board show, so the page keeps its first visible day + time-axis
   *  offset and hands them back on the next mount. Page-local, never URL or
   *  storage state — `?date=` keeps meaning the settled day. A date
   *  navigation invalidates it (the runway re-anchors on the new day). */
  let calAnchor = $state<CalendarAnchor | undefined>(undefined);

  /** View + focused date live in the URL, so refresh and Back both behave. */
  function navigate(next: { view?: CalendarPageView; date?: string }) {
    if (next.date !== undefined) calAnchor = undefined;
    const params = new URLSearchParams({
      view: next.view ?? data.pageView,
      date: next.date ?? currentDay,
    });
    return goto(`?${params}`, { keepFocus: true, noScroll: true });
  }

  /** The runway settled on a new week: mirror it in `?date=` with a SHALLOW
   *  replace. A `goto` here would re-run the load on every settled scroll —
   *  exactly the latency the runway exists to remove. */
  const replaceDate = settled.replaceDate;

  /** Empty grid space → the create TRAY with the snapped slot prefilled (owner
   *  2026-09-26: no whole new page for this). `/pos/appointments/new` stays a
   *  route for deep links and bookmarks; nothing in the grid navigates to it. */
  function newAt(day: string, time: string, resourceId: string | null) {
    createTarget = { day, time, resourceId };
  }

  /** The create tray's open state IS its prefill: `null` = closed. */
  let createTarget = $state<BookingCreateTarget | null>(null);

  /** Booked in the tray: close, refresh the grid, and settle on the created
   *  day exactly like the standalone route's redirect does. */
  async function onCreated(booking: CreatedBooking) {
    createTarget = null;
    const day = localDay(booking.startTime);
    await refresh();
    if (day !== currentDay) await navigate({ date: day });
  }

  /** One custom-column store for the grid, the table and the board. */
  const customValues = createBookingCustomValues();
  $effect(() => {
    void customValues.load();
  });
  /** Which data view is on: the grid, or the table/board over the same rows. */
  const pageView = $derived(
    data.pageView === 'table' || data.pageView === 'board' ? data.pageView : 'calendar',
  );

  // ── Unscheduled paid services tray (drag onto the grid, or pick a time) ──
  type PendingLine = PageData['pending'][number];
  type PendingDragPayload = {
    line: PendingLine;
    mutationScope: string;
    timeZone: string;
  };
  const mutationScope = $derived(`pos:${page.data.activeOrgId ?? 'unknown'}`);
  const TRAY_KEY = 'hub-pos-unscheduled-tray';
  let trayOpen = $state(true);
  $effect(() => {
    try {
      trayOpen = localStorage.getItem(TRAY_KEY) !== 'closed';
    } catch {
      /* per-viewer convenience only */
    }
  });
  function toggleTray() {
    trayOpen = !trayOpen;
    try {
      localStorage.setItem(TRAY_KEY, trayOpen ? 'open' : 'closed');
    } catch {
      /* ignore */
    }
  }
  function startLineDrag(e: DragEvent, p: PendingLine) {
    e.dataTransfer?.setData(
      CALENDAR_DROP_MIME,
      JSON.stringify({ line: p, mutationScope, timeZone: data.orgTz } satisfies PendingDragPayload),
    );
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  }
  /** Fall back to the create tray, carrying the ticket line (so the book still
   *  stamps its `booking_id`) PLUS the customer and — when exactly one active
   *  event type sells the line's product — the resolved service, so the tray
   *  opens on the slot grid instead of re-asking for facts already settled by
   *  the sale (owner bug 2026-10-10: it was opening completely empty). */
  function pickTime(
    p: PendingLine,
    day = currentDay,
    time?: string,
    resourceId?: string | null,
    eventTypeId: string | null = null,
  ) {
    createTarget = {
      day,
      time,
      resourceId,
      ticketId: p.ticketId,
      lineId: p.lineId,
      partyId: p.partyId,
      customerName: p.customerName,
      eventTypeId,
    };
  }
  /** Tray cards grouped by customer so many pending procedures for one client
   *  collapse to one expandable card instead of flooding the scroller. */
  const pendingGroups = $derived(groupPendingLines(data.pending));
  /** Group keys the viewer has expanded — session-only, collapsed by default. */
  let expandedGroups = $state<Set<string>>(new Set());
  function toggleGroup(key: string) {
    const next = new Set(expandedGroups);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandedGroups = next;
  }
  /** Book a pending line straight into a slot when its product maps to
   *  exactly ONE active service; otherwise (ambiguous, or the slot turns out
   *  taken) fall through to the prefilled tray. Shared by the tray's drag and
   *  click-to-pick gestures — the only thing that differs between them is how
   *  `day`/`time`/`resourceId` were decided. */
  async function scheduleLine(
    p: PendingLine,
    day: string,
    time: string,
    resourceId: string | null,
  ) {
    const matches = matchEventTypes(p, data.eventTypes);
    if (matches.length !== 1) {
      pickTime(p, day, time, resourceId, null);
      return;
    }
    const [hour, minute] = time.split(':').map(Number);
    const start = resolveCalendarInstant(day, hour * 60 + minute, data.orgTz);
    if (!start.ok) {
      toastError(start.kind === 'nonexistent' ? m.cal_time_nonexistent() : m.cal_time_invalid());
      return;
    }
    const res = await fetch(`/api/pos/tickets/${p.ticketId}/schedule`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        lineId: p.lineId,
        eventTypeId: matches[0].id,
        start: start.instant.toISOString(),
        resourceId,
        attendeeName: p.customerName,
        partyId: p.partyId,
        crmContactId: p.crmContactId,
      }),
    });
    if (res.status === 409) {
      toastError(m.pos_appt_drop_conflict());
      pickTime(p, day, time, resourceId, matches[0].id);
      return;
    }
    if (!res.ok) {
      toastError(m.sched_move_failed(), `HTTP ${res.status}`);
      return;
    }
    toastSuccess(m.pos_appt_scheduled());
    await refresh();
  }
  /** Drag onto the calendar: the gesture settles day/time/resourceId, the
   *  scope guard is drag-specific (the payload was serialized at `dragstart`,
   *  which can race an org/timezone switch), then the rest is shared. */
  async function dropLine(payload: string, day: string, time: string, resourceId: string | null) {
    const drag = JSON.parse(payload) as PendingDragPayload;
    if (drag.mutationScope !== mutationScope || drag.timeZone !== data.orgTz) {
      toastError(m.cal_gesture_scope_changed());
      return;
    }
    await scheduleLine(drag.line, day, time, resourceId);
  }
  /** Click-to-pick (owner 2026-10-10: "click opens a date/time picker"): the
   *  create tray IS the app's date/time picker (availability-aware slot
   *  picker), now prefilled with the line's customer and service, so a click
   *  opens it rather than a second, availability-blind picker. */
  function clickPick(p: PendingLine) {
    const matches = matchEventTypes(p, data.eventTypes);
    pickTime(p, currentDay, undefined, null, matches.length === 1 ? matches[0].id : null);
  }
  function onCardKeydown(e: KeyboardEvent, p: PendingLine) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      clickPick(p);
    }
  }

  /** Everything a calendar drag can commit — `booking-mover.ts` (kit); see its
   *  doc comment for the plain/mergeWith/detach/group routing and why a 409
   *  isn't toasted here (the conflicts go back to the calendar's own dialog). */
  const mover = createBookingMover({
    apiBase: '/api/pos/appointments',
    onError: (detail) => toastError(m.sched_move_failed(), detail),
    refresh,
  });

  const accrualBySource = $derived(new Map(cal.accrualSummaries.map((s) => [s.sourceId, s])));

  // ── Complete → confirm consumption. `ConsumptionConfirmDialog` owns the
  //    accrual/defaults reads, the editable rows and the POST; this page only
  //    remembers which booking is open and the per-booking stock warning.
  let completeFor = $state<{ id: string; productId: string | null } | null>(null);
  let stockWarnings = $state<Record<string, string>>({}); // bookingId → message

  async function afterComplete(id: string, result: CompleteResult) {
    if (result.stockWarning)
      stockWarnings = { ...stockWarnings, [id]: result.stockWarning.message };
    else {
      const next = { ...stockWarnings };
      delete next[id];
      stockWarnings = next;
    }
    await refresh();
  }

  // ── Booking → charge handoff (Fresha-style checkout) ── writes the completed
  // booking to a consume-once key and lands on /pos/sell with the cart
  // pre-filled (service line rides pos_ticket_lines.bookingId).
  function chargeBooking(event: PayableEvent, planId: string | null = null) {
    dispatchSellChargeHandoff({
      storage: () => localStorage,
      identity: {
        actorId: page.data.user.id,
        orgId: page.data.activeOrgId ?? '',
      },
      input: {
        // One line per service the tray offered. A visit member carries no
        // product of its own, so the event type's catalog product prices it —
        // the same lookup the single-booking charge always did.
        lines: event.lines.map((l) => {
          const et = data.eventTypes.find((e) => e.id === l.eventTypeId);
          return {
            bookingId: l.bookingId,
            productId: l.productId ?? et?.productId ?? null,
            title: l.title || (et?.title ?? ''),
          };
        }),
        partyId: event.partyId,
        customerName: event.booking.attendeeName ?? null,
        phone: event.booking.attendeePhone ?? null,
        // An instalment plan already covers the treatment → the till charges
        // the next instalment, not the full price again.
        planId,
      },
      navigate: () => void goto('/pos/sell'),
      onStorageFailure: () => toastError(m.pos_booking_handoff_storage_failed()),
    });
  }

  /** The calendar's own per-box Charge: one booking, its one service. */
  function chargeOne(b: Booking) {
    chargeBooking({
      booking: b,
      partyId: b.partyId ?? null,
      lines: [
        { bookingId: b.id, productId: b.productId ?? null, eventTypeId: b.eventTypeId, title: '' },
      ],
    });
  }
</script>

<svelte:head><title>{m.pos_nav_appointments()} · {m.nav_pos()}</title></svelte:head>

<PageShell
  archetype="collection"
  scroll="region"
  labelledBy="pos-appointments-title"
  class="pos-appointments-surface"
>
  <PageHeader titleId="pos-appointments-title" title={m.pos_nav_appointments()}>
    {#snippet leading()}
      <CalendarDays size={iconSizes.md} class="text-accent shrink-0" />
    {/snippet}
    {#snippet primaryActions()}
      <!-- "New checkup" folded into this single button (owner: both accomplished
           the same task) — checkup is now a same-page choice on the new-appointment
           form, shown once the picked customer has paid treatment history. -->
      <Button
        size="sm"
        onclick={() => (createTarget = { day: currentDay })}
        disabled={data.eventTypes.length === 0 || !canSchedule}
        title={canSchedule ? undefined : m.no_permission()}
      >
        <Plus size={iconSizes.sm} />
        {m.pos_appt_new()}
      </Button>
    {/snippet}
  </PageHeader>

  {#if data.pending.length > 0 && canSchedule}
    <section
      class="tray"
      aria-label={m.pos_appt_unscheduled({ count: String(data.pending.length) })}
    >
      <div class="tray-head">
        <Button
          variant="ghost"
          size="sm"
          class="tray-toggle"
          aria-expanded={trayOpen}
          onclick={toggleTray}
        >
          {#if trayOpen}<ChevronDown size={iconSizes.sm} />{:else}<ChevronRight
              size={iconSizes.sm}
            />{/if}
          {m.pos_appt_unscheduled({ count: String(data.pending.length) })}
        </Button>
        {#if trayOpen}<span class="t-caption">{m.pos_appt_unscheduled_hint()}</span>{/if}
      </div>
      {#if trayOpen}
        {#snippet trayItem(p: PendingLine)}
          <div
            class="tray-item"
            role="listitem"
            draggable="true"
            ondragstart={(e) => startLineDrag(e, p)}
          >
            <!-- The whole card is the click target (owner 2026-10-10: "2
               interactions: click opens a date/time picker; dragging...").
               `role=button` lives on this inner row, not the outer
               `role=listitem` draggable wrapper, so the two semantics don't
               collide. -->
            <div
              class="tray-item-hit"
              role="button"
              tabindex="0"
              aria-haspopup="dialog"
              onclick={() => clickPick(p)}
              onkeydown={(e) => onCardKeydown(e, p)}
            >
              <GripVertical size={iconSizes.sm} class="tray-grip" />
              <span class="tray-text">
                <span class="tray-title truncate">{p.description}</span>
                <span class="t-caption truncate">
                  {p.customerName ?? '—'}
                  {#if p.ticketHumanId}· #{p.ticketHumanId}{/if}
                  · {formatDate(p.submittedAt, {
                    day: 'numeric',
                    month: 'short',
                    timeZone: data.orgTz,
                  })}
                </span>
              </span>
            </div>
          </div>
        {/snippet}
        <div class="tray-items" role="list">
          {#each pendingGroups as g (g.key)}
            {#if g.lines.length === 1}
              {@render trayItem(g.lines[0])}
            {:else}
              <div class="tray-group" role="listitem">
                <Button
                  variant="ghost"
                  size="sm"
                  class="tray-group-toggle"
                  aria-expanded={expandedGroups.has(g.key)}
                  onclick={() => toggleGroup(g.key)}
                >
                  {#if expandedGroups.has(g.key)}<ChevronDown
                      size={iconSizes.sm}
                    />{:else}<ChevronRight size={iconSizes.sm} />{/if}
                  <span class="tray-group-name truncate">{g.customerName ?? '—'}</span>
                  <Badge size="sm"
                    >{m.pos_appt_group_count({ count: String(g.lines.length) })}</Badge
                  >
                </Button>
                {#if expandedGroups.has(g.key)}
                  {#each g.lines as p (p.lineId)}
                    {@render trayItem(p)}
                  {/each}
                {/if}
              </div>
            {/if}
          {/each}
        </div>
      {/if}
    </section>
  {/if}

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
            scopeKey="pos:scheduling.bookings"
            onopen={(id) => (detailId = id)}
            canEdit={canSchedule}
            onstatus={canSchedule ? mover.setStatus : undefined}
            onvisitstatus={canSchedule ? mover.setVisitStatus : undefined}
            onstaff={canSchedule ? mover.moveBooking : undefined}
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
            onstatus={canSchedule ? mover.setStatus : undefined}
            onvisitstatus={canSchedule ? mover.setVisitStatus : undefined}
            onstaff={canSchedule ? mover.moveBooking : undefined}
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
          blockColorBy={prefs.blockColorBy}
          sliverColorBy={prefs.sliverColorBy}
          oncolorby={prefs.setColorBy}
          onview={(view, date) => navigate({ view, date })}
          ondate={(date, opts) => (opts?.silent ? replaceDate(date) : navigate({ date }))}
          onrange={onRange}
          anchor={calAnchor}
          onanchor={(a) => (calAnchor = a)}
          busy={winCache.busy}
          windows={winCache.windows}
          onwindowretry={winCache.retry}
          weekDays={prefs.weekDays}
          onweekdays={prefs.setWeekDays}
          pxPerHour={prefs.pxPerHour}
          onpxperhour={prefs.setPxPerHour}
          subBy={prefs.subBy}
          onsubby={prefs.setSubBy}
          {customValues}
          onopen={(id) => (detailId = id)}
          onslot={newAt}
          hours={data.hours}
          onmove={canSchedule ? mover.moveBooking : undefined}
          onreorder={canSchedule ? mover.reorderVisit : undefined}
          ondropexternal={canSchedule ? dropLine : undefined}
          invoices={cal.invoices}
          split={prefs.split}
          onsplit={prefs.setSplit}
        >
          {#snippet toolbarStart()}{@render switcher()}{/snippet}
          {#snippet tools()}
            <MultiSelectFilter
              class="cal-staff-filter"
              label={m.sched_cal_staff()}
              options={staffOptions}
              selected={staff}
              onToggle={toggleStaff}
              onClear={() => prefs.setStaff([])}
              allLabel={m.sched_cal_all_staff()}
            />
            <TagFilter
              scope="event"
              tags={filterTagOptions}
              selected={tagFilter}
              onselect={(next) => (tagFilter = next)}
              ontagschange={() => refresh()}
            />
          {/snippet}
          <!-- POS-only extras. The grid, hover card, views and navigation are shared. -->
          {#snippet chips(b)}
            {@const acc = accrualBySource.get(b.id)}
            {#if acc}
              {#if acc.open > 0}
                <Badge variant="semantic" value="warning" size="sm"
                  >{m.sched_stock_committed({ value: formatMoney(acc.estValue) })}</Badge
                >
              {:else if acc.realized > 0}
                <a
                  href={acc.realizedEntryId ? `/stock/entries/${acc.realizedEntryId}` : '/stock'}
                  class="no-underline"
                >
                  <Badge variant="semantic" value="success" size="sm"
                    >{m.sched_stock_realized({ value: formatMoney(acc.realizedValue) })}</Badge
                  >
                </a>
              {:else}
                <Badge size="sm">{m.sched_stock_released()}</Badge>
              {/if}
            {/if}
            {#if stockWarnings[b.id]}
              <span class="t-caption warn">
                {stockWarnings[b.id]}
                <Button
                  variant="ghost"
                  size="sm"
                  onclick={() => (completeFor = { id: b.id, productId: b.productId ?? null })}
                  >{m.sched_stock_retry_post()}</Button
                >
              </span>
            {/if}
          {/snippet}

          <!-- PATCH/complete live under /api/scheduling → gated centrally by
         scheduling:edit, not pos:edit — gate on that capability here too. -->
          {#snippet actions(b)}
            {#if b.status === 'completed' && canAct('pos', 'edit')}
              <Button variant="outline" size="sm" onclick={() => chargeOne(b as Booking)}>
                <ShoppingCart size={iconSizes.sm} />
                {m.pos_appt_charge()}
              </Button>
            {/if}
            {#if b.status === 'accepted' || b.status === 'pending'}
              <span
                class="hc-act"
                data-tip={canSchedule ? m.sched_mark_complete() : m.no_permission()}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={m.sched_mark_complete()}
                  disabled={!canSchedule}
                  onclick={() => (completeFor = { id: b.id, productId: b.productId ?? null })}
                >
                  <Check size={iconSizes.sm} />
                </Button>
              </span>
              <span
                class="hc-act"
                data-tip={canSchedule ? m.sched_mark_noShow() : m.no_permission()}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={m.sched_mark_noShow()}
                  disabled={!canSchedule || mover.pending(b.id)}
                  loading={mover.pending(b.id)}
                  onclick={() => mover.setStatus(b.id, 'no_show')}
                >
                  <UserX size={iconSizes.sm} />
                </Button>
              </span>
              <span
                class="hc-act"
                data-tip={canSchedule ? m.sched_cancel_booking() : m.no_permission()}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={m.sched_cancel_booking()}
                  disabled={!canSchedule || mover.pending(b.id)}
                  loading={mover.pending(b.id)}
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
</PageShell>

<BookingDetailDrawer
  bookingId={detailId}
  apiBase="/api/pos/appointments"
  canEdit={canSchedule}
  onclose={() => (detailId = null)}
  onchanged={() => refresh()}
  onnavigate={(id) => (detailId = id)}
  resources={data.resources}
  timeZone={data.orgTz}
  {mutationScope}
  onpay={canAct('pos', 'edit') ? chargeBooking : undefined}
/>

<BookingCreateDrawer
  target={createTarget}
  eventTypes={data.eventTypes}
  resources={data.resources}
  timeZone={data.orgTz}
  {mutationScope}
  onclose={() => (createTarget = null)}
  onbooked={onCreated}
/>

<ConsumptionConfirmDialog
  bookingId={completeFor?.id ?? null}
  productId={completeFor?.productId ?? null}
  apiBase="/api/pos/appointments"
  onclose={() => (completeFor = null)}
  oncompleted={(result) => afterComplete(completeFor?.id ?? '', result)}
/>

<style>
  .dv-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-bottom: var(--space-2);
  }
  .tray {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-4);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface-1);
  }
  .tray-head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .tray-head :global(.tray-toggle) {
    padding-inline: var(--space-1);
  }
  .tray-items {
    display: flex;
    gap: var(--space-2);
    overflow-x: auto;
    padding-bottom: var(--space-1);
    scrollbar-width: thin;
  }
  .tray-item {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    width: 16rem;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    cursor: grab;
  }
  .tray-item:active {
    cursor: grabbing;
  }
  .tray-item-hit {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    border-radius: var(--radius-sm);
    outline: none;
  }
  .tray-item-hit:focus-visible {
    box-shadow: var(--shadow-focus);
  }
  .tray-item :global(.tray-grip) {
    color: var(--color-text-tertiary);
    flex-shrink: 0;
  }
  .tray-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }
  .tray-title {
    font-size: var(--font-size-body);
    color: var(--color-text-primary);
  }
  .tray-group {
    flex-shrink: 0;
    width: 16rem;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .tray-group :global(.tray-group-toggle) {
    width: 100%;
    justify-content: flex-start;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    padding-inline: var(--space-2);
  }
  .tray-group :global(.tray-group-toggle > span) {
    width: 100%;
  }
  .tray-group-name {
    flex: 1;
    min-width: 0;
    text-align: left;
    color: var(--color-text-primary);
  }
  .warn {
    color: var(--color-danger-fg);
  }
</style>
