<script lang="ts" module>
  /** Grid window. Kept module-level so both routes render an identical grid. */
  const START_HOUR = 7;
  const END_HOUR = 21;
  const PX_PER_HOUR = 56;
  /** Empty-slot clicks snap to quarter hours. */
  const SNAP_MIN = 15;

  // ── Infinite week scrolling (owner ask 2026-09-25) ────────────────────────
  // Week view renders onto a FIXED runway of day columns the scroller slides
  // over, so "next week" is a native horizontal scroll (day snapping, no
  // navigation, no load). 105 weeks is ±1 year of runway around wherever the
  // calendar opened — past that the date picker re-anchors it (`goToDay`).
  const RUNWAY_DAYS = 105 * 7;
  const RUNWAY_BEHIND = 52 * 7;
  /** `weekDays` stepper bounds (kebab "Days per screen") — exported so the
   *  page can clamp the persisted preference to the same range. */
  export const WEEK_DAYS_MIN = 2;
  export const WEEK_DAYS_MAX = 14;
  /** Columns kept in the DOM past each visible edge. */
  /** Columns rendered beyond the visible ones on each side. THREE weeks, not
   *  one: the rendered window only moves when a scroll SETTLES (see `renderX`),
   *  so a prev/next step, a handful of wheel notches or a short fling must stay
   *  inside it — otherwise the tail of the gesture scrolls over empty runway. */
  const RENDER_PAD = 21;
  /** Time-gutter width — MUST match `--cal-gutter` in the style block. */
  const GUTTER_W = 52;

  // ── Infinite month scrolling (owner ask 2026-09-25) ───────────────────────
  // "Available views are day/week/month (month has up/down infinite scroll)."
  // Month view is the week runway turned 90°: rows of ISO weeks (Monday first)
  // on a FIXED vertical runway of 105 rows anchored 52 weeks behind the date the
  // calendar opened on, y-snapped per row, with only the rows near the viewport
  // in the DOM. Every rule the week runway earned the hard way applies — the
  // render window moves only when a scroll SETTLES, the label follows a
  // per-frame scroll position, and a width/height change re-anchors by INDEX.
  const RUNWAY_ROWS = 105;
  const MONTH_BEHIND = 52;
  /** Rows rendered beyond the visible ones on each side. SIX, not one screenful:
   *  the rendered window only moves on settle and one prev/next step is a whole
   *  MONTH (4–6 rows), so a smaller pad would let the tail of that step scroll
   *  over empty runway. */
  const MONTH_PAD = 6;
  /** Sticky header height — MUST match `--cal-head-h` in the style block. */
  const HEAD_H = 40;
  /** Event chips a month cell shows before it collapses the rest into "+N more". */
  const MONTH_CHIPS = 3;
  /** A month cell has no y axis to read a time off, so its empty-space click
   *  opens the form at the start of the working day rather than at `START_HOUR`
   *  (07:00 is when the grid starts, not when the front desk books). */
  const MONTH_NEW_TIME = '09:00';
  /** `scrollend` is Baseline-newish; older engines get a debounced `scroll`. */
  const HAS_SCROLLEND = typeof window !== 'undefined' && 'onscrollend' in window;
  /** dataTransfer type an external draggable must carry to be droppable here. */
  export const CALENDAR_DROP_MIME = 'application/x-minion-calendar-drop';

  /** ONE fixed status ramp — the same hue on the chip, the box and the card. */
  const STATUS_TONE: Record<string, 'success' | 'error' | 'warning' | 'info' | null> = {
    accepted: 'info',
    pending: 'warning',
    completed: 'success',
    rejected: 'error',
    no_show: 'error',
    cancelled: null, // calm terminal step → neutral Badge
  };

  /** The same ramp for the SLIVER (the box's left border): `status` is the one
   *  colour source with no persisted colour of its own, so it paints the status
   *  token — never `--color-accent`, which is an action colour. */
  const TONE_BORDER: Record<string, string> = {
    info: 'var(--color-info-border)',
    warning: 'var(--color-warning-border)',
    success: 'var(--color-success-border)',
    error: 'var(--color-danger-border)',
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
   * TODO(handoff): the interchangeable block/sliver colour picker (2026-09-25,
   * `./booking-color.ts`) is likewise POS-only — `/scheduling/calendar` keeps the
   * fixed `resolveEventColor` chain (tag → kind → resource). The resolver is
   * deliberately pure and renderer-agnostic so that surface can adopt it; only
   * its own toolbar + prefs plumbing is missing. Same proposal.
   * TODO(handoff): the configurable hover-card fields (2026-09-25,
   * `./hover-fields.ts`) reach only this renderer too — `/scheduling/calendar`
   * builds its popovers inside `@event-calendar/core`. Same proposal.
   * TODO(handoff): the day RUNWAY (infinite week scrolling, 2026-09-25,
   * `./runway.ts`) is POS-only for the same reason — `/scheduling/calendar` is
   * `@event-calendar/core`, which owns its own week navigation. `runway.ts` is
   * pure index math and the page-side week cache is a plain fetch loop, so the
   * pattern transfers, but nothing of it is wired there. Same proposal.
   * TODO(handoff): so do the configurable event-BLOCK lines and the now-line
   * (2026-09-25, `./hover-fields.ts` `BLOCK_FIELDS` + `./now-line.ts`).
   * `/scheduling/calendar` gets a now indicator free from the ec skin
   * (`--ec-now-indicator-color`) but has no block-layout prefs; the prefs and the
   * helper are renderer-agnostic, only its own kebab is missing. Same proposal.
   */
  import { tick, untrack, type Snippet } from 'svelte';
  import {
    ChevronLeft,
    ChevronRight,
    Minus,
    MoreVertical,
    Plus,
    Receipt,
    Ungroup,
  } from 'lucide-svelte';
  import {
    Badge,
    Button,
    EmptyState,
    Popover,
    SegmentedControl,
    Spinner,
    Toggle,
    Tooltip,
    iconSizes,
  } from '$lib/components/ui';
  import { ConfirmDialog, Dialog } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import { formatDate, formatMoney, formatTime, weekdayLabels } from '$lib/utils/format';
  import {
    calendarDays,
    monthGridDays,
    shiftCalendarDate,
    shiftCalendarMonth,
    todayIn,
    type CalendarBooking,
    type CalendarBookingTag,
    type CalendarInvoice,
    type CalendarResource,
    type CalendarView,
  } from './calendar-window';
  import {
    dayAt,
    dayIndex,
    majorityMonth,
    mondayOf,
    renderedRange,
    rowAt,
    rowIndex,
  } from './runway';
  import { clientKeyOf, groupBookings, type BookingBox } from './booking-groups';
  import { mergeTargetBox } from './merge-target';
  import { conflictLine, type MoveConflict, type MoveOpts, type MoveResult } from './move-conflict';
  import {
    bookingColor,
    DEFAULT_BLOCK_SOURCE,
    DEFAULT_SLIVER_SOURCE,
    type BookingColorKind,
    type ColorSource,
  } from './booking-color';
  import ColorSourcePicker, { type ColorSourceOption } from './ColorSourcePicker.svelte';
  import { previewValues } from './color-source-preview';
  import {
    BLOCK_FIELDS,
    BLOCK_FIELDS_KEY,
    HOVER_FIELDS,
    HOVER_FIELDS_KEY,
    HOVER_SUB_FIELDS,
    hoverChildren,
    mergeFields,
    moveField,
    visibleFields,
    type BlockField,
    type HoverField,
    type HoverSubField,
  } from './hover-fields';
  import FieldsList from './FieldsList.svelte';
  import { nowLineTop } from './now-line';
  import TagDot from '$lib/components/tags/TagDot.svelte';
  import TagChip from '$lib/components/tags/TagChip.svelte';

  interface Props {
    view: CalendarView;
    /** Focused calendar date, `YYYY-MM-DD`. */
    date: string;
    bookings: CalendarBooking[];
    resources: CalendarResource[];
    eventTypes: Array<{ id: string; title: string; color?: string | null; kindId?: string | null }>;
    /** Org event kinds with their colours — the `kind` colour source. */
    kinds?: BookingColorKind[];
    /** Org event tags (the same list the toolbar tag filter gets) and product
     *  categories — value lists the colour picker previews. Colouring itself
     *  reads each booking's own tags/`categoryColor`, so both are optional.
     *  TODO(handoff): `tagOptions` is the FILTER's list — the event-scope registry
     *  PLUS every tag found on a shown booking — so the tags preview grows/shrinks
     *  with the calendar window, while `categories` is org-wide. Harmless (both are
     *  previews) but inconsistent; the fix is an org-wide `listTags(ctx,'event')`-only
     *  prop for the preview, separate from the filter's union. */
    tagOptions?: Array<{ name: string; color?: string | null }>;
    categories?: Array<{ name: string; color?: string | null }>;
    /** Which select-type column paints the box background / its left sliver.
     *  Omit `oncolorby` to hide the picker and keep the shipped defaults. */
    blockColorBy?: ColorSource;
    sliverColorBy?: ColorSource;
    oncolorby?: (next: { block: ColorSource; sliver: ColorSource }) => void;
    /** Both reflect into the URL so refresh and Back behave. `date` is only
     *  passed when the view change is also a jump — the month grid's "+N more"
     *  and day-number affordances open the DAY view ON that cell's date, which
     *  is one navigation, not a view change followed by a date change. */
    onview: (view: CalendarView, date?: string) => void;
    /**
     * The focused date moved. `silent` means the operator SCROLLED there on the
     * runway (week view): the URL must follow with a shallow `replaceState`,
     * never a `goto` — re-running the load on every settled scroll is the
     * latency the infinite scroller exists to remove.
     */
    ondate: (date: string, opts?: { silent?: boolean }) => void;
    /**
     * The visible day range, on init and after every settled scroll — the hook
     * the page's week cache loads/evicts data through. Day view never emits it.
     */
    onrange?: (first: string, last: string) => void;
    /** A week fetch is in flight → the range label shows it (never a blocking
     *  overlay: what IS loaded stays on screen and interactive). */
    busy?: boolean;
    /** Columns visible per screen in week view (2..14, default 7) — a
     *  per-viewer preference set from the kebab's "Days per screen" stepper.
     *  Day/month views ignore it. */
    weekDays?: number;
    onweekdays?: (n: number) => void;
    /** Clicking an existing event. */
    onopen: (bookingId: string) => void;
    /** Clicking empty grid space. Omit to leave the background inert. */
    onslot?: (day: string, time: string, resourceId: string | null) => void;
    /** Route-specific chips inside the hover card (POS stock accrual). */
    chips?: Snippet<[CalendarBooking]>;
    /** Route-specific actions in the hover card footer (POS charge/complete/…). */
    actions?: Snippet<[CalendarBooking]>;
    /**
     * Working hours for off-hours shading: resourceId → weekday (0 = Sunday)
     * → `[open, close]` in minutes from midnight; a missing weekday = closed,
     * a resource missing from the map = no schedule (never shaded).
     * Resource columns shade their own hours; day/aggregate columns shade
     * outside the envelope (earliest open → latest close) of every scheduled
     * resource. Omit to leave the grid unshaded.
     */
    hours?: Record<string, Partial<Record<number, [number, number]>>>;
    /**
     * Drag (move across time / day / resource) or resize (end) commit. Omit to
     * keep boxes static.
     *
     * `opts` carries the other three shapes a drag can commit as — a move that
     * deliberately overrides a clash, a MERGE into another event's visit, a
     * DETACH out of one — so the route keeps ONE booking-mutation function while
     * the dialogs that produce them stay here. Return the server's structured
     * 409 (`{ conflicts }`) to have this component open its conflict dialog;
     * return nothing when the move landed.
     */
    onmove?: (
      id: string,
      next: { start: string; end: string; resourceId: string },
      opts?: MoveOpts,
    ) => void | Promise<void | MoveResult>;
    /** An external draggable (dataTransfer `CALENDAR_DROP_MIME`) dropped on the
     *  grid: its payload string + the snapped slot. Omit to refuse drops. */
    ondropexternal?: (
      payload: string,
      day: string,
      time: string,
      resourceId: string | null,
    ) => void | Promise<void>;
    /** Submitted tickets for the window. Present = the toolbar offers the
     *  "Invoiced | Scheduled" split; `split` decides whether it is on. */
    invoices?: CalendarInvoice[];
    split?: boolean;
    onsplit?: (split: boolean) => void;
    /** Route-specific toolbar controls (e.g. the tag filter), right-aligned. */
    tools?: Snippet;
  }

  let {
    view,
    date,
    bookings,
    resources,
    eventTypes,
    kinds = [],
    tagOptions = [],
    categories = [],
    blockColorBy = DEFAULT_BLOCK_SOURCE,
    sliverColorBy = DEFAULT_SLIVER_SOURCE,
    oncolorby,
    onview,
    ondate,
    onrange,
    busy = false,
    weekDays = 7,
    onweekdays,
    onopen,
    onslot,
    chips,
    actions,
    hours,
    onmove,
    ondropexternal,
    invoices,
    split = false,
    onsplit,
    tools,
  }: Props = $props();

  const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
  const TRACK_H = HOURS.length * PX_PER_HOUR;

  const eventTitle = (id: string) => eventTypes.find((e) => e.id === id)?.title ?? '—';
  const resourceName = (id: string) => resources.find((r) => r.id === id)?.name ?? '—';

  // ── Interchangeable event colouring (owner directive 2026-09-25) ──
  // Every option is a select-type column that carries its own colour; `status`
  // alone keeps the fixed semantic tone ramp. Labels reuse each column's
  // existing i18n key.
  const colorCtx = $derived({ resources, eventTypes, kinds });
  // Each option also names WHERE its colour comes from (owner directive
  // 2026-09-25) using the entity name the app already shows users — the
  // `sched_*_title` nav/page headings, not raw SQL table names — and carries the
  // column's values so the picker can preview them on hover/focus.
  const colorOptions = $derived.by<ColorSourceOption[]>(() => {
    const data = { statusLabel, kinds, resources, eventTypes, tags: tagOptions, categories };
    return (
      [
        { value: 'status', label: m.sched_cal_status(), source: m.sched_bookings_title() },
        { value: 'kind', label: m.sched_kind_label(), source: m.sched_kinds_title() },
        { value: 'staff', label: m.cal_staff(), source: m.cal_staff() },
        { value: 'service', label: m.sched_cal_service(), source: m.sched_eventTypes_title() },
        { value: 'tags', label: m.tags_label(), source: m.tags_label() },
        {
          value: 'category',
          label: m.fin_col_category(),
          source: m.cal_color_source_categories(),
        },
        { value: 'none', label: m.sched_none(), source: '' },
      ] as const
    ).map((o) => ({ ...o, values: previewValues(o.value, data) }));
  });
  const colorSourceOf = (value: string | number): ColorSource =>
    (colorOptions.some((i) => i.value === value) ? value : DEFAULT_BLOCK_SOURCE) as ColorSource;

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
  const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // ── The runway (week) ───────────────────────────────────────────────────
  // Owner ask 2026-09-25: "implement infinite calendar scrolling … the scrolling
  // experience (either through scrolling or through the nav buttons) should be
  // SMOOTH. No latency." So week view stops being a window that navigates:
  // every day of ±1 year is a column on one runway, the scroller slides over it
  // with `scroll-snap` day steps, and only the columns near the viewport exist
  // in the DOM. `ondate` follows the scroll with a shallow URL replace and
  // `onrange` tells the page which weeks to have loaded — no load re-run.
  // Day view is untouched; MONTH runs the same runway on the y axis (see the
  // month section below).
  const runway = $derived(view === 'week');
  /** Columns visible per screen — the `weekDays` preference (2..14, default 7)
   *  in week view. */
  const visibleCount = $derived(weekDays);
  /** Kebab "Days per screen" stepper — clamps and reports the new preference;
   *  a no-op without `onweekdays` (the page owns persisting it). */
  function stepWeekDays(delta: number) {
    const next = Math.min(WEEK_DAYS_MAX, Math.max(WEEK_DAYS_MIN, weekDays + delta));
    if (next !== weekDays) onweekdays?.(next);
  }
  let scrollEl = $state<HTMLElement | null>(null);
  /** Column width in px, `(scroller − gutter) / visibleCount`; 0 until measured
   *  (SSR + first paint), which is when the plain flex layout still applies. */
  let colW = $state(0);
  /** The scroller's `scrollLeft`, written at most ONCE PER FRAME — drives the
   *  range label only. */
  let scrollX = $state(0);
  /** The `scrollLeft` the RENDERED window is built from — written only when a
   *  scroll settles (or on a programmatic jump). Never per frame: adding or
   *  removing snap areas while a smooth scroll is in flight makes Chrome
   *  re-snap to the nearest column and abandon the animation, which cut a
   *  six-week "Today" jump short at twelve columns. */
  let renderX = $state(0);
  /** Runway origin: 52 weeks behind the Monday the calendar opened on. It must
   *  stay independently mutable — deriving it from `date` would slide the whole
   *  runway out from under the scroller on every settled scroll. */
  // svelte-ignore state_referenced_locally
  let runwayStart = $state(dayAt(mondayOf(date), -RUNWAY_BEHIND));
  const measured = $derived(runway && colW > 0);
  /** Where `date`'s week sits — the scroll position the grid opens on, and the
   *  fallback window before the first measurement. */
  const anchorIndex = $derived(dayIndex(runwayStart, mondayOf(date)));
  const firstIndex = $derived(measured ? Math.round(scrollX / colW) : anchorIndex);
  const range = $derived(
    measured
      ? renderedRange(renderX, colW, visibleCount, RUNWAY_DAYS, RENDER_PAD)
      : { first: anchorIndex, last: anchorIndex + visibleCount - 1 },
  );
  // Read as NUMBERS so `columns` below only recomputes when the window actually
  // moves a column, not on every frame of a scroll.
  const renderFirst = $derived(range.first);
  const renderLast = $derived(range.last);
  const visibleDays = $derived(
    runway
      ? Array.from({ length: visibleCount }, (_, k) => dayAt(runwayStart, firstIndex + k))
      : days,
  );

  // ── The runway (month) ──────────────────────────────────────────────────
  // Same contract as the week runway, one axis over: rows are ISO weeks, the
  // scroller's `scrollTop` is measured in rows, and `scroll-padding-top` insets
  // the snapport by the sticky weekday header — which is what makes
  // `scrollTop === rowIndex * rowH` exactly as `scrollLeft === columnIndex * colW`
  // holds there.
  const monthRunway = $derived(view === 'month');
  /** Row height in px, measured off the first rendered row (the CSS var
   *  `--cal-month-row` owns the value); 0 until measured, which is when the plain
   *  6-row flow grid below still applies. */
  let rowH = $state(0);
  /** Scroller height, for how many whole rows are on screen. */
  let viewH = $state(0);
  /** The scroller's `scrollTop`, written at most ONCE PER FRAME — drives the
   *  month label only. */
  let scrollY = $state(0);
  /** The `scrollTop` the RENDERED rows are built from — written only when a
   *  scroll settles. Never per frame, for the same reason as `renderX`: adding
   *  or removing snap areas mid-animation makes Chrome re-snap and abandon a
   *  smooth scroll. */
  let renderY = $state(0);
  /** Runway origin: 52 weeks behind the week of the date the calendar opened on.
   *  Independently mutable, like `runwayStart` — deriving it from `date` would
   *  slide the runway out from under the scroller on every settled scroll. */
  // svelte-ignore state_referenced_locally
  let monthRowStart = $state(rowAt(date, -MONTH_BEHIND));
  const monthMeasured = $derived(monthRunway && rowH > 0);
  /** The row the month view opens on: the one holding the FIRST of `date`'s
   *  month, so it opens showing that whole month rather than `date`'s own week
   *  with the next month under it. */
  const anchorRow = $derived(rowIndex(monthRowStart, `${date.slice(0, 7)}-01`));
  /** Rows on screen under the sticky weekday header — `ceil`, so a partially
   *  visible bottom row counts (it is showing bookings, so it belongs to the
   *  label and to the loaded range). 6 = the classic grid, the pre-measurement
   *  fallback. */
  const visibleRows = $derived(rowH > 0 ? Math.max(1, Math.ceil((viewH - HEAD_H) / rowH)) : 6);
  const firstRow = $derived(monthMeasured ? Math.round(scrollY / rowH) : anchorRow);
  const rowRange = $derived(
    monthMeasured
      ? renderedRange(renderY, rowH, visibleRows, RUNWAY_ROWS, MONTH_PAD)
      : { first: anchorRow, last: anchorRow + 5 },
  );
  // Read as NUMBERS so `monthRows` only recomputes when the window actually
  // moves a row, never on a frame of a scroll.
  const rowFirst = $derived(rowRange.first);
  const rowLast = $derived(rowRange.last);
  const visibleMondays = $derived(
    Array.from({ length: visibleRows }, (_, r) => rowAt(monthRowStart, firstRow + r)),
  );
  /** Every day on screen — what the date picker highlights in month view. */
  const monthVisibleDays = $derived(
    visibleMondays.flatMap((monday) => Array.from({ length: 7 }, (_, d) => dayAt(monday, d))),
  );
  /** `YYYY-MM` the visible rows mostly belong to: the label, and what decides
   *  which cells are "outside the month" and dim. */
  const labelMonth = $derived(majorityMonth(visibleMondays));

  let raf = 0;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  /** Previous `colW`, so a resize or a `weekDays` change keeps the same first
   *  day under the gutter instead of jumping to wherever the old pixels now
   *  point; 0 means "no measurement to carry over — anchor on `date`". */
  let lastColW = 0;
  $effect(() => {
    const el = scrollEl;
    if (!runway) {
      // Day view took over: forget the measurement. Its `scrollLeft` means
      // resource columns, so the week views must re-anchor on `date` when they
      // come back rather than carry a meaningless pixel offset across.
      lastColW = 0;
      return;
    }
    if (!el) return;
    // `visibleCount` is read here on purpose: a view switch must re-measure.
    const measure = () => (colW = Math.max(1, (el.clientWidth - GUTTER_W) / visibleCount));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      clearTimeout(settleTimer);
      raf = 0;
    };
  });
  $effect(() => {
    const el = scrollEl;
    const w = colW;
    if (!runway || !el || w <= 0) return;
    const prev = lastColW;
    lastColW = w;
    if (prev === w) return;
    // Re-anchor by DAY, never by pixel: when the column width changes (first
    // measurement, sidebar settling, a window resize) every rendered column's
    // `left` moves, and the mandatory x-snap re-selects a column from the OLD
    // pixel position against the NEW layout — which is how the grid once
    // drifted seven weeks on load. So: keep the first visible index, render the
    // window around it first (`scrollX`), and only then scroll there.
    const index = prev === 0 ? anchorIndex : Math.round(untrack(() => scrollX) / prev);
    scrollX = renderX = index * w;
    void tick().then(() => {
      // `top: 0` only when the week views are taking over (`prev === 0`): the
      // month runway leaves a scrollTop of thousands of pixels behind, which the
      // browser clamps to the middle of the (much shorter) time axis instead of
      // opening at START_HOUR.
      el.scrollTo({ left: index * w, ...(prev === 0 ? { top: 0 } : {}) });
      if (prev === 0) emitRange();
    });
  });

  /** Previous `rowH`, so a row-height change re-anchors on the same row instead
   *  of on whatever the old pixels now point at; 0 = nothing to carry over. */
  let lastRowH = 0;
  let monthRowsEl = $state<HTMLElement | null>(null);
  $effect(() => {
    const el = scrollEl;
    const rows = monthRowsEl;
    if (!monthRunway) {
      // Week/day view took over: forget the measurement, exactly as the week
      // effect drops `lastColW`. Their `scrollTop` means the TIME axis, so month
      // must re-anchor on `date` when it comes back.
      lastRowH = 0;
      return;
    }
    if (!el || !rows) return;
    // The row height itself comes from CSS (`--cal-month-row`), so it is read
    // off the first rendered row rather than computed here — a media query may
    // change it and the runway arithmetic follows.
    const measure = () => {
      viewH = el.clientHeight;
      const h = (rows.firstElementChild as HTMLElement | null)?.getBoundingClientRect().height ?? 0;
      if (h > 0) rowH = h;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(rows);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      clearTimeout(settleTimer);
      raf = 0;
    };
  });
  $effect(() => {
    const el = scrollEl;
    const h = rowH;
    if (!monthRunway || !el || h <= 0) return;
    const prev = lastRowH;
    lastRowH = h;
    if (prev === h) return;
    // Re-anchor by ROW, never by pixel — the week runway's lesson on the other
    // axis: every rendered row's `top` moves, and mandatory y-snap would re-select
    // a row from the OLD pixel position against the NEW layout.
    let index = prev === 0 ? untrack(() => anchorRow) : Math.round(untrack(() => scrollY) / prev);
    if (index < 0 || index >= RUNWAY_ROWS) {
      // The focused month is off the runway — a week-runway scroll of more than a
      // year followed by a switch to month. Re-anchor the origin on it, exactly
      // as `goToMonthRow` does, instead of letting the scroll clamp to an edge.
      monthRowStart = rowAt(
        rowAt(
          untrack(() => monthRowStart),
          index,
        ),
        -MONTH_BEHIND,
      );
      index = MONTH_BEHIND;
    }
    scrollY = renderY = index * h;
    void tick().then(() => {
      el.scrollTo({ top: index * h });
      if (prev === 0) emitMonthRange();
    });
  });

  function onScroll() {
    if (!runway && !monthRunway) return;
    // ONE state write per animation frame (the rendered window + the range
    // label follow the scroll); nothing else is written per scroll event.
    if (!raf)
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = scrollEl;
        if (!el) return;
        if (monthRunway) {
          if (el.scrollTop !== scrollY) scrollY = el.scrollTop;
        } else if (el.scrollLeft !== scrollX) scrollX = el.scrollLeft;
      });
    if (!HAS_SCROLLEND) {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(settle, 120);
    }
  }
  /** Scrolling stopped: reflect the landed week/month in the URL and in the cache. */
  function settle() {
    if (monthRunway) {
      settleMonth();
      return;
    }
    const el = scrollEl;
    if (!el || !runway || colW <= 0) return;
    scrollX = renderX = el.scrollLeft;
    const day = dayAt(runwayStart, Math.round(el.scrollLeft / colW));
    if (day !== date) ondate(day, { silent: true });
    emitRange();
  }
  function emitRange() {
    if (!runway) return;
    onrange?.(dayAt(runwayStart, firstIndex), dayAt(runwayStart, firstIndex + visibleCount - 1));
  }
  /** The month runway landed on a row: the focused date becomes its Monday (a
   *  shallow URL replace, never a load) and the visible Monday…Sunday span is
   *  what the page's week cache loads around — `calendarLoadDays(day, 'month')`
   *  already covers an arbitrary Monday-anchored range. */
  function settleMonth() {
    const el = scrollEl;
    if (!el || !monthRunway || rowH <= 0) return;
    scrollY = renderY = el.scrollTop;
    const monday = rowAt(monthRowStart, Math.round(el.scrollTop / rowH));
    if (monday !== date) ondate(monday, { silent: true });
    emitMonthRange();
  }
  // TODO(handoff): the reported range is exactly what is ON SCREEN, while the
  // rendered window is MONTH_PAD rows wider on each side — so a prev/next month
  // step (4–6 rows) can land on one or two rows the page has not fetched yet and
  // they paint empty until the settle that follows loads them. The week runway
  // has the same shape of gap (RENDER_PAD is three weeks, the page prefetches
  // one), and widening the reported range trades it for ~12 week fetches per
  // settle, so the fix is a separate prefetch hook (a "warm these weeks" callback
  // distinct from "these weeks are visible") rather than a wider `onrange`.
  // Ledger: meta-repo `proposals/2026-09-25-hub-pos-calendar-color-followups.md`.
  function emitMonthRange() {
    if (!monthRunway) return;
    const first = rowAt(monthRowStart, firstRow);
    onrange?.(first, dayAt(first, visibleRows * 7 - 1));
  }
  /** Prev/next: one screenful of columns in week view, one whole MONTH in month
   *  view (the row holding the 1st of the next/previous month, so a step never
   *  drifts with the 4-, 5- or 6-row length of a month grid). Natively smooth
   *  either way — never a navigation. */
  function step(delta: number) {
    if (monthRunway) {
      // Before the first measurement there is no runway to scroll: navigate, the
      // same fallback day view uses.
      if (rowH <= 0) {
        ondate(shiftCalendarDate(date, view, delta));
        return;
      }
      void goToMonthRow(rowIndex(monthRowStart, shiftCalendarMonth(`${labelMonth}-01`, delta)));
      return;
    }
    if (!runway) {
      ondate(shiftCalendarDate(date, view, delta));
      return;
    }
    scrollEl?.scrollBy({ left: delta * visibleCount * colW, behavior: 'smooth' });
  }
  /** Scroll the month runway to row `i`, re-anchoring the runway when that row is
   *  off it. Smooth only while the destination is already rendered — the same
   *  rule (and the same reason) as the week runway's `goToDay`. */
  async function goToMonthRow(i: number) {
    const el = scrollEl;
    if (!el || rowH <= 0) return;
    if (i < 0 || i >= RUNWAY_ROWS) {
      monthRowStart = rowAt(rowAt(monthRowStart, i), -MONTH_BEHIND);
      i = MONTH_BEHIND;
    }
    const smooth = Math.abs(i - firstRow) <= MONTH_PAD;
    if (!smooth) {
      // Render the destination FIRST: mandatory snap clamps an instant scroll to
      // the nearest EXISTING row, so jumping before the window moved lands on the
      // edge of the old one.
      scrollY = renderY = i * rowH;
      await tick();
    }
    el.scrollTo({ top: i * rowH, behavior: smooth ? 'smooth' : 'instant' });
    // An instant scroll fires no scroll event when it lands on the pixel it
    // started from (a just-re-anchored runway), so settling by hand is the only
    // thing that reports the new month; it is idempotent.
    if (!smooth) settleMonth();
  }
  /** "Today" and the date picker. A day outside the runway re-anchors it (and
   *  lands instantly — a smooth scroll across a year is not a UX). */
  async function goToDay(d: string) {
    if (monthRunway) {
      if (!scrollEl || rowH <= 0) {
        ondate(d);
        return;
      }
      // A month opens on the row holding the 1st of the picked day's month —
      // the same anchor the view opens with, so "Today" reads as THIS month
      // rather than as this week plus most of the next month.
      await goToMonthRow(rowIndex(monthRowStart, `${d.slice(0, 7)}-01`));
      return;
    }
    if (!runway || !scrollEl || colW <= 0) {
      ondate(d);
      return;
    }
    // Week views open on the MONDAY of the picked day's week, exactly as the
    // `?date=` load anchors them — "Today" shows this week, not a Fri–Thu span.
    d = mondayOf(d);
    let i = dayIndex(runwayStart, d);
    if (i < 0 || i >= RUNWAY_DAYS) {
      runwayStart = dayAt(mondayOf(d), -RUNWAY_BEHIND);
      i = dayIndex(runwayStart, d);
    }
    // Smooth only while the destination is already rendered: a longer glide
    // would run over empty runway (the window moves on settle), and a jump of
    // weeks reads as a jump anyway.
    const smooth = Math.abs(i - firstIndex) <= RENDER_PAD;
    if (!smooth) {
      // Render the destination FIRST: the mandatory snap clamps an instant
      // scroll to the nearest EXISTING column, so jumping before the window
      // has moved lands on the edge of the old window instead.
      scrollX = renderX = i * colW;
      await tick();
    }
    scrollEl.scrollTo({ left: i * colW, behavior: smooth ? 'smooth' : 'instant' });
    // An instant scroll updates `scrollLeft` synchronously — and lands on the
    // same pixel it started from when the runway was just re-anchored under it,
    // which fires no scroll event at all. Settling by hand is idempotent and the
    // only thing that reports the (completely different) new week.
    if (!smooth) settle();
  }

  // ── "You are here" (owner ask 2026-09-25) ── one minute-resolution clock feeds
  // BOTH the rule's offset and which column counts as today, so a tab left open
  // past midnight moves the highlight and the rule to the new day column instead
  // of drawing yesterday's time forever.
  // TODO(handoff): "now" is the BROWSER's wall clock and `todayIn(TZ)` the
  // browser's timezone — the same mismatch `dayOf` above carries (the data window
  // is resolved in the ORG's tz). A front desk viewing a Lima org from another tz
  // gets the rule at its own local time, consistent with the boxes but not with
  // the clinic. Fixed by the same change: thread the org tz in. See
  // proposals/2026-09-13-pos-packages-plans-s1-followups.md.
  const nowMinutesLocal = () => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  };
  let today = $state(todayIn(TZ));
  let nowMinutes = $state(nowMinutesLocal());
  $effect(() => {
    const tick = () => {
      today = todayIn(TZ);
      nowMinutes = nowMinutesLocal();
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  });
  /** px offset of the rule inside a track, or `null` when now is off-window. */
  const nowTop = $derived(nowLineTop(nowMinutes, START_HOUR, END_HOUR, PX_PER_HOUR));

  type Placed = BookingBox & { top: number; height: number; lane: number; lanes: number };

  /**
   * Greedy lane packing so overlapping boxes (staff overrides, or several
   * resources sharing a week column) sit side by side instead of on top of each
   * other. ponytail: lane count is per COLUMN, not per overlap cluster — a
   * cluster-local count only matters once columns routinely hold 4+ overlaps.
   *
   * The unit is a `BookingBox`, not a booking: `groupBookings` first collapses a
   * merged visit (one client, one chair, back-to-back procedures) into ONE box,
   * so its members never lane-split against each other.
   */
  function pack(list: CalendarBooking[]): Placed[] {
    const laneEnds: number[] = [];
    const placed = groupBookings(list).map((b) => {
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

  /** One box per 15-minute slot: tickets rung up together (a bulk close, one
   *  sale split in two) share a box instead of splitting into hairline lanes;
   *  the hover card lists each of them. */
  type PlacedInvoice = {
    key: string;
    at: string;
    items: CalendarInvoice[];
    total: number;
    currency: string;
    top: number;
    height: number;
    lane: number;
    lanes: number;
  };
  function packInvoices(list: CalendarInvoice[]): PlacedInvoice[] {
    const sorted = [...list].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    const groups = new Map<number, CalendarInvoice[]>();
    for (const inv of sorted) {
      const slot = Math.floor(minutesOf(inv.at) / SNAP_MIN) * SNAP_MIN;
      groups.set(slot, [...(groups.get(slot) ?? []), inv]);
    }
    const laneEnds: number[] = [];
    const placed = [...groups.entries()].map(([slot, items]) => {
      const endMin = slot + 30;
      let lane = laneEnds.findIndex((end) => end <= slot);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(endMin);
      } else laneEnds[lane] = endMin;
      return {
        key: `${items[0].id}+${items.length}`,
        at: items[0].at,
        items,
        total: items.reduce((sum, i) => sum + i.total, 0),
        currency: items[0].currency,
        lane,
        lanes: 1,
        top: ((slot - START_HOUR * 60) / 60) * PX_PER_HOUR,
        height: (30 / 60) * PX_PER_HOUR,
      };
    });
    const lanes = Math.max(1, laneEnds.length);
    return placed.map((p) => ({ ...p, lanes }));
  }

  type Column = {
    key: string;
    /** Runway column index (week views) — where the column is positioned. */
    index: number;
    label: string;
    sub: string | null;
    dot: string | null;
    day: string;
    resourceId: string | null;
    isToday: boolean;
    events: Placed[];
    /** Only when the split is on and the column has no resource (tickets have none). */
    invoices: PlacedInvoice[] | null;
  };
  // ── Optimistic drop overlay (owner report 2026-09-25: "the event expands to
  // the new time, then contracts to its intended duration") ─────────────────
  // A drop used to wait for the server: the box stayed where it was until the
  // reload landed, and a merged visit moved one member per PATCH so the box
  // visibly grew and shrank on the way. The drop now paints the result FIRST —
  // id → its committed window — and the grid renders through that overlay until
  // the fresh `bookings` prop arrives.
  let optimistic = $state<Record<string, { start: string; end: string; resourceId: string }>>({});
  // The server's list is the truth the moment it changes, so a new `bookings`
  // identity retires the whole overlay — success (the new rows already carry the
  // move) and a refused move (the box snaps back) are the same clear.
  // TODO(handoff): the clear is WHOLESALE and keyed on prop identity, so an
  // unrelated refresh landing mid-flight (another dialog's `refresh()`, a tag
  // rename) retires an in-flight drop's overlay early and the box flicks back to
  // its old slot for the rest of the round trip. The runway's week cache made
  // this more likely: a background week arriving mid-drop changes the union and
  // therefore this prop. Fixing it properly means
  // versioning the overlay (drop a key only when the incoming row already
  // matches, or stamp each entry with a request id). Harmless — the next payload
  // is correct either way. Ledger: proposals/2026-09-25-hub-pos-calendar-color-followups.md.
  $effect(() => {
    void bookings;
    optimistic = {};
  });
  /** What the GRID renders: never a copy, only a re-timed row. Lookups that
   *  must read the server's own state (conflict lines, the hover card) keep
   *  `bookings`. */
  const effective = $derived.by(() =>
    Object.keys(optimistic).length === 0
      ? bookings
      : bookings.map((b) => (optimistic[b.id] ? { ...b, ...optimistic[b.id] } : b)),
  );

  const splitOn = $derived(split && invoices !== undefined);
  /** ONE pass over the data per change, not one `filter` per column: the runway
   *  renders up to three screenfuls of columns and holds several weeks of
   *  bookings, so a per-column scan is O(columns × bookings) on every frame the
   *  rendered window moves. */
  function byDay<T>(list: readonly T[], dayOfItem: (item: T) => string): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const item of list) {
      const day = dayOfItem(item);
      const bucket = map.get(day);
      if (bucket) bucket.push(item);
      else map.set(day, [item]);
    }
    return map;
  }
  const bookingsByDay = $derived(byDay(effective, (b) => dayOf(b.start)));
  const invoicesByDay = $derived(byDay(invoices ?? [], (i) => dayOf(i.at)));
  const invoicesOn = (day: string, resourceId: string | null) =>
    splitOn && resourceId === null ? packInvoices(invoicesByDay.get(day) ?? []) : null;

  const columns = $derived.by<Column[]>(() => {
    if (view === 'day') {
      const onDay = bookingsByDay.get(date) ?? [];
      // Aggregate column: every booking of the day side by side, including
      // ones with no live resource column of their own (deactivated/removed
      // staff) — the per-resource columns below are otherwise the ONLY way to
      // see a booking, so one dropping a resource silently hid it. Its empty
      // slots create with resourceId:null (no resource preselected).
      const all: Column = {
        key: '__all__',
        index: 0,
        label: m.cal_col_all(),
        sub: null,
        dot: null,
        day: date,
        resourceId: null,
        isToday: date === today,
        events: pack(onDay),
        invoices: invoicesOn(date, null),
      };
      return [
        all,
        ...resources.map((r, i) => ({
          key: r.id,
          index: i + 1,
          label: r.name,
          sub: null,
          dot: r.color ?? null,
          day: date,
          resourceId: r.id,
          isToday: date === today,
          events: pack(onDay.filter((b) => b.resourceId === r.id)),
          invoices: null,
        })),
      ];
    }
    // Only the columns inside the rendered window exist; the rest of the runway
    // is width. `index` is the ABSOLUTE runway index (what positions the column
    // and what `scrollLeft` is measured in), not the loop counter.
    return Array.from({ length: Math.max(0, renderLast - renderFirst + 1) }, (_, k) => {
      const index = renderFirst + k;
      const d = dayAt(runwayStart, index);
      const at = new Date(`${d}T00:00:00`);
      return {
        key: d,
        index,
        label: formatDate(at, { weekday: 'short' }),
        sub: formatDate(at, { day: 'numeric', month: 'short' }),
        dot: null,
        day: d,
        resourceId: null,
        isToday: d === today,
        events: pack(bookingsByDay.get(d) ?? []),
        invoices: invoicesOn(d, null),
      };
    });
  });

  /** One day of the month grid. `boxes` is already capped at `MONTH_CHIPS`; the
   *  rest is `more`, which opens the DAY view rather than growing the cell. */
  type MonthCell = {
    day: string;
    num: number;
    isToday: boolean;
    boxes: BookingBox[];
    more: number;
  };
  const monthRows = $derived.by(() =>
    Array.from({ length: Math.max(0, rowLast - rowFirst + 1) }, (_, k) => {
      const index = rowFirst + k;
      const monday = rowAt(monthRowStart, index);
      return {
        key: monday,
        index,
        cells: Array.from({ length: 7 }, (_, d) => {
          const day = dayAt(monday, d);
          // The SAME one-pass day bucket the week columns read — a rendered
          // window is ~90 cells, so a `filter` per cell is O(cells × bookings).
          // A merged visit collapses to ONE box here too.
          const boxes = groupBookings(bookingsByDay.get(day) ?? []);
          return {
            day,
            num: Number(day.slice(8, 10)),
            isToday: day === today,
            boxes: boxes.slice(0, MONTH_CHIPS),
            more: Math.max(0, boxes.length - MONTH_CHIPS),
          } satisfies MonthCell;
        }),
      };
    }),
  );
  /** A month cell's day number and its "+N more" line both open the DAY view on
   *  that date — ONE navigation carrying both the view and the date. */
  const openDay = (day: string) => onview('day', day);

  const rangeLabel = $derived.by(() => {
    if (view === 'day') {
      return formatDate(`${date}T00:00:00`, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });
    }
    // Month: the month the visible rows mostly belong to, formatted exactly like
    // the date picker's own heading.
    if (monthRunway)
      return formatDate(`${labelMonth}-01T00:00:00`, { month: 'long', year: 'numeric' });
    // The RUNWAY's visible window, not the view's old date window: after a
    // scroll the label is the only thing naming where the grid is.
    const first = new Date(`${visibleDays[0]}T00:00:00`);
    const last = new Date(`${visibleDays[visibleDays.length - 1]}T00:00:00`);
    const same = first.getMonth() === last.getMonth();
    return `${formatDate(first, { day: 'numeric', ...(same ? {} : { month: 'short' }) })} – ${formatDate(last, { day: 'numeric', month: 'short' })}`;
  });

  const viewItems = $derived([
    { value: 'day', label: m.cal_view_day() },
    { value: 'week', label: m.cal_view_week() },
    { value: 'month', label: m.cal_view_month() },
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
  /** The day(s) currently on screen — highlighted in the mini-grid. */
  const selectedDays = $derived(new Set(monthRunway ? monthVisibleDays : visibleDays));
  function pickDate(d: string) {
    goToDay(d);
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

  // ── Configurable hover-card rows (per viewer) ─────────────────────────────
  // Same UX as a DataTable column menu: a checkbox per field plus a drag handle
  // to reorder — and it lives in the TOOLBAR KEBAB, next to the event-block
  // section, never inside the card. It shipped inside the card once and the drag
  // was unusable (owner, 2026-09-25: "field editor should be in its own popover,
  // not in the same hover popover — when dragging the elements to reorder, the
  // popover closes and bugs out"): the card is an `interactive` Zag tooltip, so a
  // pointer drag that leaves its content triggers the close intent, and a
  // portalled `Popover` opened from inside it leaves the content by definition.
  // The kebab is a real `Popover` where both problems are absent.
  //
  // TODO(handoff): this is a per-VIEWER preference, not an RBAC restriction —
  // the owner's ask ("some users via rbac don't care about seeing what the
  // appointment cost is") is only half served. Hiding `chips` stops it being
  // rendered, but the accrual values still ship to the browser in the POS
  // page's load data, and any viewer can re-enable the row. Enforcing it needs
  // a permission (e.g. `pos.cost:view`) checked server-side in
  // `/pos/appointments`'s loader plus a prop here that FORCES the field hidden
  // and drops its menu row. Ledger: append to the meta-repo proposal
  // `proposals/2026-09-25-hub-pos-calendar-color-followups.md`.
  let hoverHidden = $state<Set<HoverField | HoverSubField>>(new Set());
  let hoverOrder = $state<HoverField[]>([...HOVER_FIELDS]);
  $effect(() => {
    try {
      const raw = localStorage.getItem(HOVER_FIELDS_KEY);
      const merged = mergeFields(raw ? JSON.parse(raw) : null, HOVER_FIELDS, HOVER_SUB_FIELDS);
      hoverHidden = merged.hidden;
      hoverOrder = merged.order;
    } catch {
      /* per-viewer convenience only — defaults already stand */
    }
  });
  function persist(key: string, hidden: ReadonlySet<string>, order: readonly string[]) {
    try {
      localStorage.setItem(key, JSON.stringify({ hidden: [...hidden], order: [...order] }));
    } catch {
      /* per-viewer convenience only */
    }
  }
  /** Toggle one key in a hidden-set, returning the new set (Svelte needs the
   *  reassignment, and both lists want the identical flip). */
  const toggled = <K extends string>(hidden: ReadonlySet<K>, key: K): Set<K> => {
    const next = new Set(hidden);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  };
  function toggleHoverField(key: string) {
    hoverHidden = toggled(hoverHidden, key as HoverField | HoverSubField);
    persist(HOVER_FIELDS_KEY, hoverHidden, hoverOrder);
  }
  function moveHoverField(from: string, to: string) {
    hoverOrder = moveField(hoverOrder, from, to);
    persist(HOVER_FIELDS_KEY, hoverHidden, hoverOrder);
  }
  /** Body rows, in order. `status` is skipped: it renders in the head next to
   *  the time range (the card's anchor row), so only its toggle is meaningful. */
  const hoverRows = $derived(visibleFields(hoverOrder, hoverHidden).filter((f) => f !== 'status'));

  // ── Configurable event-block lines (per viewer) ───────────────────────────
  // Owner ask 2026-09-25: "some users want to see certain information at the top
  // of event blocks, especially when the event blocks are very small … I want the
  // customer name to be at the very top and completely hide the event time."
  // Same prefs contract as the hover card, its own localStorage key, and the
  // SAME list component in the toolbar kebab.
  let blockHidden = $state<Set<BlockField>>(new Set());
  let blockOrder = $state<BlockField[]>([...BLOCK_FIELDS]);
  $effect(() => {
    try {
      const raw = localStorage.getItem(BLOCK_FIELDS_KEY);
      const merged = mergeFields(raw ? JSON.parse(raw) : null, BLOCK_FIELDS);
      blockHidden = merged.hidden;
      blockOrder = merged.order;
    } catch {
      /* per-viewer convenience only — defaults already stand */
    }
  });
  function toggleBlockField(key: string) {
    blockHidden = toggled(blockHidden, key as BlockField);
    persist(BLOCK_FIELDS_KEY, blockHidden, blockOrder);
  }
  function moveBlockField(from: string, to: string) {
    blockOrder = moveField(blockOrder, from, to);
    persist(BLOCK_FIELDS_KEY, blockHidden, blockOrder);
  }
  /** In-flow block lines, in order — `tags` is excluded because its marks are
   *  absolutely positioned in the corner, so the FIRST entry here is genuinely
   *  the block's lead line and gets `.evt-lead`. */
  const blockRows = $derived(visibleFields(blockOrder, blockHidden).filter((f) => f !== 'tags'));
  /** Tag marks keep their corner slot: toggleable, never orderable. */
  const BLOCK_LOCKED = ['tags'];
  /** A month chip's single text line: the viewer's first non-time BLOCK field, so
   *  the month cells lead with whatever the week blocks lead with. The time is
   *  always the chip's first element (a month cell has no time axis to place it
   *  on), so hiding `time` in the kebab does not empty the chip. */
  function chipLabel(box: BookingBox): string {
    for (const f of blockRows) {
      if (f === 'service') return box.members.map((mb) => eventTitle(mb.eventTypeId)).join(', ');
      // A booking with no client on file falls through to the service, so a
      // chip is never just a time.
      if (f === 'client' && box.lead.attendeeName) return box.lead.attendeeName;
    }
    return eventTitle(box.lead.eventTypeId);
  }

  const fieldLabel = (f: HoverField): string =>
    (
      ({
        status: m.sched_cal_status,
        title: m.sched_cal_service,
        staff: m.cal_staff,
        client: m.cal_client,
        tags: m.tags_label,
        notes: m.sched_detail_notes,
        chips: m.cal_field_chips,
        actions: m.crm_actions,
      }) as Record<HoverField, () => string>
    )[f]();
  const subFieldLabel = (f: HoverSubField): string =>
    (({ phone: m.sched_book_phone }) as Record<HoverSubField, () => string>)[f]();
  const hoverFieldItems = $derived(
    HOVER_FIELDS.map((f) => ({
      key: f,
      label: fieldLabel(f),
      children: hoverChildren(f).map((c) => ({ key: c, label: subFieldLabel(c) })),
    })),
  );
  const blockFieldItems = $derived(
    BLOCK_FIELDS.map((f) => ({
      key: f,
      label: (
        {
          time: m.cal_field_time,
          service: m.sched_cal_service,
          client: m.cal_client,
          tags: m.tags_label,
        } as Record<BlockField, () => string>
      )[f](),
    })),
  );

  const DAY_START = START_HOUR * 60;
  const DAY_END = (END_HOUR + 1) * 60; // the track renders END_HOUR's full row
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const minLabel = (min: number) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;

  /** Pointer y over a track → snapped minutes inside the rendered window. */
  function snappedMinutes(clientY: number, track: HTMLElement): number {
    const rect = track.getBoundingClientRect();
    const raw = DAY_START + ((clientY - rect.top) / PX_PER_HOUR) * 60;
    const snapped = Math.round(raw / SNAP_MIN) * SNAP_MIN;
    return Math.min(END_HOUR * 60, Math.max(DAY_START, snapped));
  }
  /** Grid click → a snapped `HH:MM` inside the rendered window. */
  function slotAt(event: MouseEvent, column: Column) {
    const min = snappedMinutes(event.clientY, event.currentTarget as HTMLElement);
    onslot?.(column.day, minLabel(min), column.resourceId);
  }

  // ── External drop (HTML5 DnD from a tray) ── the hint line follows the
  // snapped slot; the handlers only engage for our own dataTransfer type.
  let dropHint = $state<{ colKey: string; top: number; label: string } | null>(null);
  function onTrackDragOver(e: DragEvent, col: Column) {
    if (!ondropexternal || !e.dataTransfer?.types.includes(CALENDAR_DROP_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const min = snappedMinutes(e.clientY, e.currentTarget as HTMLElement);
    dropHint = {
      colKey: col.key,
      top: ((min - DAY_START) / 60) * PX_PER_HOUR,
      label: minLabel(min),
    };
  }
  function onTrackDrop(e: DragEvent, col: Column) {
    const payload = e.dataTransfer?.getData(CALENDAR_DROP_MIME);
    dropHint = null;
    if (!ondropexternal || !payload) return;
    e.preventDefault();
    const min = snappedMinutes(e.clientY, e.currentTarget as HTMLElement);
    void ondropexternal(payload, col.day, minLabel(min), col.resourceId);
  }

  /** Off-hours bands (px) for a column: before the earliest open and after the
   *  latest close of the resources the column stands for. */
  function offHours(col: Column): { top: number; height: number }[] {
    if (!hours) return [];
    const weekday = new Date(`${col.day}T00:00:00`).getDay();
    // Only resources WITH a schedule take part: a machine with no hours at all
    // is "unknown", not "closed", and must not shade its column (or the envelope).
    const ids = (col.resourceId ? [col.resourceId] : resources.map((r) => r.id)).filter(
      (id) => hours[id],
    );
    if (ids.length === 0) return [];
    let open = Infinity;
    let close = -Infinity;
    for (const id of ids) {
      const h = hours[id]?.[weekday];
      if (!h) continue;
      open = Math.min(open, h[0]);
      close = Math.max(close, h[1]);
    }
    const bands: [number, number][] = [];
    if (open === Infinity) bands.push([DAY_START, DAY_END]);
    else {
      if (open > DAY_START) bands.push([DAY_START, Math.min(open, DAY_END)]);
      if (close < DAY_END) bands.push([Math.max(close, DAY_START), DAY_END]);
    }
    return bands
      .filter(([a, b]) => b > a)
      .map(([a, b]) => ({
        top: ((a - DAY_START) / 60) * PX_PER_HOUR,
        height: ((b - a) / 60) * PX_PER_HOUR,
      }));
  }

  // ── Drag to move / resize ── pointer events on the box itself; the window
  // listeners below only run while a drag is in flight. A 4px dead zone keeps
  // plain clicks (open) from registering as a zero-length move.
  type DragMode = 'move' | 'resize';
  let drag = $state<{
    /** The BOX being dragged (a merged visit moves as one piece). */
    boxKey: string;
    mode: DragMode;
    x0: number;
    y0: number;
    /** The column the box came FROM (`colKey` below tracks where it is heading). */
    fromKey: string;
    colKey: string;
    startMin: number;
    endMin: number;
    active: boolean;
    dMin: number;
  } | null>(null);
  let colsEl = $state<HTMLElement | null>(null);
  let colRects: { key: string; left: number; right: number }[] = [];
  /** Set for one tick after a drag commit so the box's click doesn't open it. */
  let suppressClick = false;

  // TODO(handoff): a drag cannot cross the runway's visible edge — there is no
  // auto-scroll while the pointer is held at the left/right edge, so moving a
  // booking to next week means scrolling first, then dragging (the same two
  // steps the old week navigation needed). `colRects` is rebuilt at drag start
  // only, so adding edge auto-scroll also means re-measuring it as the scroller
  // moves. Ledger: proposals/2026-09-25-hub-pos-calendar-color-followups.md.
  function beginDrag(e: PointerEvent, b: Placed, col: Column, mode: DragMode) {
    if (!onmove || e.button !== 0) return;
    e.stopPropagation();
    colRects = columns.map((c, i) => {
      const r = (colsEl?.children[i] as HTMLElement | undefined)?.getBoundingClientRect();
      return { key: c.key, left: r?.left ?? 0, right: r?.right ?? 0 };
    });
    drag = {
      boxKey: b.key,
      mode,
      x0: e.clientX,
      y0: e.clientY,
      fromKey: col.key,
      colKey: col.key,
      startMin: minutesOf(b.start),
      endMin: Math.max(minutesOf(b.start) + SNAP_MIN, minutesOf(b.end)),
      active: false,
      dMin: 0,
    };
  }
  function onDragMove(e: PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.active && Math.hypot(dx, dy) < 4) return;
    drag.active = true;
    drag.dMin = Math.round(((dy / PX_PER_HOUR) * 60) / SNAP_MIN) * SNAP_MIN;
    if (drag.mode === 'move') {
      const hit = colRects.find((r) => e.clientX >= r.left && e.clientX < r.right);
      if (hit) drag.colKey = hit.key;
    }
  }
  /** Where the dragged box would land — rendered as a ghost in the target column. */
  const ghost = $derived.by(() => {
    if (!drag?.active) return null;
    // The result lands ON the snap grid (not just a snapped delta), so a
    // booking created off-grid straightens out the first time it is moved.
    const snap = (min: number) => Math.round(min / SNAP_MIN) * SNAP_MIN;
    let s = drag.startMin;
    let en = drag.endMin;
    if (drag.mode === 'move') {
      const len = en - s;
      s = Math.max(DAY_START, Math.min(DAY_END - len, snap(s + drag.dMin)));
      en = s + len;
    } else {
      en = Math.max(s + SNAP_MIN, Math.min(DAY_END, snap(en + drag.dMin)));
    }
    return {
      boxKey: drag.boxKey,
      colKey: drag.colKey,
      startMin: s,
      endMin: en,
      top: ((s - DAY_START) / 60) * PX_PER_HOUR,
      height: Math.max(18, ((en - s) / 60) * PX_PER_HOUR),
    };
  });

  /**
   * The visit the in-flight drag would MERGE into, or `null` — derived from
   * `drag`/`ghost` alone, no extra state.
   *
   * ONE value drives the drag-over outline, the ghost's "Merge into visit"
   * label and the drop that opens the merge dialog, so what the operator is
   * promised mid-drag is exactly what the drop commits (owner ask 2026-09-25:
   * clear feedback WHILE dragging over a compatible event).
   */
  const mergeTarget = $derived.by(() => {
    const d = drag;
    const g = ghost;
    if (!d || !g || d.mode !== 'move') return null;
    const target = columns.find((c) => c.key === g.colKey);
    // Same `fromKey` rule as `onDragEnd`: day view renders one booking in two
    // columns, so the box must come from the column the drag STARTED in.
    const box = columns.find((c) => c.key === d.fromKey)?.events.find((x) => x.key === d.boxKey);
    if (!target || !box) return null;
    const resourceId = target.resourceId ?? box.lead.resourceId;
    const onto = mergeTargetBox({
      boxes: target.events,
      dragged: box,
      startMin: g.startMin,
      resourceId,
      minutesOf,
    });
    return onto ? { colKey: target.key, box, onto, resourceId } : null;
  });

  async function onDragEnd() {
    const d = drag;
    const g = ghost;
    // Read BEFORE `drag` is cleared — it is the same derived value the outline
    // and the ghost label were showing a frame ago.
    const mt = mergeTarget;
    drag = null;
    if (!d || !g) return;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    const target = columns.find((c) => c.key === g.colKey);
    // The box is read from the column the drag STARTED in (`fromKey`, not the
    // moving `colKey`): day view renders the same booking twice (aggregate +
    // its resource column) and the two columns can group it differently, so a
    // global lookup could grab the other column's box.
    const box = columns.find((c) => c.key === d.fromKey)?.events.find((x) => x.key === d.boxKey);
    if (!target || !box) return;
    const resourceId = target.resourceId ?? box.lead.resourceId;
    // Same local-wall-time policy as `dayOf`/`minutesOf` above (browser tz).
    const at = (min: number) => new Date(`${target.day}T${minLabel(min)}:00`).toISOString();

    // Dropped ON another event for the SAME client and chair → offer to merge the
    // two into one visit instead of stacking them (owner ask 2026-09-25). The
    // predicate is `mergeTarget`, the very value the outline was drawn from.
    if (mt && mt.box.key === box.key) {
      mergeAsk = {
        id: box.lead.id,
        withId: mt.onto.lead.id,
        service: eventTitle(box.lead.eventTypeId),
        client: box.lead.attendeeName ?? '—',
        minutes: g.endMin - g.startMin,
        next: { start: at(g.startMin), end: at(g.endMin), resourceId },
      };
      return;
    }

    // ONE call, whatever the box is. A container visit is a shared WINDOW since
    // PR 370, so its move and its resize are both "put the window here" — the same
    // `{start,end}` a single booking gets, routed to `moveGroup` (`group: true`)
    // so every member lands in one transaction behind one conflict check. The
    // old N-PATCH loop is what made a resize fail ("end must be after start",
    // it patched the last member only) and a move flicker.
    const next = { start: at(g.startMin), end: at(g.endMin), resourceId };
    const visit = box.members.length > 1;
    // Nothing to commit when the box lands exactly where it already is. Legacy
    // PR 369 members still carry distinct windows, so this is false for them and
    // the first move normalises the group.
    if (
      box.members.every(
        (mb) => mb.start === next.start && mb.end === next.end && mb.resourceId === resourceId,
      )
    )
      return;
    const opts: MoveOpts | undefined = visit ? { group: true } : undefined;
    // Paint the result before the round trip: every member of the box, since the
    // whole window moves.
    const ids = box.members.map((mb) => mb.id);
    optimistic = { ...optimistic, ...Object.fromEntries(ids.map((id) => [id, next])) };
    const res = await onmove?.(box.lead.id, next, opts);
    if (res?.conflicts?.length) {
      // Refused: drop the overlay now so the box snaps back behind the dialog
      // instead of sitting in a slot the server rejected.
      clearOptimistic(ids);
      conflictAsk = { id: box.lead.id, next, conflicts: res.conflicts, opts };
    }
  }
  /** Retire overlay entries the server refused (a landed move is retired by the
   *  fresh `bookings` instead). */
  function clearOptimistic(ids: string[]) {
    const rest = { ...optimistic };
    for (const id of ids) delete rest[id];
    optimistic = rest;
  }
  function openBox(id: string) {
    if (suppressClick) return;
    onopen(id);
  }

  // ── Merged visits (owner ask 2026-09-25) ──────────────────────────────────
  /** Which procedure of a merged visit the hover card is showing, per box key.
   *  Falls back to the first one, so an ordinary booking needs no entry. */
  let memberSel = $state<Record<string, string>>({});
  const memberOf = (box: Placed): CalendarBooking =>
    box.members.find((mb) => mb.id === memberSel[box.key]) ?? box.lead;
  /** Tag marks on a box: the union over its procedures (dedup by origin+id). */
  function boxTags(box: Placed): CalendarBookingTag[] {
    if (box.members.length === 1) return box.lead.tags ?? [];
    const seen = new Set<string>();
    const out: CalendarBookingTag[] = [];
    for (const mb of box.members) {
      for (const t of mb.tags ?? []) {
        const key = t.origin + t.id;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(t);
      }
    }
    return out;
  }
  /** Take one procedure out of its visit. The server restores its pre-merge
   *  duration (and destroys a 2-member container), so `next` is only the shape
   *  the callback needs — the conflict dialog's retry reuses it verbatim. */
  async function separate(mb: CalendarBooking) {
    const next = { start: mb.start, end: mb.end, resourceId: mb.resourceId };
    const opts: MoveOpts = { detach: true };
    const res = await onmove?.(mb.id, next, opts);
    // The restored placement can land on a THIRD booking — same dialog, and its
    // "Move anyway" re-sends the detach with `overrideConflicts`.
    if (res?.conflicts?.length) conflictAsk = { id: mb.id, next, conflicts: res.conflicts, opts };
  }

  let mergeAsk = $state<{
    id: string;
    withId: string;
    service: string;
    /** The dragged booking's own length — how much the visit grows by. */
    minutes: number;
    client: string;
    next: { start: string; end: string; resourceId: string };
  } | null>(null);
  /** The merge re-times the dragged booking to the visit's end, which can clash
   *  with a THIRD booking — same conflict dialog as a plain move. */
  async function commitMerge() {
    const ask = mergeAsk;
    if (!ask) return;
    const res = await onmove?.(ask.id, ask.next, { mergeWith: ask.withId });
    mergeAsk = null;
    if (res?.conflicts?.length)
      conflictAsk = { id: ask.id, next: ask.next, conflicts: res.conflicts };
  }

  // ── Reschedule conflict (owner ask 2026-09-25) ────────────────────────────
  // The check itself is justified (the chair is already booked, buffers
  // included), so the fix is telling the operator WHAT it clashes with and
  // offering the three real answers — never a toast with a raw ISO range.
  // Nothing has to be reverted for "Pick another time": boxes render from the
  // server's list, so a refused move never left its old slot.
  // `opts` is remembered because "Move anyway" must re-send the SAME operation:
  // a container move re-sends `{ group: true }`, a separate re-sends
  // `{ detach: true }`. Retrying a container as N plain reschedules (or a detach
  // as a move) would quietly commit something else than what was refused.
  let conflictAsk = $state<{
    id: string;
    next: { start: string; end: string; resourceId: string };
    conflicts: MoveConflict[];
    opts?: MoveOpts;
  } | null>(null);
  const conflictLines = $derived(
    (conflictAsk?.conflicts ?? []).map((c) => {
      const b = bookings.find((x) => x.id === c.id);
      return conflictLine(c, {
        hhmm,
        service: b ? eventTitle(b.eventTypeId) : null,
        client: b?.attendeeName ?? null,
        staff: resources.find((r) => r.id === c.resourceId)?.name ?? null,
      });
    }),
  );
  /** The clash can become a MERGE when it is the only one and it is the same
   *  client on the target chair — exactly the drag-onto-an-event case, reached
   *  by dropping on the gap next to it instead of on the box. */
  const conflictMergeWith = $derived.by(() => {
    const ask = conflictAsk;
    if (!ask || ask.conflicts.length !== 1) return null;
    // A whole visit cannot nest into another one, and a separate is the opposite
    // intent — neither refusal is answerable by merging.
    if (ask.opts?.group || ask.opts?.detach) return null;
    const dragged = bookings.find((x) => x.id === ask.id);
    const other = bookings.find((x) => x.id === ask.conflicts[0].id);
    if (!dragged || !other || other.resourceId !== ask.next.resourceId) return null;
    const key = clientKeyOf(dragged);
    return key !== null && key === clientKeyOf(other) ? other : null;
  });
  async function commitConflict(opts: MoveOpts) {
    const ask = conflictAsk;
    conflictAsk = null;
    if (!ask) return;
    // The refused operation first, the answer on top: `{ group: true }` +
    // `{ overrideConflicts: true }` is still one container call.
    await onmove?.(ask.id, ask.next, { ...ask.opts, ...opts });
  }
</script>

<svelte:window
  onpointermove={drag ? onDragMove : undefined}
  onpointerup={drag ? onDragEnd : undefined}
  onpointercancel={drag ? () => (drag = null) : undefined}
/>

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
      onclick={() => step(-1)}
    >
      <ChevronLeft size={iconSizes.md} />
    </Button>
    <Popover bind:open={pickerOpen} placement="bottom">
      {#snippet trigger()}
        <!-- The spinner is absolutely positioned inside the label's fixed
             min-width, so a week fetch can never shift the toolbar. -->
        <span class="cal-date" aria-busy={busy}>
          {rangeLabel}
          {#if busy}<Spinner size="xs" class="cal-busy" />{/if}
        </span>
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
      onclick={() => step(1)}
    >
      <ChevronRight size={iconSizes.md} />
    </Button>
    <Button variant="ghost" size="sm" onclick={() => goToDay(today)}>{m.sched_today()}</Button>
  </div>
  <!-- ONE kebab holds every per-viewer calendar config (owner directive
       2026-09-25): the Invoiced|Scheduled split, the two colour sources and the
       event-block layout. A `Popover`, not a `Dropdown`: it holds CONTROLS, not
       menu items. Always rendered — the block layout needs no props. -->
  <Popover placement="bottom-end">
    {#snippet trigger()}
      <span class="cc-trigger">
        <MoreVertical size={iconSizes.sm} />
        <span class="sr-only">{m.cal_options_label()}</span>
      </span>
    {/snippet}
    <div class="cc-panel">
      <!-- Tickets are not on the month grid (see the TODO by `.m-body` below), so
           the split has nothing to toggle there. -->
      {#if invoices !== undefined && !monthRunway}
        <Toggle
          size="sm"
          checked={split}
          label={m.cal_split_label()}
          onchange={(v) => onsplit?.(v)}
        />
      {/if}
      {#if oncolorby}
        <ColorSourcePicker
          label={m.cal_color_block()}
          value={blockColorBy}
          options={colorOptions}
          onchange={(v) => oncolorby?.({ block: colorSourceOf(v), sliver: sliverColorBy })}
        />
        <ColorSourcePicker
          label={m.cal_color_sliver()}
          value={sliverColorBy}
          options={colorOptions}
          onchange={(v) => oncolorby?.({ block: blockColorBy, sliver: colorSourceOf(v) })}
        />
      {/if}
      {#if onweekdays && runway}
        <!-- Per-viewer preference (owner ask 2026-09-25): how many day columns
             the week runway shows at once. Day/month views ignore it, so the
             stepper is hidden rather than inert there. -->
        <div class="wd-row">
          <span class="t-caption wd-label">{m.cal_week_days_label()}</span>
          <div class="wd-stepper">
            <Button
              variant="ghost"
              size="xs"
              shape="icon"
              aria-label={m.cal_week_days_fewer()}
              disabled={weekDays <= WEEK_DAYS_MIN}
              onclick={() => stepWeekDays(-1)}
            >
              <Minus size={iconSizes.xs} />
            </Button>
            <span class="wd-value">{weekDays}</span>
            <Button
              variant="ghost"
              size="xs"
              shape="icon"
              aria-label={m.cal_week_days_more()}
              disabled={weekDays >= WEEK_DAYS_MAX}
              onclick={() => stepWeekDays(1)}
            >
              <Plus size={iconSizes.xs} />
            </Button>
          </div>
        </div>
      {/if}
      <FieldsList
        heading={m.cal_block_fields()}
        fields={blockFieldItems}
        hidden={blockHidden}
        order={blockOrder}
        ontoggle={toggleBlockField}
        onmove={moveBlockField}
        lockedKeys={BLOCK_LOCKED}
      />
      <FieldsList
        heading={m.cal_card_fields()}
        fields={hoverFieldItems}
        hidden={hoverHidden}
        order={hoverOrder}
        ontoggle={toggleHoverField}
        onmove={moveHoverField}
        lockedKeys={['status']}
      />
    </div>
  </Popover>
  {#if tools}<div class="cal-tools">{@render tools()}</div>{/if}
</div>

<!-- The grid region owns scroll (the toolbar above it never scrolls away):
     one scroll owner per screen, per the layout contract. In the week views it
     scrolls BOTH axes: x walks the day runway (snapped per day), y is the time
     axis (free). `is-runway` only goes on once the columns are measured, so SSR
     and the first paint still use the plain flex layout below. -->
<div
  class="cal-scroll"
  class:is-week={runway}
  class:is-runway={measured}
  class:is-month={monthRunway}
  class:is-month-runway={monthMeasured}
  bind:this={scrollEl}
  onscroll={runway || monthRunway ? onScroll : undefined}
  onscrollend={(runway || monthRunway) && HAS_SCROLLEND ? settle : undefined}
>
  {#if monthRunway}
    <!-- Month = a VERTICAL runway of ISO-week rows: the weekday header is the
         only sticky part, `.m-rows` is the runway (its height is what makes the
         scroller scroll a year) and the rendered rows sit on it absolutely at
         `index * rowH`. Before the first measurement the rows stay in normal
         flow, which is exactly the classic 6-row grid of `date`'s month — so SSR
         and the first paint render a correct month with no JS.
         Resources are irrelevant here (a cell shows chips, not chairs), so the
         "no resources" empty state below is deliberately not in this branch. -->
    <div class="month" class:is-runway={monthMeasured}>
      <div class="m-weekdays">
        {#each pickerWeekdays as w, i (i)}
          <span>{w}</span>
        {/each}
      </div>
      <div
        class="m-rows"
        bind:this={monthRowsEl}
        style={monthMeasured ? `height:${RUNWAY_ROWS * rowH}px` : undefined}
      >
        {#each monthRows as row (row.key)}
          <div class="m-row" style={monthMeasured ? `top:${row.index * rowH}px` : undefined}>
            {#each row.cells as cell (cell.day)}
              <div
                class="m-cell"
                class:is-today={cell.isToday}
                class:is-outside={cell.day.slice(0, 7) !== labelMonth}
              >
                <!-- Empty-space affordance, the same full-area shared Button the
                     week tracks use — it sits FIRST so `.m-body` (positioned, and
                     later in tree order) paints and clicks above it. -->
                {#if onslot}
                  <Button
                    variant="ghost"
                    class="slot-layer"
                    aria-label={m.cal_new_here()}
                    onclick={() => onslot?.(cell.day, MONTH_NEW_TIME, null)}
                  >
                    <Plus size={iconSizes.sm} />
                  </Button>
                {/if}
                <!-- TODO(handoff): the month grid carries no tickets
                     (`invoices`/`split`), no drag-move/resize and no external
                     drop, and its chips have no hover card — a month cell has no
                     time axis to drop onto or resize against, and three one-line
                     chips have no room for a popover trigger that is not also the
                     open action. The week runway keeps all four. Wiring them here
                     means a per-cell drop target that snaps to a DAY (not a
                     minute) plus a chip-level Tooltip, and the split would need a
                     per-cell invoiced/scheduled divider. Ledger: meta-repo
                     `proposals/2026-09-25-hub-pos-calendar-color-followups.md`. -->
                <div class="m-body">
                  <!-- A single click opens the day view, so the owner's
                       double-click gesture lands there too — a day number that
                       did nothing until the second click is a dead affordance. -->
                  <Button
                    variant="ghost"
                    size="xs"
                    class="m-num"
                    aria-label={formatDate(`${cell.day}T00:00:00`, {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    })}
                    onclick={() => openDay(cell.day)}
                    ondblclick={() => openDay(cell.day)}
                  >
                    {cell.num}
                  </Button>
                  {#each cell.boxes as box (box.key)}
                    {@const b = box.lead}
                    {@const tone = STATUS_TONE[b.status] ?? null}
                    {@const block = bookingColor(blockColorBy, b, colorCtx)}
                    {@const sliver =
                      sliverColorBy === 'status'
                        ? (TONE_BORDER[tone ?? ''] ?? 'var(--color-border-strong)')
                        : bookingColor(sliverColorBy, b, colorCtx)}
                    <!-- Same colour contract as an event block, so the viewer's
                         two colour sources apply on both surfaces. -->
                    <Button
                      variant="ghost"
                      size="xs"
                      class="m-chip {b.status} {blockColorBy === 'status'
                        ? tone
                          ? `tone-${tone}`
                          : 'tone-neutral'
                        : block
                          ? 'has-color'
                          : 'tone-neutral'}"
                      style="border-left-color:{sliver ?? 'var(--color-accent)'};--evt-c:{block ??
                        'transparent'}"
                      onclick={() => onopen(b.id)}
                    >
                      <span class="m-chip-t">{hhmm(box.start)}</span>
                      <span class="m-chip-n truncate">{chipLabel(box)}</span>
                    </Button>
                  {/each}
                  {#if cell.more > 0}
                    <Button
                      variant="ghost"
                      size="xs"
                      class="m-more"
                      onclick={() => openDay(cell.day)}
                    >
                      {m.cal_month_more({ n: cell.more })}
                    </Button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/each}
      </div>
    </div>
  {:else if resources.length === 0}
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

      <!-- In runway mode `.cols` is the full runway: its width is what makes the
           scroller scroll a year, and the rendered columns sit on it absolutely
           at `index * colW`. Its height is stated explicitly because absolute
           children contribute none. -->
      <div
        class="cols"
        bind:this={colsEl}
        style={measured
          ? `width:${RUNWAY_DAYS * colW}px;height:calc(var(--cal-head-h) + ${TRACK_H}px)`
          : undefined}
      >
        {#each columns as col (col.key)}
          <div
            class="col"
            class:is-today={col.isToday}
            class:is-all={col.key === '__all__'}
            style={measured ? `left:${col.index * colW}px;width:${colW}px` : undefined}
          >
            <div class="col-head" title={col.label}>
              {#if col.dot}<span class="dot" style="background:{col.dot}"></span>{/if}
              <span class="head-name truncate">{col.label}</span>
              {#if col.sub}<span class="head-sub">{col.sub}</span>{/if}
              {#if col.invoices}
                <span class="head-split">
                  <span>{m.cal_col_invoiced()}</span><span>{m.cal_col_scheduled()}</span>
                </span>
              {/if}
            </div>

            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <!-- Drop target only; the keyboard path is the tray's "Pick a time". -->
            <div
              class="track"
              class:is-split={col.invoices !== null}
              style="height:{TRACK_H}px;--sx:{col.invoices ? '50%' : '0%'};--sw:{col.invoices
                ? '50%'
                : '100%'}"
              ondragover={(e) => onTrackDragOver(e, col)}
              ondragleave={() => (dropHint = null)}
              ondrop={(e) => onTrackDrop(e, col)}
            >
              {#each HOURS as h (h)}
                <div class="gridline" style="top:{(h - START_HOUR) * PX_PER_HOUR}px"></div>
              {/each}

              {#if col.invoices}<div class="split-line"></div>{/if}
              {#each offHours(col) as band, i (i)}
                <div class="offhours" style="top:{band.top}px;height:{band.height}px"></div>
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

              {#each col.events as box (box.key)}
                <!-- `box.lead` is the box's identity (chair, client, colour); a
                     MERGED visit adds more `members`, and the hover card's rows
                     follow the SELECTED one. -->
                {@const b = box.lead}
                {@const sel = memberOf(box)}
                {@const visit = box.members.length > 1}
                {@const tone = STATUS_TONE[b.status] ?? null}
                {@const selTone = STATUS_TONE[sel.status] ?? null}
                {@const block = bookingColor(blockColorBy, b, colorCtx)}
                {@const sliver =
                  sliverColorBy === 'status'
                    ? (TONE_BORDER[tone ?? ''] ?? 'var(--color-border-strong)')
                    : bookingColor(sliverColorBy, b, colorCtx)}
                <Tooltip
                  asChild
                  interactive
                  bare
                  placement="right"
                  openDelay={180}
                  closeDelay={320}
                  id="evt-{box.key}"
                >
                  {#snippet content()}
                    <div class="hover-card">
                      <div class="hc-head">
                        <span class="t-label hc-time">{hhmm(sel.start)} – {hhmm(sel.end)}</span>
                        <span class="hc-head-end">
                          {#if !hoverHidden.has('status')}
                            {#if selTone}
                              <Badge variant="semantic" value={selTone} size="sm"
                                >{statusLabel(sel.status)}</Badge
                              >
                            {:else}
                              <Badge size="sm">{statusLabel(sel.status)}</Badge>
                            {/if}
                          {/if}
                        </span>
                      </div>
                      {#if visit}
                        <!-- A merged visit lists every procedure with its own time
                             range; picking one points the rows, the stock chips and
                             the actions below at THAT procedure (they are per
                             booking: status changes, charges, accruals). -->
                        <div class="hc-members" role="group" aria-label={m.cal_visit_label()}>
                          {#each box.members as mb (mb.id)}
                            <Button
                              variant="ghost"
                              size="sm"
                              class="hc-member {mb.id === sel.id ? 'is-sel' : ''}"
                              aria-pressed={mb.id === sel.id}
                              onclick={() => (memberSel = { ...memberSel, [box.key]: mb.id })}
                            >
                              <!-- Every member shares the container's time range, so the
                                   pill shows what the procedure is worth on its own. -->
                              <span class="hc-m-time t-caption"
                                >{m.cal_visit_member_length({
                                  minutes:
                                    mb.groupLength ?? minutesOf(mb.end) - minutesOf(mb.start),
                                })}</span
                              >
                              <span class="hc-m-name">{eventTitle(mb.eventTypeId)}</span>
                            </Button>
                          {/each}
                        </div>
                      {/if}
                      {#each hoverRows as f (f)}
                        {#if f === 'title'}
                          <p class="t-title hc-title">
                            {eventTitle(sel.eventTypeId)}
                            {#if sel.checkup}<Badge size="sm">{m.cal_checkup_badge()}</Badge>{/if}
                          </p>
                        {:else if f === 'staff'}
                          <dl class="hc-row">
                            <dt class="t-caption">{m.cal_staff()}</dt>
                            <dd class="t-body">{resourceName(sel.resourceId)}</dd>
                          </dl>
                        {:else if f === 'client'}
                          <!-- ONE block, per the owner's nesting ask: the name on
                               the first line and each enabled sub-item as a
                               caption under it. Hiding `client` takes the phone
                               with it — a sub-item has no slot of its own. -->
                          <dl class="hc-row">
                            <dt class="t-caption">{m.cal_client()}</dt>
                            <dd class="t-body">
                              {sel.attendeeName ?? '—'}
                              {#if !hoverHidden.has('phone') && sel.attendeePhone}
                                <span class="t-caption hc-sub">{sel.attendeePhone}</span>
                              {/if}
                            </dd>
                          </dl>
                        {:else if f === 'notes' && sel.notes}
                          <dl class="hc-row">
                            <dt class="t-caption">{m.sched_detail_notes()}</dt>
                            <dd class="t-body hc-notes">{sel.notes}</dd>
                          </dl>
                        {:else if f === 'tags' && sel.tags?.length}
                          <div class="hc-tags">
                            {#each sel.tags as t (t.origin + t.id)}
                              <TagChip
                                size="sm"
                                name={t.name}
                                color={t.color}
                                origin={t.origin === 'own' ? undefined : t.origin}
                                dashed={t.origin !== 'own'}
                              />
                            {/each}
                          </div>
                        {:else if f === 'chips' && chips}
                          <div class="hc-chips">{@render chips(sel)}</div>
                        {:else if f === 'actions'}
                          <div class="hc-actions">
                            <Button size="sm" onclick={() => onopen(sel.id)}>{m.cal_open()}</Button>
                            {#if actions}{@render actions(sel)}{/if}
                            {#if visit && onmove}
                              <!-- Out of the visit, keeping its time. The drag-out
                                   path is deliberately NOT here: this card is an
                                   interactive Zag tooltip, so a pointer drag that
                                   leaves its content fires the close intent.
                                   TODO(handoff): ship drag-a-member-out onto the
                                   grid (detach + reschedule in one gesture) once
                                   the card is a real Popover rather than a
                                   tooltip. Ledger: append to the meta-repo
                                   proposal
                                   `proposals/2026-09-25-hub-pos-calendar-color-followups.md`. -->
                              <Button size="sm" variant="ghost" onclick={() => separate(sel)}>
                                <Ungroup size={iconSizes.sm} />
                                {m.cal_separate()}
                              </Button>
                            {/if}
                          </div>
                        {/if}
                      {/each}
                    </div>
                  {/snippet}
                  {#snippet children(trigger)}
                    <Button
                      {...trigger ?? {}}
                      variant="ghost"
                      class="evt {b.status} {blockColorBy === 'status'
                        ? tone
                          ? `tone-${tone}`
                          : 'tone-neutral'
                        : block
                          ? 'has-color'
                          : 'tone-neutral'} {b.checkup ? 'is-checkup' : ''} {visit
                        ? 'is-visit'
                        : ''} {drag?.active && drag.boxKey === box.key
                        ? 'is-dragging'
                        : ''} {mergeTarget?.colKey === col.key && mergeTarget.onto.key === box.key
                        ? 'is-merge-target'
                        : ''}"
                      style="top:{box.top}px;height:{box.height}px;left:calc(var(--sx) + var(--sw) * {box.lane /
                        box.lanes} + var(--space-0-5));width:calc(var(--sw) / {box.lanes} - var(--space-2));border-left-color:{sliver ??
                        'var(--color-accent)'};--evt-c:{block ?? 'transparent'}"
                      onclick={() => openBox(b.id)}
                    >
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <!-- Pointer-only enhancement: the enclosing Button is the
                           keyboard path (open → edit the time in the drawer). -->
                      <span
                        class="evt-in"
                        class:draggable={!!onmove}
                        onpointerdown={(e) => beginDrag(e, box, col, 'move')}
                      >
                        <!-- Per-viewer block layout: the FIRST visible line gets
                             `.evt-lead` (the bold/primary row the time used to
                             own unconditionally), so hiding the time promotes
                             whatever the viewer put on top instead of leaving an
                             empty leading row. A merged visit reads as the client
                             plus one `service` line listing its procedures. -->
                        {#each blockRows as f, i (f)}
                          {#if f === 'time'}
                            <span class="evt-t" class:evt-lead={i === 0}>{hhmm(box.start)}</span>
                          {:else if f === 'service'}
                            <span class="evt-s truncate" class:evt-lead={i === 0}>
                              {box.members.map((mb) => eventTitle(mb.eventTypeId)).join(', ')}
                            </span>
                          {:else if f === 'client'}
                            <span class="evt-a truncate" class:evt-lead={i === 0}>
                              {b.attendeeName ?? ''}
                            </span>
                          {/if}
                        {/each}
                        {#if !blockHidden.has('tags')}
                          {@const tags = boxTags(box)}
                          {#if tags.length}
                            <span class="evt-tags">
                              {#each tags.slice(0, 6) as t (t.origin + t.id)}
                                <TagDot name={t.name} color={t.color} origin={t.origin} />
                              {/each}
                            </span>
                          {/if}
                        {/if}
                        {#if onmove}
                          <span
                            class="evt-resize"
                            aria-hidden="true"
                            onpointerdown={(e) => beginDrag(e, box, col, 'resize')}
                          ></span>
                        {/if}
                      </span>
                    </Button>
                  {/snippet}
                </Tooltip>
              {/each}

              {#each col.invoices ?? [] as inv (inv.key)}
                <Tooltip
                  asChild
                  interactive
                  bare
                  placement="right"
                  openDelay={180}
                  closeDelay={320}
                  id="inv-{inv.key}"
                >
                  {#snippet content()}
                    <div class="hover-card">
                      <div class="hc-head">
                        <span class="t-label hc-time">{hhmm(inv.at)}</span>
                        <Badge variant="semantic" value="success" size="sm"
                          >{formatMoney(inv.total, inv.currency)}</Badge
                        >
                      </div>
                      {#each inv.items as t (t.id)}
                        <div class="hc-ticket">
                          <p class="t-title hc-title">
                            {m.cal_invoice_ticket({ id: t.humanId ?? t.id.slice(0, 8) })}
                            <span class="t-caption"
                              >· {t.customerName ?? '—'} · {formatMoney(t.total, t.currency)}</span
                            >
                          </p>
                          <ul class="hc-lines">
                            {#each t.lines as l (l.id)}
                              <li>
                                <span class="t-body">{l.description}</span>
                                {#if l.bookingId}
                                  {@const bid = l.bookingId}
                                  <Button size="xs" variant="ghost" onclick={() => onopen(bid)}
                                    >{m.cal_open_appointment()}</Button
                                  >
                                {:else}
                                  <span class="t-caption">{m.cal_no_linked_appointment()}</span>
                                {/if}
                              </li>
                            {/each}
                          </ul>
                        </div>
                      {/each}
                    </div>
                  {/snippet}
                  {#snippet children(trigger)}
                    <div
                      {...trigger ?? {}}
                      class="inv"
                      style="top:{inv.top}px;height:{inv.height}px;left:calc(var(--sw) * {inv.lane /
                        inv.lanes} + var(--space-0-5));width:calc(var(--sw) / {inv.lanes} - var(--space-2))"
                    >
                      <span class="evt-t"><Receipt size={iconSizes.xs} /> {hhmm(inv.at)}</span>
                      <span class="evt-s truncate">
                        {formatMoney(inv.total, inv.currency)}{inv.items.length > 1
                          ? ` · ×${inv.items.length}`
                          : ''}
                      </span>
                      <span class="evt-a truncate">{inv.items[0].customerName ?? ''}</span>
                    </div>
                  {/snippet}
                </Tooltip>
              {/each}

              <!-- Current time. DOM order alone does the layering — after the
                   event/ticket boxes so it paints over them, before the drop
                   hint and drag ghost so an in-flight drag stays readable; no
                   z-index, local or global, is involved.
                   Day view draws ONE continuous rule across all columns instead
                   (owner ask 2026-09-25) — see `.now-line-all` after the loop. -->
              {#if view !== 'day' && col.isToday && nowTop !== null}
                <div class="now-line" style="top:{nowTop}px" aria-hidden="true"></div>
              {/if}

              {#if dropHint && dropHint.colKey === col.key}
                <div class="drop-hint" style="top:{dropHint.top}px">
                  <span class="evt-t">{dropHint.label}</span>
                </div>
              {/if}

              <!-- The ghost says what the DROP will do, not only where it lands:
                   over a compatible visit it stops quoting a time range (the
                   merge re-times the booking to the visit's window anyway) and
                   names the action instead. -->
              {#if ghost && ghost.colKey === col.key}
                <div
                  class="evt-ghost"
                  class:is-merge={!!mergeTarget}
                  style="top:{ghost.top}px;height:{ghost.height}px"
                >
                  <span class="evt-t"
                    >{mergeTarget
                      ? m.cal_merge_hint()
                      : `${minLabel(ghost.startMin)} – ${minLabel(ghost.endMin)}`}</span
                  >
                </div>
              {/if}
            </div>
          </div>
        {/each}
        <!-- Day view: the columns are all the SAME day, so one rule across the
             whole grid reads as the time of day (owner ask 2026-09-25) where a
             per-column rule read as N separate marks. Positioned on `.cols` and
             offset by the sticky header band, so it lines up with the tracks;
             it stays BELOW `.col-head` (which owns a local tier) and above the
             boxes, which carry no stacking of their own. -->
        {#if view === 'day' && date === today && nowTop !== null}
          <div
            class="now-line now-line-all"
            style="top:calc(var(--cal-head-h) + {nowTop}px)"
            aria-hidden="true"
          ></div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<!-- The reschedule was REFUSED for a real reason (the chair is taken, buffers
     included). One dialog naming the clash beats a toast with a raw ISO range:
     it offers the three answers an operator actually has. -->
{#if conflictAsk}
  {@const mergeWith = conflictMergeWith}
  <Dialog open size="sm" title={m.cal_conflict_title()} onclose={() => (conflictAsk = null)}>
    <p class="t-body">{m.cal_conflict_intro()}</p>
    <ul class="cf-list">
      {#each conflictLines as line, i (i)}
        <li class="t-body">{line}</li>
      {/each}
    </ul>
    {#snippet footer()}
      <Button variant="ghost" onclick={() => (conflictAsk = null)}
        >{m.cal_conflict_pick_other()}</Button
      >
      {#if mergeWith}
        <Button variant="secondary" onclick={() => commitConflict({ mergeWith: mergeWith.id })}>
          {m.cal_merge_confirm()}
        </Button>
      {/if}
      <Button variant="primary" onclick={() => commitConflict({ overrideConflicts: true })}>
        {m.cal_conflict_move_anyway()}
      </Button>
    {/snippet}
  </Dialog>
{/if}

{#if mergeAsk}
  {@const ask = mergeAsk}
  <ConfirmDialog
    open
    title={m.cal_merge_title()}
    message={m.cal_merge_message_visit({
      service: ask.service,
      client: ask.client,
      minutes: ask.minutes,
      length: ask.minutes,
    })}
    confirmLabel={m.cal_merge_confirm()}
    failureMessage={m.cal_merge_failed()}
    onconfirm={commitMerge}
    onconfirmed={() => (mergeAsk = null)}
    onclose={() => (mergeAsk = null)}
  />
{/if}

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
    position: relative;
    min-width: 12rem;
    text-align: center;
    font-weight: 600;
    font-size: var(--font-size-page-title);
    font-variant-numeric: tabular-nums;
  }
  /* Week-fetch indicator: absolutely positioned inside the label's own
     min-width so it can never move the toolbar (`aria-busy` on the label
     carries the same news to assistive tech). Forwarded class ⇒ `:global`. */
  .cal-date :global(.cal-busy) {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    margin: auto;
    color: var(--color-text-tertiary);
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
    /* NO top padding. A sticky child's offsets resolve against this scroller's
       CONTENT box, so any padding-top leaves a strip between the toolbar and the
       stuck header band that the scrolling grid shows through — the "gap that
       shows content behind it" (owner report 2026-09-25: the 07:00 label and the
       top of the grid bleeding above the column heads). The header band is
       flush with the scroller's top edge instead, and the toolbar above already
       carries its own padding. */
    padding: 0 var(--space-card) var(--space-card);
    /* One height for the whole sticky band — the corner cell, the column heads,
       and the offset the day-view now-line adds to clear them. Three copies of
       `40px` was how they drifted apart. */
    --cal-head-h: 40px;
    /* The grid's three sticky tiers (column head < gutter < corner) only have to
       beat EACH OTHER. Expressed in global layer tokens they also beat the app's
       navigation, so the gutter (dropdown) and corner (popover) painted over the
       sidebar and its tooltips (owner report 2026-09-22). `isolate` gives the
       grid its own stacking context, and the tiers below are named LOCAL steps
       inside it — they order the grid and can never escape this box. */
    isolation: isolate;
    --cal-tier-col-head: 1;
    --cal-tier-axis: 2;
    --cal-tier-corner: 3;
    /* The sticky time gutter's width. ONE declaration: the JS `GUTTER_W` above
       subtracts it to size the runway columns, and `scroll-padding-left` insets
       the snapport by it so a snapped column starts exactly at the gutter's
       right edge (which makes `scrollLeft === columnIndex * colW`). */
    --cal-gutter: 52px;
  }
  /* Week views: the grid scrolls edge to edge. The horizontal padding goes
     BEFORE the first measurement (not with `.is-runway` below) — it is part of
     the content box `colW` is measured from, and a padded box would offset
     every snap position by it. `scroll-padding-left` insets the snapport by the
     sticky gutter, which is what makes `scrollLeft === columnIndex * colW`. */
  .cal-scroll.is-week {
    padding-inline: 0;
    scroll-padding-left: var(--cal-gutter);
  }
  /* Runway mode = week view WITH a measured column width: the x axis snaps per
     day and the columns leave the flex flow onto the runway. */
  .cal-scroll.is-runway {
    scroll-snap-type: x mandatory;
  }
  .cal-scroll.is-runway .cols {
    /* Width comes from the inline runway width, so no flex growth/shrink. */
    flex: none;
  }
  /* Month view: the runway is VERTICAL, so the snap axis and the scroll padding
     swap over. `scroll-padding-top` insets the snapport by the sticky weekday
     header, which is what makes `scrollTop === rowIndex * rowH` — the y twin of
     the gutter inset above. */
  .cal-scroll.is-month {
    padding-inline: 0;
    scroll-padding-top: var(--cal-head-h);
    /* Row height. ONE declaration: the JS measures it off the first rendered row
       rather than duplicating the number, so a media query may change it. */
    --cal-month-row: 7.5rem;
  }
  .cal-scroll.is-month-runway {
    scroll-snap-type: y mandatory;
  }
  .cal-scroll.is-runway .col {
    position: absolute;
    top: 0;
    /* The runway decides the width; `min-width` would fight it on a narrow
       viewport and desynchronise the columns from `scrollLeft`. */
    min-width: 0;
    scroll-snap-align: start;
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
     One tier above `.col-head` settles that — local to `.cal-scroll`'s
     isolated stacking context, never a global layer. */
  .axis {
    position: sticky;
    left: 0;
    z-index: var(--cal-tier-axis, 2);
    flex-shrink: 0;
    width: var(--cal-gutter, 52px);
    /* Opaque, no backdrop-filter: a translucent/blurred sticky surface let the
       hour labels bleed through the corner and header row (governance:
       sticky = explicit opaque surface). */
    background: var(--color-canvas);
  }
  /* The corner cell also sticks to the TOP — pinned on both axes where the
     gutter and the header row cross. One tier above the gutter itself so it
     wins there too. */
  .axis-head {
    position: sticky;
    top: 0;
    z-index: var(--cal-tier-corner, 3);
    height: var(--cal-head-h, 40px);
    background: var(--color-canvas);
  }
  /* Each label sits just BELOW its own hour line (owner ask 2026-09-25: the
     label's text used to be centred ON the line, so the first one — 07:00 —
     was half above the track and clipped by the header band). Top of text =
     line + a hair, for every hour including the last, which has a full row of
     its own (`TRACK_H` renders END_HOUR's row). */
  .hour-label {
    font-size: var(--font-size-caption);
    color: var(--color-text-tertiary);
    text-align: right;
    padding: var(--space-0-5) var(--space-2) 0 0;
    font-variant-numeric: tabular-nums;
  }
  .cols {
    display: flex;
    flex: 1;
    gap: 1px;
    /* Anchor for the day view's single continuous now-line. */
    position: relative;
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
    z-index: var(--cal-tier-col-head, 1);
    height: var(--cal-head-h, 40px);
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    font-size: var(--font-size-body);
    font-weight: 500;
    padding: 0 var(--space-2);
    border-bottom: 1px solid var(--color-border);
    color: var(--color-text-primary);
    text-transform: capitalize;
    background: var(--color-canvas);
  }
  .col.is-today .col-head {
    color: var(--color-accent);
    border-bottom-color: var(--color-accent);
  }
  .head-sub {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
  }
  /* Split view: the two sub-column captions sit on the head's bottom edge. */
  .head-split {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    padding: 0 var(--space-1);
    font-size: var(--font-size-telemetry);
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-text-tertiary);
  }
  .head-split span:last-child {
    text-align: right;
  }
  .split-line {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    border-left: 1px dashed var(--color-border-strong);
    pointer-events: none;
  }
  /* Invoice (ticket) box — the money moment, kept visually distinct from
     bookings: success-tinted, receipt glyph, no status ramp. */
  .inv {
    position: absolute;
    display: block;
    min-width: 0;
    padding: var(--space-0-5) var(--space-2);
    overflow: hidden;
    background: var(--color-success-surface);
    border: 1px solid var(--color-success-border);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-elevation-1);
    cursor: default;
  }
  .inv .evt-t {
    display: inline-flex;
    align-items: center;
    gap: var(--space-0-5);
  }
  .hc-ticket + .hc-ticket {
    padding-top: var(--space-2);
    border-top: 1px solid var(--color-border);
  }
  .hc-lines {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .hc-lines li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  /* A checkup follows a paid treatment: dashed edge, no invoice of its own. */
  .track :global(.evt.is-checkup) {
    border-style: dashed;
    border-left-style: solid;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
    align-self: center;
  }
  /* Available hours sit on surface-2; off-hours drop toward the canvas so they
     read darker than the open grid on both light and dark themes. */
  .track {
    position: relative;
    border-left: 1px solid var(--color-border);
    background: var(--color-surface-2);
  }
  /* Off-hours: the darker tint plus a faint diagonal hatch, so "out of bounds"
     reads as a texture and not only as a shade (owner ask 2026-09-20). The
     stripe is a tertiary-text mix at a few percent — visible on every theme,
     never louder than the grid lines. */
  .offhours {
    position: absolute;
    left: 0;
    right: 0;
    --hatch: color-mix(in srgb, var(--color-text-tertiary) 7%, transparent);
    background-color: color-mix(in srgb, var(--color-surface-1) 60%, var(--color-canvas));
    background-image: repeating-linear-gradient(
      -45deg,
      var(--hatch) 0,
      var(--hatch) 1px,
      transparent 1px,
      transparent 8px
    );
    pointer-events: none;
  }
  .gridline {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px solid var(--color-border);
    opacity: 0.45;
  }

  /* Empty-grid affordance: a full-area shared Button (never a bare native one).
     On a week/day track the click y becomes a snapped start time; in a month cell
     there is no y axis, so it opens the form at `MONTH_NEW_TIME`. Anchored on
     `.cal-scroll` rather than `.track` so BOTH surfaces get the one contract.
     Transparent until hovered. */
  .cal-scroll :global(.slot-layer) {
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
  .cal-scroll :global(.slot-layer > span) {
    align-items: flex-start;
    height: auto;
  }
  .cal-scroll :global(.slot-layer:active) {
    transform: none;
  }
  .cal-scroll :global(.slot-layer:hover),
  .cal-scroll :global(.slot-layer:focus-visible) {
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
  /* The inner span fills the box so a long event keeps its text at the TOP
     (Button would centre it) and the whole box is the drag target. */
  .track :global(.evt > span) {
    display: block;
    width: 100%;
    height: 100%;
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
  /* Any other colour source paints an arbitrary persisted colour (kind, staff,
     service, tag, category). It arrives as `--evt-c` and is TINTED into the
     surface token, never used raw: the box keeps surface-level contrast so the
     text tokens above it stay readable on every theme. */
  .track :global(.evt.has-color) {
    background: color-mix(
      in srgb,
      var(--evt-c, var(--color-surface-2)) 18%,
      var(--color-surface-2)
    );
  }
  .track :global(.evt.has-color:hover) {
    background: color-mix(
      in srgb,
      var(--evt-c, var(--color-surface-2)) 30%,
      var(--color-surface-2)
    );
  }
  .track :global(.evt.cancelled),
  .track :global(.evt.no_show) {
    opacity: 0.5;
    text-decoration: line-through;
  }
  .evt-in {
    display: block;
    position: relative;
    min-width: 0;
    height: 100%;
  }
  .evt-in.draggable {
    cursor: grab;
    touch-action: none;
  }
  /* Tag marks sit in the block's top-right corner, not under the text: a
     30-minute block has no room below its title, so an in-flow row was clipped
     and the tags only ever showed in the hover card (owner report 2026-09-20).
     Each mark carries a 1px ring so its colour reads against both the tinted
     block and the canvas. */
  .evt-tags {
    position: absolute;
    top: var(--space-0-5);
    right: var(--space-0-5);
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-0-5);
    max-width: 50%;
  }
  .evt-tags :global(.tag-dot) {
    width: 7px;
    height: 7px;
    outline: 1px solid var(--color-border-strong);
  }
  .hc-tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .cal-tools {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-left: auto;
  }
  /* Calendar-options kebab — same toolbar chip shape as TagFilter's, squared off
     because the label is screen-reader only. */
  .cc-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    height: var(--control-height-sm);
    width: var(--control-height-sm);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
  }
  .cc-trigger:hover {
    color: var(--color-text-primary);
  }
  .cc-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-2);
    width: 16rem;
    /* Both field lists live here now (card + block), so the panel can outgrow a
       laptop viewport: it owns its own scroll rather than clipping. */
    max-height: min(70vh, 34rem);
    overflow-y: auto;
  }
  .wd-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .wd-label {
    color: var(--color-text-secondary);
  }
  .wd-stepper {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .wd-value {
    min-width: 1.5em;
    text-align: center;
    font-variant-numeric: tabular-nums;
    color: var(--color-text-primary);
  }
  .evt-resize {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 6px;
    cursor: ns-resize;
    touch-action: none;
  }
  .track :global(.evt.is-dragging) {
    opacity: 0.35;
  }
  /* Drag-over merge feedback (owner ask 2026-09-25). The outline is the signal —
     it is the one property nothing else on a box uses, so it reads on top of
     every colour source — and the tint is repeated for `:hover` because the
     pointer IS over this box while dragging onto it, and `.evt:hover` /
     `.has-color:hover` would otherwise win the background back. Both rules sit
     after the tone/colour blocks above so equal specificity resolves here. */
  .track :global(.evt.is-merge-target),
  .track :global(.evt.is-merge-target:hover) {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
    background: color-mix(in srgb, var(--color-accent) 16%, var(--color-surface-2));
  }
  .drop-hint {
    position: absolute;
    left: var(--space-0-5);
    right: var(--space-0-5);
    height: 2px;
    background: var(--color-accent);
    pointer-events: none;
  }
  .drop-hint .evt-t {
    position: absolute;
    top: var(--space-0-5);
    left: var(--space-1);
    padding: 0 var(--space-1);
    border-radius: var(--radius-xs);
    background: var(--color-accent);
    color: var(--color-on-accent);
  }
  .evt-ghost {
    position: absolute;
    left: var(--space-0-5);
    right: var(--space-0-5);
    padding: var(--space-0-5) var(--space-2);
    border: 1px dashed var(--color-accent);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--color-accent) 14%, transparent);
    pointer-events: none;
  }
  /* Over a merge target the ghost is no longer "a slot you may land in" but a
     committed action, so it firms up: solid border, stronger fill, and its one
     line is the action label. */
  .evt-ghost.is-merge {
    border-style: solid;
    background: color-mix(in srgb, var(--color-accent) 24%, transparent);
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
  /* The block's lead line is positional, not per-field: whichever configured
     field lands first reads as the bold/primary row, and a time pushed below it
     drops to the secondary weight the service/client lines have. `.evt-t` keeps
     its own bold outside `.evt-in` — the ticket box, drop hint and drag ghost
     reuse the class as their single line. */
  .evt-in .evt-t:not(.evt-lead),
  .evt-in .evt-s,
  .evt-in .evt-a {
    font-weight: 400;
    color: var(--color-text-secondary);
  }
  .evt-in .evt-lead {
    font-weight: 600;
    color: var(--color-text-primary);
  }

  /* Current time on today's track: a 2px rule with a dot at the left edge, the
     same `--color-danger-fg` the event-calendar skin uses for its own now
     indicator, so both calendars read identically. */
  .now-line {
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--color-danger-fg);
    pointer-events: none;
  }
  .now-line::before {
    content: '';
    position: absolute;
    left: 0;
    top: -3px;
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    background: var(--color-danger-fg);
  }
  /* Day view: ONE rule over the whole columns row instead of one per column.
     It lives on `.cols`, so its single dot lands on the gutter's edge and the
     rule crosses every column with no seams at the 1px column gaps. */
  .now-line-all {
    left: 0;
    right: 0;
  }

  /* A merged visit (one client, one chair, several procedures): the block is one
     piece, so it gets a slightly stronger edge than a lone booking rather than
     any new colour of its own — the colour sources still own the fill. */
  .track :global(.evt.is-visit) {
    border-color: var(--color-border-strong);
  }
  /* Procedure picker inside a merged visit's hover card. A list selection, not a
     primary action: the selected row is an accent-TINTED surface with accent
     text (never a full accent fill). Forwarded class ⇒ `:global` anchored on a
     scoped ancestor, and Button's inner row `<span>` needs its own rule to stop
     centring a two-line label. */
  .hc-members {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }
  .hc-members :global(.hc-member) {
    justify-content: flex-start;
    height: auto;
    min-height: var(--control-height-sm);
    padding: var(--space-0-5) var(--space-2);
    border: 1px solid var(--color-border);
    color: var(--color-text-primary);
    white-space: normal;
    text-align: left;
  }
  .hc-members :global(.hc-member > span) {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
    height: auto;
    gap: 0;
  }
  .hc-members :global(.hc-member.is-sel) {
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    border-color: var(--color-accent);
    color: var(--color-accent);
  }
  .hc-m-time {
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
  }
  /* Both halves in ONE `:global()` at the END of the sequence: a `:global()` may
     not sit in the middle of a selector, and the scoped `.hc-members` ancestor
     still anchors it. */
  .hc-members :global(.hc-member.is-sel .hc-m-time) {
    color: inherit;
  }

  /* Conflict dialog: one line per clash, already formatted by `conflictLine`. */
  .cf-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: var(--space-2) 0 0;
    padding-left: var(--space-4);
    color: var(--color-text-primary);
  }

  /* Hover card — an INTERACTIVE Zag tooltip panel (open/close intent + Escape
     come from the machine; `bare` drops the label styling so this owns it). */
  .hover-card {
    /* A 2-track grid, not a flex column: label rows are `subgrid` so they share
       ONE label column however the viewer reorders them (per-row `max-content`
       tracks stagger the values — the bar-row contract). */
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--space-2);
    min-width: 15rem;
    max-width: 20rem;
    padding: var(--space-3);
    background: var(--color-overlay);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-overlay);
  }
  /* Every block spans both tracks (this also keeps the invoice card's own
     children — `.hc-ticket` — laid out as before). */
  .hover-card > * {
    grid-column: 1 / -1;
  }
  .hc-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .hc-head-end {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .hc-time {
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
  }
  .hc-title {
    margin: 0;
    color: var(--color-text-primary);
  }
  /* One label row. Placed AFTER `.hover-card > *` so its subgrid tracks win. */
  .hc-row {
    display: grid;
    grid-template-columns: subgrid;
    grid-column: 1 / -1;
    column-gap: var(--space-3);
    margin: 0;
  }
  .hc-row dt {
    color: var(--color-text-tertiary);
  }
  .hc-row dd {
    margin: 0;
    color: var(--color-text-primary);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  /* A nested sub-item: its own caption line under the block's first line. */
  .hc-sub {
    display: block;
    color: var(--color-text-secondary);
  }
  /* Notes are free text: keep the operator's line breaks, clamp the height so a
     long note can never push the actions out of the card. */
  .hc-notes {
    color: var(--color-text-secondary);
    white-space: pre-wrap;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    overflow: hidden;
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

  /* ── Month grid ─────────────────────────────────────────────────────────
     `.m-weekdays` is the only sticky part; `.m-rows` is the runway and the rows
     leave the flow onto it once measured. */
  .m-weekdays {
    position: sticky;
    top: 0;
    /* Local tier inside `.cal-scroll`'s isolated stacking context, exactly like
       `.col-head` — never a global layer token. */
    z-index: var(--cal-tier-col-head, 1);
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    align-items: center;
    height: var(--cal-head-h, 40px);
    border-bottom: 1px solid var(--color-border);
    /* Opaque: a sticky surface the grid scrolls under (governance). */
    background: var(--color-canvas);
  }
  .m-weekdays span {
    padding: 0 var(--space-2);
    font-size: var(--font-size-caption);
    font-weight: 500;
    color: var(--color-text-secondary);
    text-transform: capitalize;
  }
  .m-rows {
    position: relative;
  }
  .m-row {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    height: var(--cal-month-row, 7.5rem);
  }
  .month.is-runway .m-row {
    position: absolute;
    left: 0;
    right: 0;
    scroll-snap-align: start;
  }
  .m-cell {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
    border-right: 1px solid var(--color-border);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface-2);
  }
  .m-cell:last-child {
    border-right: none;
  }
  /* Days of the adjacent months stay legible but recede: the label names ONE
     month, so the cells it does not own must not read as part of it. */
  .m-cell.is-outside {
    background: color-mix(in srgb, var(--color-surface-1) 60%, var(--color-canvas));
  }
  .m-cell.is-outside .m-body {
    opacity: 0.6;
  }
  .m-body {
    /* Positioned so it paints — and receives clicks — ABOVE the absolutely
       positioned `.slot-layer` behind it: between two positioned siblings with
       `z-index: auto` tree order decides, and an in-flow body would lose to it.
       The body's OWN dead space (right of the day number, between chips) must
       still reach that layer, so the box is transparent to the pointer and only
       its controls take events — otherwise the top strip of every cell silently
       stops creating appointments. */
    pointer-events: none;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    padding: var(--space-0-5);
    overflow: hidden;
  }
  .m-body > :global(*) {
    pointer-events: auto;
  }
  /* Forwarded classes on shared Buttons ⇒ `:global` anchored on the scoped
     `.m-body`, and Button's inner row `<span>` needs its own rule. */
  .m-body :global(.m-num) {
    align-self: flex-start;
    height: auto;
    min-height: 0;
    padding: 0 var(--space-1);
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
  }
  /* Today: the same accent-tinted pill + accent text the date picker marks its
     own today/selected day with — never a full accent fill. */
  .m-cell.is-today :global(.m-num) {
    background: color-mix(in srgb, var(--color-accent) 16%, transparent);
    border-radius: var(--radius-full);
    color: var(--color-accent);
    font-weight: 700;
  }
  /* Chip = an event block flattened to one line. */
  .m-body :global(.m-chip) {
    display: block;
    width: 100%;
    height: auto;
    min-height: 0;
    padding: 0 var(--space-1);
    border: 1px solid var(--color-border);
    border-left: 3px solid var(--color-accent);
    border-radius: var(--radius-xs);
    background: var(--color-surface-2);
    text-align: left;
  }
  .m-body :global(.m-chip > span) {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
    width: 100%;
    height: auto;
  }
  .m-body :global(.m-chip:hover) {
    background: var(--color-surface-3);
  }
  /* The block's status ramp and arbitrary-colour tint, repeated for the chip:
     one level = one hue on every surface. Placed after the plain/hover rules so
     equal specificity resolves here, exactly as on `.evt`. */
  .m-body :global(.m-chip.tone-info) {
    background: var(--color-info-surface);
  }
  .m-body :global(.m-chip.tone-warning) {
    background: var(--color-warning-surface);
  }
  .m-body :global(.m-chip.tone-success) {
    background: var(--color-success-surface);
  }
  .m-body :global(.m-chip.tone-error) {
    background: var(--color-danger-surface);
  }
  .m-body :global(.m-chip.has-color),
  .m-body :global(.m-chip.has-color:hover) {
    background: color-mix(
      in srgb,
      var(--evt-c, var(--color-surface-2)) 18%,
      var(--color-surface-2)
    );
  }
  .m-body :global(.m-chip.cancelled),
  .m-body :global(.m-chip.no_show) {
    opacity: 0.5;
    text-decoration: line-through;
  }
  .m-chip-t {
    flex-shrink: 0;
    font-size: var(--font-size-caption);
    font-weight: 600;
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
  }
  .m-chip-n {
    min-width: 0;
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
  }
  .m-body :global(.m-more) {
    align-self: flex-start;
    height: auto;
    min-height: 0;
    padding: 0 var(--space-1);
    color: var(--color-accent);
    font-size: var(--font-size-caption);
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
