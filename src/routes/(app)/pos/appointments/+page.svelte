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
  import { untrack } from 'svelte';
  import { invalidate, goto, replaceState } from '$lib/navigation';
  import { page } from '$app/state';
  import { PageHeader, Button, Badge, iconSizes } from '$lib/components/ui';
  import { PageShell } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import ConsumptionConfirmDialog from '$lib/components/scheduling/ConsumptionConfirmDialog.svelte';
  import type { CompleteResult } from '$lib/components/scheduling/consumption-lines';
  import BookingCalendar, {
    CALENDAR_DROP_MIME,
    WEEK_DAYS_MIN,
    WEEK_DAYS_MAX,
  } from '$lib/components/scheduling/BookingCalendar.svelte';
  import BookingDetailDrawer from '$lib/components/scheduling/BookingDetailDrawer.svelte';
  import TagFilter from '$lib/components/tags/TagFilter.svelte';
  import { calendarLoadDays, type CalendarView } from '$lib/components/scheduling/calendar-window';
  import { dayAt, mondayOf } from '$lib/components/scheduling/runway';
  import type {
    MoveConflict,
    MoveOpts,
    MoveResult,
  } from '$lib/components/scheduling/move-conflict';
  import {
    DEFAULT_BLOCK_SOURCE,
    DEFAULT_SLIVER_SOURCE,
    parseColorSource,
    type ColorSource,
  } from '$lib/components/scheduling/booking-color';
  import { canAct } from '$lib/access/can.svelte';
  import { formatDate, formatMoney } from '$lib/utils/format';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
  import { groupPendingLines } from '$lib/components/pos/pending-groups';

  let { data }: { data: PageData } = $props();

  /** Every booking mutation here can move a sold line between "pending" and
   *  "scheduled" (book, cancel, no-show, drawer edits), so the /pos layout's
   *  Accounts badge (`pos:pending`) refreshes together with the grid. */
  async function refresh(): Promise<void> {
    await Promise.all([invalidate('pos:appointments'), invalidate('pos:pending')]);
  }

  // ── Week cache for the calendar's infinite scrolling ──────────────────────
  // The runway scrolls through a year without navigating, so the grid's data
  // can't be "whatever the last load fetched" any more. The page keeps one
  // payload per ISO week: the SSR load seeds the 4 weeks it covers, the
  // calendar's `onrange` fetches the missing neighbours through
  // `GET /api/pos/appointments`, and weeks far from the screen are dropped so
  // an hour of scrolling can't grow the tab without bound.
  type WindowPayload = Pick<PageData, 'bookings' | 'invoices' | 'accrualSummaries' | 'tagOptions'>;
  /** Weeks kept either side of the visible range. */
  const WEEK_KEEP = 4;
  /** Local calendar day of an instant — same browser-wall-clock policy (and the
   *  same `en-CA` trick as `todayIn`) the calendar places boxes with, so a week
   *  bucket here holds exactly the boxes that week's columns show. */
  const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA');
  const weekEnd = (monday: string) => dayAt(monday, 6);

  /** The load's own window, split per ISO week. DERIVED, not stored: after any
   *  mutation's `refresh()` these weeks are simply fresh again. */
  const seededWeeks = $derived.by(() => {
    const out = new Map<string, WindowPayload>();
    const bucket = (day: string) => {
      const key = mondayOf(day);
      let week = out.get(key);
      if (!week) {
        // `accrualSummaries`/`tagOptions` are window-wide lists rather than
        // per-day rows, and the union below dedups them by id — so each seeded
        // week just carries the load's.
        week = {
          bookings: [],
          invoices: [],
          accrualSummaries: data.accrualSummaries,
          tagOptions: data.tagOptions,
        };
        out.set(key, week);
      }
      return week;
    };
    // Every covered week needs a KEY even when it holds nothing, or an empty
    // week would be refetched on every settle forever.
    for (const d of calendarLoadDays(data.day, data.view)) bucket(d);
    for (const b of data.bookings) bucket(dayOf(b.start)).bookings.push(b);
    for (const i of data.invoices) bucket(dayOf(i.at)).invoices.push(i);
    return out;
  });
  let fetchedWeeks = $state(new Map<string, WindowPayload>());
  /** Loaded weeks, the SSR payload winning over an older fetch of the same week. */
  const weeks = $derived.by(() => {
    const out = new Map(fetchedWeeks);
    for (const [key, week] of seededWeeks) out.set(key, week);
    return out;
  });
  /** What the calendar renders: the union of the loaded weeks. */
  const cal = $derived.by(() => {
    const bookings: WindowPayload['bookings'] = [];
    const invoices: WindowPayload['invoices'] = [];
    const accruals = new Map<string, WindowPayload['accrualSummaries'][number]>();
    const tags = new Map<string, WindowPayload['tagOptions'][number]>();
    for (const week of weeks.values()) {
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
  });

  /** In-flight week keys — plain `Set` (never rendered); `busyCount` is the
   *  reactive projection the toolbar's spinner reads. */
  const inflight = new Set<string>();
  let busyCount = $state(0);
  /** The calendar's last reported visible range — what "near the screen" means
   *  for prefetching, eviction and post-mutation refetching. */
  let visibleFirst = '';
  let visibleLast = '';

  /** `W(first) − pad … W(last) + pad`, as ISO Mondays. */
  function weekKeysAround(first: string, last: string, pad = 1): string[] {
    const to = dayAt(mondayOf(last), 7 * pad);
    const keys: string[] = [];
    for (let key = dayAt(mondayOf(first), -7 * pad); key <= to; key = dayAt(key, 7)) keys.push(key);
    return keys;
  }
  async function fetchWeek(key: string) {
    inflight.add(key);
    busyCount = inflight.size;
    try {
      const res = await fetch(`/api/pos/appointments?from=${key}&to=${weekEnd(key)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fetchedWeeks = new Map(fetchedWeeks).set(key, (await res.json()) as WindowPayload);
    } catch (e) {
      // A week that fails to load is a HOLE in the grid (it would otherwise
      // render as a genuinely empty week), so it is worth a toast. The key
      // stays unloaded, so the next settle over it retries.
      // TODO(handoff): "retries on the next settle" means a week that failed
      // while it is ON SCREEN keeps rendering as empty until the operator
      // scrolls again — there is no per-week error state or retry affordance in
      // the grid. Needs a `failed` set the calendar can render a per-column
      // retry strip from. Ledger:
      // proposals/2026-09-25-hub-pos-calendar-color-followups.md.
      toastError(m.sched_cal_load_error(), e instanceof Error ? e.message : undefined);
    } finally {
      inflight.delete(key);
      busyCount = inflight.size;
    }
  }
  function loadMissing(first: string, last: string) {
    for (const key of weekKeysAround(first, last))
      if (!weeks.has(key) && !inflight.has(key)) void fetchWeek(key);
  }
  /** The calendar settled on a new visible range (and on init). */
  function onRange(first: string, last: string) {
    visibleFirst = first;
    visibleLast = last;
    // `untrack`: the calendar emits this from an effect of its own, so reading
    // `weeks` here would subscribe THAT effect to the cache it then writes to.
    untrack(() => {
      loadMissing(first, last);
      const min = dayAt(mondayOf(first), -7 * WEEK_KEEP);
      const max = dayAt(mondayOf(last), 7 * WEEK_KEEP);
      const keep = new Map([...fetchedWeeks].filter(([key]) => key >= min && key <= max));
      if (keep.size !== fetchedWeeks.size) fetchedWeeks = keep;
    });
  }
  // A mutation's `refresh()` re-runs the load, which covers 4 weeks around
  // `?date` — every OTHER week on screen is stale the moment it lands (a box
  // may have been dragged into or out of it), so those refetch. Overwrite on
  // arrival rather than dropping first: no week blinks empty.
  $effect(() => {
    void data;
    untrack(() => {
      if (data.view === 'day' || !visibleFirst) return;
      for (const key of weekKeysAround(visibleFirst, visibleLast))
        if (!seededWeeks.has(key) && !inflight.has(key)) void fetchWeek(key);
    });
  });

  // Toolbar tag filter (own, client and service tags) — session-local, empty = all.
  let tagFilter = $state<Set<string>>(new Set());
  const visibleBookings = $derived(
    tagFilter.size === 0
      ? cal.bookings
      : cal.bookings.filter((b) => b.tags?.some((t) => tagFilter.has(t.id))),
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
   * week the page was loaded on.
   */
  // Own state rather than `page.url`: a shallow `replaceState` did not turn
  // over `page.url.searchParams` reliably (a Day switch after five scrolled
  // weeks went to the LOADED day), so the settled day is kept here and
  // re-seeded whenever a real load lands.
  let settledDay = $state<string | null>(null);
  $effect(() => {
    void data.day;
    settledDay = null;
  });
  const currentDay = $derived(settledDay ?? data.day);

  /** View + focused date live in the URL, so refresh and Back both behave. */
  function navigate(next: { view?: CalendarView; date?: string }) {
    const params = new URLSearchParams({
      view: next.view ?? data.view,
      date: next.date ?? currentDay,
    });
    return goto(`?${params}`, { keepFocus: true, noScroll: true });
  }

  /** The runway settled on a new week: mirror it in `?date=` with a SHALLOW
   *  replace. A `goto` here would re-run the load on every settled scroll —
   *  exactly the latency the runway exists to remove. */
  function replaceDate(day: string) {
    settledDay = day;
    const params = new URLSearchParams({ view: data.view, date: day });
    replaceState(`?${params}`, page.state);
  }

  /** Empty grid space → the new-appointment PAGE with the slot prefilled. */
  function newAt(day: string, time: string, resourceId: string | null) {
    const params = new URLSearchParams({ date: day, time, view: data.view });
    if (resourceId) params.set('resourceId', resourceId);
    return goto(`/pos/appointments/new?${params}`);
  }

  // ── Invoiced | Scheduled split (per viewer) ──
  const SPLIT_KEY = 'hub-pos-calendar-split';
  let split = $state(false);
  $effect(() => {
    try {
      split = localStorage.getItem(SPLIT_KEY) === '1';
    } catch {
      /* per-viewer convenience only */
    }
  });
  function setSplit(v: boolean) {
    split = v;
    try {
      localStorage.setItem(SPLIT_KEY, v ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  // ── Week view columns per screen (per viewer) ── the kebab's "Days per
  // screen" stepper; day/month views ignore it.
  const WEEK_DAYS_KEY = 'hub-pos-calendar-week-days';
  let weekDays = $state(7);
  $effect(() => {
    try {
      const stored = Number(localStorage.getItem(WEEK_DAYS_KEY));
      if (Number.isInteger(stored) && stored >= WEEK_DAYS_MIN && stored <= WEEK_DAYS_MAX)
        weekDays = stored;
    } catch {
      /* per-viewer convenience only */
    }
  });
  function setWeekDays(n: number) {
    weekDays = n;
    try {
      localStorage.setItem(WEEK_DAYS_KEY, String(n));
    } catch {
      /* ignore */
    }
  }

  // ── Interchangeable event colouring (per viewer) ── which select-type column
  // paints the box background and which paints its left sliver.
  const BLOCK_COLOR_KEY = 'hub-pos-calendar-color-block';
  const SLIVER_COLOR_KEY = 'hub-pos-calendar-color-sliver';
  let blockColorBy = $state<ColorSource>(DEFAULT_BLOCK_SOURCE);
  let sliverColorBy = $state<ColorSource>(DEFAULT_SLIVER_SOURCE);
  $effect(() => {
    try {
      blockColorBy = parseColorSource(localStorage.getItem(BLOCK_COLOR_KEY), DEFAULT_BLOCK_SOURCE);
      sliverColorBy = parseColorSource(
        localStorage.getItem(SLIVER_COLOR_KEY),
        DEFAULT_SLIVER_SOURCE,
      );
    } catch {
      /* per-viewer convenience only */
    }
  });
  function setColorBy(next: { block: ColorSource; sliver: ColorSource }) {
    blockColorBy = next.block;
    sliverColorBy = next.sliver;
    try {
      localStorage.setItem(BLOCK_COLOR_KEY, next.block);
      localStorage.setItem(SLIVER_COLOR_KEY, next.sliver);
    } catch {
      /* ignore */
    }
  }

  // ── Unscheduled paid services tray (drag onto the grid, or pick a time) ──
  type PendingLine = PageData['pending'][number];
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
    e.dataTransfer?.setData(CALENDAR_DROP_MIME, JSON.stringify(p));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  }
  function pickTimeHref(
    p: PendingLine,
    day = currentDay,
    time?: string,
    resourceId?: string | null,
  ) {
    const params = new URLSearchParams({
      ticketId: p.ticketId,
      lineId: p.lineId,
      date: day,
      view: data.view,
    });
    if (time) params.set('time', time);
    if (resourceId) params.set('resourceId', resourceId);
    return `/pos/appointments/new?${params}`;
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
  /** Drop → book the line straight into the slot when its product maps to ONE
   *  service; otherwise (or on a conflict) fall through to the form, prefilled. */
  async function dropLine(payload: string, day: string, time: string, resourceId: string | null) {
    const p = JSON.parse(payload) as PendingLine;
    const matches = data.eventTypes.filter((e) => e.active && e.productId === p.finProductId);
    if (!p.finProductId || matches.length !== 1) {
      await goto(pickTimeHref(p, day, time, resourceId));
      return;
    }
    const res = await fetch(`/api/pos/tickets/${p.ticketId}/schedule`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        lineId: p.lineId,
        eventTypeId: matches[0].id,
        start: new Date(`${day}T${time}:00`).toISOString(),
        resourceId,
        attendeeName: p.customerName,
        partyId: p.partyId,
        crmContactId: p.crmContactId,
      }),
    });
    if (res.status === 409) {
      toastError(m.pos_appt_drop_conflict());
      await goto(pickTimeHref(p, day, time, resourceId));
      return;
    }
    if (!res.ok) {
      toastError(m.sched_move_failed(), `HTTP ${res.status}`);
      return;
    }
    toastSuccess(m.pos_appt_scheduled());
    await refresh();
  }

  /**
   * Everything a calendar drag can commit, on ONE function (the calendar owns
   * the dialogs that produce `opts`):
   *   plain / overrideConflicts → PATCH the booking (server re-runs the
   *     buffer-padded conflict check and answers 409 with the clashes)
   *   mergeWith → join that booking's visit (back-to-back, one block)
   *   detach    → leave the visit, keeping the time
   *
   * A 409 is NOT toasted any more: the conflicts go back to the calendar, which
   * names them in a dialog offering "Move anyway" / "Pick another time" /
   * "Merge". Nothing needs reverting — the boxes render from this load's list,
   * so a refused move never left its slot.
   */
  async function moveBooking(
    id: string,
    next: { start: string; end: string; resourceId: string },
    opts?: MoveOpts,
  ): Promise<MoveResult | void> {
    // Three of the four shapes are visit work and go to `/group` as ONE POST;
    // only a plain single-booking reschedule is a PATCH on the booking itself.
    // `group` in particular must not fan out into per-member PATCHes: the
    // container is a shared window, so the whole visit moves in one transaction
    // behind one conflict check.
    const override = opts?.overrideConflicts ? { overrideConflicts: true } : {};
    const groupBody =
      opts?.mergeWith !== undefined
        ? { withId: opts.mergeWith }
        : opts?.detach
          ? { detach: true, ...override }
          : opts?.group
            ? { move: next, ...override }
            : null;
    const res = await fetch(
      groupBody ? `/api/pos/appointments/${id}/group` : `/api/pos/appointments/${id}`,
      {
        method: groupBody ? 'POST' : 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(groupBody ?? { ...next, ...override }),
      },
    );
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        conflicts?: MoveConflict[];
      };
      if (res.status === 409 && j.conflicts?.length) return { conflicts: j.conflicts };
      toastError(m.sched_move_failed(), j.message ?? `HTTP ${res.status}`);
    }
    await refresh();
  }

  async function setStatus(id: string, status: string) {
    await fetch(`/api/pos/appointments/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    await refresh();
  }

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
  function chargeBooking(
    b: Pick<
      Booking,
      'id' | 'eventTypeId' | 'productId' | 'partyId' | 'attendeeName' | 'attendeePhone'
    >,
    planId: string | null = null,
  ) {
    const et = data.eventTypes.find((e) => e.id === b.eventTypeId);
    localStorage.setItem(
      `pos-charge-${page.data.activeOrgId ?? 'default'}`,
      JSON.stringify({
        bookingId: b.id,
        productId: b.productId ?? et?.productId ?? null,
        partyId: b.partyId ?? null,
        customerName: b.attendeeName ?? null,
        phone: b.attendeePhone ?? null,
        // An instalment plan already covers the treatment → the till charges
        // the next instalment, not the full price again.
        planId,
      }),
    );
    goto('/pos/sell');
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
        href="/pos/appointments/new?date={currentDay}&view={data.view}"
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
            <GripVertical size={iconSizes.sm} class="tray-grip" />
            <span class="tray-text">
              <span class="tray-title truncate">{p.description}</span>
              <span class="t-caption truncate">
                {p.customerName ?? '—'}
                {#if p.ticketHumanId}· #{p.ticketHumanId}{/if}
                · {formatDate(p.submittedAt, { day: 'numeric', month: 'short' })}
              </span>
            </span>
            <Button size="xs" variant="outline" href={pickTimeHref(p)}
              >{m.pos_appt_schedule_pick()}</Button
            >
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

  <BookingCalendar
    view={data.view}
    date={currentDay}
    bookings={visibleBookings}
    resources={data.resources}
    eventTypes={data.eventTypes}
    kinds={data.kinds}
    tagOptions={cal.tagOptions}
    categories={data.categories}
    {blockColorBy}
    {sliverColorBy}
    oncolorby={setColorBy}
    onview={(view, date) => navigate({ view, date })}
    ondate={(date, opts) => (opts?.silent ? replaceDate(date) : navigate({ date }))}
    onrange={onRange}
    busy={busyCount > 0}
    {weekDays}
    onweekdays={setWeekDays}
    onopen={(id) => (detailId = id)}
    onslot={newAt}
    hours={data.hours}
    onmove={canSchedule ? moveBooking : undefined}
    ondropexternal={canSchedule ? dropLine : undefined}
    invoices={cal.invoices}
    {split}
    onsplit={setSplit}
  >
    {#snippet tools()}
      <TagFilter
        scope="event"
        tags={cal.tagOptions}
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
        <Button variant="outline" size="sm" onclick={() => chargeBooking(b as Booking)}>
          <ShoppingCart size={iconSizes.sm} />
          {m.pos_appt_charge()}
        </Button>
      {/if}
      {#if b.status === 'accepted' || b.status === 'pending'}
        <span class="hc-act" data-tip={canSchedule ? m.sched_mark_complete() : m.no_permission()}>
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
        <span class="hc-act" data-tip={canSchedule ? m.sched_mark_noShow() : m.no_permission()}>
          <Button
            variant="ghost"
            size="sm"
            aria-label={m.sched_mark_noShow()}
            disabled={!canSchedule}
            onclick={() => setStatus(b.id, 'no_show')}
          >
            <UserX size={iconSizes.sm} />
          </Button>
        </span>
        <span class="hc-act" data-tip={canSchedule ? m.sched_cancel_booking() : m.no_permission()}>
          <Button
            variant="ghost"
            size="sm"
            aria-label={m.sched_cancel_booking()}
            disabled={!canSchedule}
            onclick={() => setStatus(b.id, 'cancelled')}
          >
            <X size={iconSizes.sm} />
          </Button>
        </span>
      {/if}
    {/snippet}
  </BookingCalendar>
</PageShell>

<BookingDetailDrawer
  bookingId={detailId}
  apiBase="/api/pos/appointments"
  canEdit={canSchedule}
  onclose={() => (detailId = null)}
  onchanged={() => refresh()}
  onnavigate={(id) => (detailId = id)}
  resources={data.resources}
  onpay={canAct('pos', 'edit') ? chargeBooking : undefined}
/>

<ConsumptionConfirmDialog
  bookingId={completeFor?.id ?? null}
  productId={completeFor?.productId ?? null}
  apiBase="/api/pos/appointments"
  onclose={() => (completeFor = null)}
  oncompleted={(result) => afterComplete(completeFor?.id ?? '', result)}
/>

<style>
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
    align-items: center;
    gap: var(--space-2);
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
