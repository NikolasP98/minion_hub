<script lang="ts" module>
  /** Grid window. Kept module-level so both routes render an identical grid. */
  const START_HOUR = 7;
  const END_HOUR = 21;
  const PX_PER_HOUR = 56;
  /** Empty-slot clicks snap to quarter hours. */
  const SNAP_MIN = 15;

  /** ONE fixed status ramp — the same hue on the chip, the box and the card. */
  const STATUS_TONE: Record<string, 'success' | 'error' | 'warning' | 'info' | null> = {
    accepted: 'info',
    pending: 'warning',
    completed: 'success',
    rejected: 'error',
    no_show: 'error',
    cancelled: null, // calm terminal step → neutral Badge
  };
</script>

<script lang="ts">
  /**
   * The homegrown calendar grid: time axis, event boxes, hover card, view
   * switching and date navigation live here exactly once (it replaced a
   * 732-line POS fork flagged by the module-boundary audit). Routes keep only
   * their own extras and pass them in as snippets.
   *
   * TODO(handoff): despite the name, only `/pos/appointments` renders this now
   * — `/scheduling/calendar` was migrated onto `@event-calendar/core` (see
   * `./calendar/SchedulingCalendar.svelte`, landed in PR 244) and this component's
   * doc comment was never updated to match. Sticky axes / date-picker /
   * day-view aggregate column added here (2026-09-16) do NOT reach
   * `/scheduling/calendar`. See proposals/2026-09-16-calendar-implementation-split.md.
   */
  import type { Snippet } from 'svelte';
  import { ChevronLeft, ChevronRight, Plus } from 'lucide-svelte';
  import {
    Badge,
    Button,
    EmptyState,
    Popover,
    SegmentedControl,
    Tooltip,
    iconSizes,
  } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { formatDate, formatTime, weekdayLabels } from '$lib/utils/format';
  import {
    calendarDays,
    monthGridDays,
    shiftCalendarDate,
    shiftCalendarMonth,
    todayIn,
    type CalendarBooking,
    type CalendarResource,
    type CalendarView,
  } from './calendar-window';

  interface Props {
    view: CalendarView;
    /** Focused calendar date, `YYYY-MM-DD`. */
    date: string;
    bookings: CalendarBooking[];
    resources: CalendarResource[];
    eventTypes: Array<{ id: string; title: string }>;
    /** Both reflect into the URL so refresh and Back behave. */
    onview: (view: CalendarView) => void;
    ondate: (date: string) => void;
    /** Clicking an existing event. */
    onopen: (bookingId: string) => void;
    /** Clicking empty grid space. Omit to leave the background inert. */
    onslot?: (day: string, time: string, resourceId: string | null) => void;
    /** Route-specific chips inside the hover card (POS stock accrual). */
    chips?: Snippet<[CalendarBooking]>;
    /** Route-specific actions in the hover card footer (POS charge/complete/…). */
    actions?: Snippet<[CalendarBooking]>;
  }

  let {
    view,
    date,
    bookings,
    resources,
    eventTypes,
    onview,
    ondate,
    onopen,
    onslot,
    chips,
    actions,
  }: Props = $props();

  const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
  const TRACK_H = HOURS.length * PX_PER_HOUR;

  const eventTitle = (id: string) => eventTypes.find((e) => e.id === id)?.title ?? '—';
  const resourceName = (id: string) => resources.find((r) => r.id === id)?.name ?? '—';
  const resourceColor = (id: string) => resources.find((r) => r.id === id)?.color ?? null;

  /** LOCAL calendar day of an instant — `toISOString()` would roll a late Lima
   *  evening into tomorrow.
   *  TODO(handoff): "local" here is the BROWSER's timezone, while the data window
   *  is resolved in the ORG's (`calendarInstantWindow`). A front desk viewing a
   *  Lima org from another tz sees every box shifted. Thread the org tz into this
   *  component and format through it. See proposals/
   *  2026-09-13-pos-packages-plans-s1-followups.md. */
  function dayOf(iso: string): string {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  /** 24-hour, like the `{h}:00` gutter these chips are laid over — and pinned to
   *  the paraglide locale rather than the browser's. */
  const hhmm = (iso: string) => formatTime(iso);
  function minutesOf(iso: string): number {
    const d = new Date(iso);
    return d.getHours() * 60 + d.getMinutes();
  }

  const days = $derived(calendarDays(date, view));
  const today = todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone);

  type Placed = CalendarBooking & { top: number; height: number; lane: number; lanes: number };

  /**
   * Greedy lane packing so overlapping bookings (staff overrides, or several
   * resources sharing a week column) sit side by side instead of on top of each
   * other. ponytail: lane count is per COLUMN, not per overlap cluster — a
   * cluster-local count only matters once columns routinely hold 4+ overlaps.
   */
  function pack(list: CalendarBooking[]): Placed[] {
    const sorted = [...list].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
    );
    const laneEnds: number[] = [];
    const placed = sorted.map((b) => {
      const startMin = minutesOf(b.start);
      const endMin = Math.max(startMin + 5, minutesOf(b.end));
      let lane = laneEnds.findIndex((end) => end <= startMin);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(endMin);
      } else laneEnds[lane] = endMin;
      return {
        ...b,
        lane,
        lanes: 1,
        top: ((startMin - START_HOUR * 60) / 60) * PX_PER_HOUR,
        height: Math.max(18, ((endMin - startMin) / 60) * PX_PER_HOUR),
      };
    });
    const lanes = Math.max(1, laneEnds.length);
    return placed.map((p) => ({ ...p, lanes }));
  }

  type Column = {
    key: string;
    label: string;
    sub: string | null;
    dot: string | null;
    day: string;
    resourceId: string | null;
    isToday: boolean;
    events: Placed[];
  };

  const columns = $derived.by<Column[]>(() => {
    if (view === 'day') {
      const onDay = bookings.filter((b) => dayOf(b.start) === date);
      // Aggregate column: every booking of the day side by side, including
      // ones with no live resource column of their own (deactivated/removed
      // staff) — the per-resource columns below are otherwise the ONLY way to
      // see a booking, so one dropping a resource silently hid it. Its empty
      // slots create with resourceId:null (no resource preselected).
      const all: Column = {
        key: '__all__',
        label: m.cal_col_all(),
        sub: null,
        dot: null,
        day: date,
        resourceId: null,
        isToday: date === today,
        events: pack(onDay),
      };
      return [
        all,
        ...resources.map((r) => ({
          key: r.id,
          label: r.name,
          sub: null,
          dot: r.color ?? null,
          day: date,
          resourceId: r.id,
          isToday: date === today,
          events: pack(onDay.filter((b) => b.resourceId === r.id)),
        })),
      ];
    }
    return days.map((d) => {
      const at = new Date(`${d}T00:00:00`);
      return {
        key: d,
        label: formatDate(at, { weekday: 'short' }),
        sub: formatDate(at, { day: 'numeric', month: 'short' }),
        dot: null,
        day: d,
        resourceId: null,
        isToday: d === today,
        events: pack(bookings.filter((b) => dayOf(b.start) === d)),
      };
    });
  });

  const rangeLabel = $derived.by(() => {
    if (view === 'day') {
      return formatDate(`${date}T00:00:00`, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });
    }
    const first = new Date(`${days[0]}T00:00:00`);
    const last = new Date(`${days[days.length - 1]}T00:00:00`);
    const same = first.getMonth() === last.getMonth();
    return `${formatDate(first, { day: 'numeric', ...(same ? {} : { month: 'short' }) })} – ${formatDate(last, { day: 'numeric', month: 'short' })}`;
  });

  const viewItems = $derived([
    { value: 'day', label: m.cal_view_day() },
    { value: 'workweek', label: m.cal_view_workweek() },
    { value: 'week', label: m.cal_view_week() },
  ]);

  // ── Date picker (click the range label) ──
  // A picked day just navigates via `ondate`: `calendarDays` (above) already
  // re-anchors work-week/week to the Monday of whatever day it's given, so the
  // same call is correct for every view — no view branch needed here.
  let pickerOpen = $state(false);
  /** Month the mini-grid is showing, `YYYY-MM-DD` (day-of-month is ignored) —
   *  seeded once from `date` and reset every time the popover opens; it must
   *  stay independently mutable so the prev/next month buttons can browse
   *  away from `date` without moving the real selection. */
  // svelte-ignore state_referenced_locally
  let pickerAnchor = $state(date);
  $effect(() => {
    if (pickerOpen) pickerAnchor = date;
  });
  const pickerWeekdays = $derived.by(() => {
    const sunFirst = weekdayLabels();
    return [...sunFirst.slice(1), sunFirst[0]]; // Mon..Sun, matching mondayOf()
  });
  /** The day(s) `date` currently resolves to — highlighted in the grid. */
  const selectedDays = $derived(new Set(days));
  function pickDate(d: string) {
    ondate(d);
    pickerOpen = false;
  }

  const statusLabel = (status: string): string =>
    (
      ({
        accepted: m.sched_status_accepted,
        pending: m.sched_status_pending,
        cancelled: m.sched_status_cancelled,
        rejected: m.sched_status_rejected,
        completed: m.sched_status_completed,
        no_show: m.sched_status_no_show,
      }) as Record<string, () => string>
    )[status]?.() ?? status;

  /** Grid y → a snapped `HH:MM` inside the rendered window. */
  function slotAt(event: MouseEvent, column: Column) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const raw = START_HOUR * 60 + ((event.clientY - rect.top) / PX_PER_HOUR) * 60;
    const snapped = Math.round(raw / SNAP_MIN) * SNAP_MIN;
    const minutes = Math.min(END_HOUR * 60, Math.max(START_HOUR * 60, snapped));
    const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    onslot?.(column.day, time, column.resourceId);
  }
</script>

<div class="cal-toolbar">
  <SegmentedControl
    items={viewItems}
    value={view}
    aria-label={m.cal_view_label()}
    onValueChange={(v) => onview(v as CalendarView)}
  />
  <div class="cal-nav">
    <Button
      variant="ghost"
      size="sm"
      class="nav-btn"
      aria-label={m.sched_prev()}
      onclick={() => ondate(shiftCalendarDate(date, view, -1))}
    >
      <ChevronLeft size={iconSizes.md} />
    </Button>
    <Popover bind:open={pickerOpen} placement="bottom">
      {#snippet trigger()}
        <span class="cal-date">{rangeLabel}</span>
      {/snippet}
      <div class="date-picker">
        <div class="dp-head">
          <Button
            variant="ghost"
            size="sm"
            shape="icon"
            aria-label={m.sched_prev()}
            onclick={() => (pickerAnchor = shiftCalendarMonth(pickerAnchor, -1))}
          >
            <ChevronLeft size={iconSizes.sm} />
          </Button>
          <span class="dp-month">
            {formatDate(`${pickerAnchor}T00:00:00`, { month: 'long', year: 'numeric' })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            shape="icon"
            aria-label={m.sched_next()}
            onclick={() => (pickerAnchor = shiftCalendarMonth(pickerAnchor, 1))}
          >
            <ChevronRight size={iconSizes.sm} />
          </Button>
        </div>
        <div class="dp-weekdays">
          {#each pickerWeekdays as w, i (i)}
            <span>{w}</span>
          {/each}
        </div>
        <div class="dp-grid">
          {#each monthGridDays(pickerAnchor) as d (d)}
            <Button
              variant="ghost"
              size="xs"
              class="dp-day {d.slice(0, 7) !== pickerAnchor.slice(0, 7) ? 'is-muted' : ''} {d ===
              today
                ? 'is-today'
                : ''} {selectedDays.has(d) ? 'is-selected' : ''}"
              onclick={() => pickDate(d)}
            >
              {Number(d.slice(8, 10))}
            </Button>
          {/each}
        </div>
      </div>
    </Popover>
    <Button
      variant="ghost"
      size="sm"
      class="nav-btn"
      aria-label={m.sched_next()}
      onclick={() => ondate(shiftCalendarDate(date, view, 1))}
    >
      <ChevronRight size={iconSizes.md} />
    </Button>
    <Button variant="ghost" size="sm" onclick={() => ondate(today)}>{m.sched_today()}</Button>
  </div>
</div>

<!-- The grid region owns scroll (the toolbar above it never scrolls away):
     one scroll owner per screen, per the layout contract. -->
<div class="cal-scroll">
  {#if resources.length === 0}
    <EmptyState title={m.sched_empty_resources()} />
  {:else}
    <div class="cal">
      <div class="axis">
        <div class="axis-head"></div>
        {#each HOURS as h (h)}
          <div class="hour-label" style="height:{PX_PER_HOUR}px">
            {String(h).padStart(2, '0')}:00
          </div>
        {/each}
      </div>

      <div class="cols">
        {#each columns as col (col.key)}
          <div class="col" class:is-today={col.isToday} class:is-all={col.key === '__all__'}>
            <div class="col-head" title={col.label}>
              {#if col.dot}<span class="dot" style="background:{col.dot}"></span>{/if}
              <span class="head-name truncate">{col.label}</span>
              {#if col.sub}<span class="head-sub">{col.sub}</span>{/if}
            </div>

            <div class="track" style="height:{TRACK_H}px">
              {#each HOURS as h (h)}
                <div class="gridline" style="top:{(h - START_HOUR) * PX_PER_HOUR}px"></div>
              {/each}

              <!-- Background sits FIRST so the absolutely-positioned events that
                   follow paint above it — no z-index needed. -->
              {#if onslot}
                <Button
                  variant="ghost"
                  class="slot-layer"
                  aria-label={m.cal_new_here()}
                  onclick={(e) => slotAt(e, col)}
                >
                  <Plus size={iconSizes.sm} class="slot-plus" />
                </Button>
              {/if}

              {#each col.events as b (b.id)}
                {@const tone = STATUS_TONE[b.status] ?? null}
                {@const color = resourceColor(b.resourceId)}
                <Tooltip
                  asChild
                  interactive
                  bare
                  placement="right"
                  openDelay={180}
                  closeDelay={320}
                  id="evt-{b.id}"
                >
                  {#snippet content()}
                    <div class="hover-card">
                      <div class="hc-head">
                        <span class="t-label hc-time">{hhmm(b.start)} – {hhmm(b.end)}</span>
                        {#if tone}
                          <Badge variant="semantic" value={tone} size="sm"
                            >{statusLabel(b.status)}</Badge
                          >
                        {:else}
                          <Badge size="sm">{statusLabel(b.status)}</Badge>
                        {/if}
                      </div>
                      <p class="t-title hc-title">{eventTitle(b.eventTypeId)}</p>
                      <dl class="hc-rows">
                        <dt class="t-caption">{m.cal_staff()}</dt>
                        <dd class="t-body">{resourceName(b.resourceId)}</dd>
                        <dt class="t-caption">{m.cal_client()}</dt>
                        <dd class="t-body">{b.attendeeName ?? '—'}</dd>
                        {#if b.attendeePhone}
                          <dt class="t-caption">{m.sched_book_phone()}</dt>
                          <dd class="t-body">{b.attendeePhone}</dd>
                        {/if}
                      </dl>
                      {#if chips}
                        <div class="hc-chips">{@render chips(b)}</div>
                      {/if}
                      <div class="hc-actions">
                        <Button size="sm" onclick={() => onopen(b.id)}>{m.cal_open()}</Button>
                        {#if actions}{@render actions(b)}{/if}
                      </div>
                    </div>
                  {/snippet}
                  {#snippet children(trigger)}
                    <Button
                      {...trigger ?? {}}
                      variant="ghost"
                      class="evt {b.status} {tone ? `tone-${tone}` : 'tone-neutral'}"
                      style="top:{b.top}px;height:{b.height}px;left:calc({(b.lane / b.lanes) *
                        100}% + var(--space-0-5));width:calc({100 /
                        b.lanes}% - var(--space-2));border-left-color:{color ??
                        'var(--color-accent)'}"
                      onclick={() => onopen(b.id)}
                    >
                      <span class="evt-in">
                        <span class="evt-t">{hhmm(b.start)}</span>
                        <span class="evt-s truncate">{eventTitle(b.eventTypeId)}</span>
                        <span class="evt-a truncate">{b.attendeeName ?? ''}</span>
                      </span>
                    </Button>
                  {/snippet}
                </Tooltip>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .cal-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
  }
  .cal-nav {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .cal-date {
    display: inline-block;
    min-width: 12rem;
    text-align: center;
    font-weight: 600;
    font-size: var(--font-size-page-title);
    font-variant-numeric: tabular-nums;
  }
  /* Forwarded to a shared `Button`, so it needs `:global` anchored on a scoped
     ancestor — a plain `.nav-btn` rule compiles and ships dead. */
  .cal-nav :global(.nav-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-1);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
  }
  .cal-nav :global(.nav-btn:hover) {
    background: var(--color-surface-2);
    border-color: var(--color-accent);
  }

  .cal-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: var(--space-card);
  }
  .cal {
    display: flex;
    min-width: min-content;
  }
  /* Time gutter: stuck to the LEFT edge of `.cal-scroll` so it survives a
     horizontal scroll (many resource/day columns). Opaque so the track's
     absolutely-positioned event boxes don't show through underneath it.
     `.cols` (and each sticky `.col-head` inside it) comes AFTER `.axis` in the
     DOM, so on a horizontal scroll — where the axis and whatever column has
     slid underneath it now occupy the same screen pixels — equal z-index
     would let that later-painted col-head win the tie and cover the gutter.
     One token above `.col-head` (`--layer-navigation`) settles that. */
  .axis {
    position: sticky;
    left: 0;
    z-index: var(--layer-dropdown);
    flex-shrink: 0;
    width: 52px;
    background: color-mix(in srgb, var(--color-bg) 95%, transparent);
    backdrop-filter: blur(8px);
  }
  /* The corner cell also sticks to the TOP — pinned on both axes where the
     gutter and the header row cross. One tier above the gutter itself so it
     wins there too. */
  .axis-head {
    position: sticky;
    top: 0;
    z-index: var(--layer-popover);
    height: 40px;
    background: color-mix(in srgb, var(--color-bg) 95%, transparent);
    backdrop-filter: blur(8px);
  }
  .hour-label {
    font-size: var(--font-size-caption);
    color: var(--color-text-tertiary);
    text-align: right;
    padding-right: var(--space-2);
    transform: translateY(-6px);
    font-variant-numeric: tabular-nums;
  }
  .cols {
    display: flex;
    flex: 1;
    gap: 1px;
  }
  .col {
    flex: 1;
    min-width: 132px;
  }
  /* First-in day view: every booking of the day, resource columns unchanged. */
  .col.is-all {
    background: color-mix(in srgb, var(--color-surface-2) 45%, transparent);
  }
  /* Stuck to the TOP of `.cal-scroll` — the day/resource identity of a column
     must stay visible however far down the track a booking sits. Opaque for
     the same reason as `.axis`. */
  .col-head {
    position: sticky;
    top: 0;
    z-index: var(--layer-navigation);
    height: 40px;
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    font-size: var(--font-size-body);
    font-weight: 500;
    padding: 0 var(--space-2);
    border-bottom: 1px solid var(--color-border);
    color: var(--color-text-primary);
    text-transform: capitalize;
    background: color-mix(in srgb, var(--color-bg) 95%, transparent);
    backdrop-filter: blur(8px);
  }
  .col.is-today .col-head {
    color: var(--color-accent);
    border-bottom-color: var(--color-accent);
  }
  .head-sub {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
    align-self: center;
  }
  .track {
    position: relative;
    border-left: 1px solid var(--color-border);
  }
  .gridline {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px solid var(--color-border);
    opacity: 0.45;
  }

  /* Empty-grid affordance: a full-track shared Button (never a bare native one) that
     turns the click y into a snapped start time. Transparent until hovered. */
  .track :global(.slot-layer) {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: flex-start;
    justify-content: flex-end;
    width: 100%;
    height: 100%;
    padding: var(--space-1);
    border-radius: 0;
    background: transparent;
    color: var(--color-text-tertiary);
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease-standard);
  }
  .track :global(.slot-layer > span) {
    align-items: flex-start;
    height: auto;
  }
  .track :global(.slot-layer:active) {
    transform: none;
  }
  .track :global(.slot-layer:hover),
  .track :global(.slot-layer:focus-visible) {
    background: color-mix(in srgb, var(--color-accent) 6%, transparent);
    opacity: 1;
  }

  /* `.evt` is a shared `Button`: its class is invisible to plain scoped CSS, and
     Button renders children inside an inner fixed-height inline-flex `<span>` —
     hence the `> span` override. See governance "Button slot trap". */
  .track :global(.evt) {
    position: absolute;
    display: block;
    min-width: 0;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-left: 3px solid var(--color-accent);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-elevation-1);
    padding: var(--space-0-5) var(--space-2);
    overflow: hidden;
    text-align: left;
  }
  .track :global(.evt:hover) {
    background: var(--color-surface-3);
    box-shadow: var(--shadow-elevation-2);
  }
  .track :global(.evt > span) {
    display: block;
    width: 100%;
    height: auto;
    align-items: stretch;
  }
  /* Status ramp — one hue per level, the same on the box and on the card chip. */
  .track :global(.evt.tone-info) {
    background: var(--color-info-surface);
  }
  .track :global(.evt.tone-warning) {
    background: var(--color-warning-surface);
  }
  .track :global(.evt.tone-success) {
    background: var(--color-success-surface);
  }
  .track :global(.evt.tone-error) {
    background: var(--color-danger-surface);
  }
  .track :global(.evt.cancelled),
  .track :global(.evt.no_show) {
    opacity: 0.5;
    text-decoration: line-through;
  }
  .evt-in {
    display: block;
    min-width: 0;
  }
  .evt-t,
  .evt-s,
  .evt-a {
    display: block;
    min-width: 0;
    font-size: var(--font-size-caption);
    line-height: 1.3;
  }
  .evt-t {
    font-weight: 600;
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
  }
  .evt-s,
  .evt-a {
    color: var(--color-text-secondary);
  }

  /* Hover card — an INTERACTIVE Zag tooltip panel (open/close intent + Escape
     come from the machine; `bare` drops the label styling so this owns it). */
  .hover-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 15rem;
    max-width: 20rem;
    padding: var(--space-3);
    background: var(--color-overlay);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-overlay);
  }
  .hc-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .hc-time {
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
  }
  .hc-title {
    margin: 0;
    color: var(--color-text-primary);
  }
  .hc-rows {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--space-1) var(--space-3);
    margin: 0;
  }
  .hc-rows dt {
    color: var(--color-text-tertiary);
  }
  .hc-rows dd {
    margin: 0;
    color: var(--color-text-primary);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .hc-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .hc-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding-top: var(--space-1);
    border-top: 1px solid var(--color-border);
  }

  /* Date picker — a small month grid inside the toolbar's Popover. */
  .date-picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
    width: 17rem;
  }
  .dp-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .dp-month {
    font-weight: 600;
    font-size: var(--font-size-body);
    text-transform: capitalize;
  }
  .dp-weekdays,
  .dp-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
  }
  .dp-weekdays span {
    text-align: center;
    font-size: var(--font-size-caption);
    color: var(--color-text-tertiary);
    text-transform: capitalize;
  }
  .date-picker :global(.dp-day) {
    aspect-ratio: 1;
    padding: 0;
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
  }
  .date-picker :global(.dp-day.is-muted) {
    color: var(--color-text-tertiary);
  }
  .date-picker :global(.dp-day.is-today) {
    font-weight: 700;
    color: var(--color-accent);
  }
  .date-picker :global(.dp-day.is-selected) {
    background: color-mix(in srgb, var(--color-accent) 16%, transparent);
    border-radius: var(--radius-sm);
  }
</style>
