<script lang="ts" module>
  /** Grid window. Kept module-level so both routes render an identical grid. */
  const START_HOUR = 7;
  const END_HOUR = 21;
  const PX_PER_HOUR = 56;
  /** Empty-slot clicks snap to quarter hours. */
  const SNAP_MIN = 15;
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
   * TODO(handoff): so do the configurable event-BLOCK lines and the now-line
   * (2026-09-25, `./hover-fields.ts` `BLOCK_FIELDS` + `./now-line.ts`).
   * `/scheduling/calendar` gets a now indicator free from the ec skin
   * (`--ec-now-indicator-color`) but has no block-layout prefs; the prefs and the
   * helper are renderer-agnostic, only its own kebab is missing. Same proposal.
   */
  import type { Snippet } from 'svelte';
  import { ChevronLeft, ChevronRight, MoreVertical, Plus, Receipt, Settings2 } from 'lucide-svelte';
  import {
    Badge,
    Button,
    EmptyState,
    Popover,
    SegmentedControl,
    Toggle,
    Tooltip,
    iconSizes,
  } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { formatDate, formatMoney, formatTime, weekdayLabels } from '$lib/utils/format';
  import {
    calendarDays,
    monthGridDays,
    shiftCalendarDate,
    shiftCalendarMonth,
    todayIn,
    type CalendarBooking,
    type CalendarInvoice,
    type CalendarResource,
    type CalendarView,
  } from './calendar-window';
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
    mergeFields,
    moveField,
    visibleFields,
    type BlockField,
    type HoverField,
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
    /**
     * Working hours for off-hours shading: resourceId → weekday (0 = Sunday)
     * → `[open, close]` in minutes from midnight; a missing weekday = closed,
     * a resource missing from the map = no schedule (never shaded).
     * Resource columns shade their own hours; day/aggregate columns shade
     * outside the envelope (earliest open → latest close) of every scheduled
     * resource. Omit to leave the grid unshaded.
     */
    hours?: Record<string, Partial<Record<number, [number, number]>>>;
    /** Drag (move across time / day / resource) or resize (end) commit. Omit
     *  to keep boxes static. */
    onmove?: (
      id: string,
      next: { start: string; end: string; resourceId: string },
    ) => void | Promise<void>;
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
  const splitOn = $derived(split && invoices !== undefined);
  const invoicesOn = (day: string, resourceId: string | null) =>
    splitOn && resourceId === null
      ? packInvoices((invoices ?? []).filter((i) => dayOf(i.at) === day))
      : null;

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
        invoices: invoicesOn(date, null),
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
          invoices: null,
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
        invoices: invoicesOn(d, null),
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

  // ── Configurable hover-card rows (per viewer) ─────────────────────────────
  // Same UX as a DataTable column menu: a checkbox per field plus a drag handle
  // to reorder. The list renders INLINE inside the card rather than in a
  // `Popover`, because the card is an `interactive` Zag tooltip and the Popover
  // content is PORTALLED to <body> — the pointer moving into it would leave the
  // tooltip's content and close the whole card after `closeDelay`. Inline also
  // needs no dismissal path of its own: the tooltip's own close intent and
  // Escape unmount it.
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
  let hoverHidden = $state<Set<HoverField>>(new Set());
  let hoverOrder = $state<HoverField[]>([...HOVER_FIELDS]);
  let fieldsOpen = $state(false);
  $effect(() => {
    try {
      const raw = localStorage.getItem(HOVER_FIELDS_KEY);
      const merged = mergeFields(raw ? JSON.parse(raw) : null, HOVER_FIELDS);
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
    hoverHidden = toggled(hoverHidden, key as HoverField);
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

  const fieldLabel = (f: HoverField): string =>
    (
      ({
        status: m.sched_cal_status,
        title: m.sched_cal_service,
        staff: m.cal_staff,
        client: m.cal_client,
        phone: m.sched_book_phone,
        tags: m.tags_label,
        chips: m.cal_field_chips,
        actions: m.crm_actions,
      }) as Record<HoverField, () => string>
    )[f]();
  const hoverFieldItems = $derived(HOVER_FIELDS.map((f) => ({ key: f, label: fieldLabel(f) })));
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
    id: string;
    mode: DragMode;
    x0: number;
    y0: number;
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

  function beginDrag(e: PointerEvent, b: Placed, col: Column, mode: DragMode) {
    if (!onmove || e.button !== 0) return;
    e.stopPropagation();
    colRects = columns.map((c, i) => {
      const r = (colsEl?.children[i] as HTMLElement | undefined)?.getBoundingClientRect();
      return { key: c.key, left: r?.left ?? 0, right: r?.right ?? 0 };
    });
    drag = {
      id: b.id,
      mode,
      x0: e.clientX,
      y0: e.clientY,
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
      id: drag.id,
      colKey: drag.colKey,
      startMin: s,
      endMin: en,
      top: ((s - DAY_START) / 60) * PX_PER_HOUR,
      height: Math.max(18, ((en - s) / 60) * PX_PER_HOUR),
    };
  });
  async function onDragEnd() {
    const d = drag;
    const g = ghost;
    drag = null;
    if (!d || !g) return;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    const target = columns.find((c) => c.key === g.colKey);
    const b = bookings.find((x) => x.id === d.id);
    if (!target || !b) return;
    // Same local-wall-time policy as `dayOf`/`minutesOf` above (browser tz).
    const at = (min: number) => new Date(`${target.day}T${minLabel(min)}:00`).toISOString();
    const next = {
      start: at(g.startMin),
      end: at(g.endMin),
      resourceId: target.resourceId ?? b.resourceId,
    };
    if (next.start === b.start && next.end === b.end && next.resourceId === b.resourceId) return;
    await onmove?.(d.id, next);
  }
  function openBox(id: string) {
    if (suppressClick) return;
    onopen(id);
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
      {#if invoices !== undefined}
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
      <FieldsList
        heading={m.cal_block_fields()}
        fields={blockFieldItems}
        hidden={blockHidden}
        order={blockOrder}
        ontoggle={toggleBlockField}
        onmove={moveBlockField}
        lockedKeys={BLOCK_LOCKED}
      />
    </div>
  </Popover>
  {#if tools}<div class="cal-tools">{@render tools()}</div>{/if}
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

      <div class="cols" bind:this={colsEl}>
        {#each columns as col (col.key)}
          <div class="col" class:is-today={col.isToday} class:is-all={col.key === '__all__'}>
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

              {#each col.events as b (b.id)}
                {@const tone = STATUS_TONE[b.status] ?? null}
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
                  id="evt-{b.id}"
                >
                  {#snippet content()}
                    <div class="hover-card">
                      <div class="hc-head">
                        <span class="t-label hc-time">{hhmm(b.start)} – {hhmm(b.end)}</span>
                        <span class="hc-head-end">
                          {#if !hoverHidden.has('status')}
                            {#if tone}
                              <Badge variant="semantic" value={tone} size="sm"
                                >{statusLabel(b.status)}</Badge
                              >
                            {:else}
                              <Badge size="sm">{statusLabel(b.status)}</Badge>
                            {/if}
                          {/if}
                          <Button
                            variant="ghost"
                            size="xs"
                            class="hc-cfg"
                            aria-label={m.cal_card_fields()}
                            aria-expanded={fieldsOpen}
                            onclick={() => (fieldsOpen = !fieldsOpen)}
                          >
                            <Settings2 size={iconSizes.sm} />
                          </Button>
                        </span>
                      </div>
                      {#if fieldsOpen}
                        <FieldsList
                          heading={m.cal_card_fields()}
                          fields={hoverFieldItems}
                          hidden={hoverHidden}
                          order={hoverOrder}
                          ontoggle={toggleHoverField}
                          onmove={moveHoverField}
                          lockedKeys={['status']}
                        />
                      {/if}
                      {#each hoverRows as f (f)}
                        {#if f === 'title'}
                          <p class="t-title hc-title">
                            {eventTitle(b.eventTypeId)}
                            {#if b.checkup}<Badge size="sm">{m.cal_checkup_badge()}</Badge>{/if}
                          </p>
                        {:else if f === 'staff'}
                          <dl class="hc-row">
                            <dt class="t-caption">{m.cal_staff()}</dt>
                            <dd class="t-body">{resourceName(b.resourceId)}</dd>
                          </dl>
                        {:else if f === 'client'}
                          <dl class="hc-row">
                            <dt class="t-caption">{m.cal_client()}</dt>
                            <dd class="t-body">{b.attendeeName ?? '—'}</dd>
                          </dl>
                        {:else if f === 'phone' && b.attendeePhone}
                          <dl class="hc-row">
                            <dt class="t-caption">{m.sched_book_phone()}</dt>
                            <dd class="t-body">{b.attendeePhone}</dd>
                          </dl>
                        {:else if f === 'tags' && b.tags?.length}
                          <div class="hc-tags">
                            {#each b.tags as t (t.origin + t.id)}
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
                          <div class="hc-chips">{@render chips(b)}</div>
                        {:else if f === 'actions'}
                          <div class="hc-actions">
                            <Button size="sm" onclick={() => onopen(b.id)}>{m.cal_open()}</Button>
                            {#if actions}{@render actions(b)}{/if}
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
                          : 'tone-neutral'} {b.checkup ? 'is-checkup' : ''} {drag?.active &&
                      drag.id === b.id
                        ? 'is-dragging'
                        : ''}"
                      style="top:{b.top}px;height:{b.height}px;left:calc(var(--sx) + var(--sw) * {b.lane /
                        b.lanes} + var(--space-0-5));width:calc(var(--sw) / {b.lanes} - var(--space-2));border-left-color:{sliver ??
                        'var(--color-accent)'};--evt-c:{block ?? 'transparent'}"
                      onclick={() => openBox(b.id)}
                    >
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <!-- Pointer-only enhancement: the enclosing Button is the
                           keyboard path (open → edit the time in the drawer). -->
                      <span
                        class="evt-in"
                        class:draggable={!!onmove}
                        onpointerdown={(e) => beginDrag(e, b, col, 'move')}
                      >
                        <!-- Per-viewer block layout: the FIRST visible line gets
                             `.evt-lead` (the bold/primary row the time used to
                             own unconditionally), so hiding the time promotes
                             whatever the viewer put on top instead of leaving an
                             empty leading row. -->
                        {#each blockRows as f, i (f)}
                          {#if f === 'time'}
                            <span class="evt-t" class:evt-lead={i === 0}>{hhmm(b.start)}</span>
                          {:else if f === 'service'}
                            <span class="evt-s truncate" class:evt-lead={i === 0}>
                              {eventTitle(b.eventTypeId)}
                            </span>
                          {:else if f === 'client'}
                            <span class="evt-a truncate" class:evt-lead={i === 0}>
                              {b.attendeeName ?? ''}
                            </span>
                          {/if}
                        {/each}
                        {#if !blockHidden.has('tags') && b.tags?.length}
                          <span class="evt-tags">
                            {#each b.tags.slice(0, 6) as t (t.origin + t.id)}
                              <TagDot name={t.name} color={t.color} origin={t.origin} />
                            {/each}
                          </span>
                        {/if}
                        {#if onmove}
                          <span
                            class="evt-resize"
                            aria-hidden="true"
                            onpointerdown={(e) => beginDrag(e, b, col, 'resize')}
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
                   z-index, local or global, is involved. -->
              {#if col.isToday && nowTop !== null}
                <div class="now-line" style="top:{nowTop}px" aria-hidden="true"></div>
              {/if}

              {#if dropHint && dropHint.colKey === col.key}
                <div class="drop-hint" style="top:{dropHint.top}px">
                  <span class="evt-t">{dropHint.label}</span>
                </div>
              {/if}

              {#if ghost && ghost.colKey === col.key}
                <div class="evt-ghost" style="top:{ghost.top}px;height:{ghost.height}px">
                  <span class="evt-t">{minLabel(ghost.startMin)} – {minLabel(ghost.endMin)}</span>
                </div>
              {/if}
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
    width: 52px;
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
    height: 40px;
    background: var(--color-canvas);
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
    z-index: var(--cal-tier-col-head, 1);
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
  .hc-head :global(.hc-cfg) {
    height: auto;
    min-height: 0;
    padding: var(--space-0-5);
    color: var(--color-text-tertiary);
  }
  .hc-head :global(.hc-cfg:hover) {
    color: var(--color-text-primary);
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
