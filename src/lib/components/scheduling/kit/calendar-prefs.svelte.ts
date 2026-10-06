/**
 * Per-viewer calendar preferences — colour sources, week-days-per-screen and
 * the invoiced/scheduled split — lifted verbatim from
 * `/pos/appointments/+page.svelte`, generalised over a `namespace` so
 * `/scheduling/calendar` gets its own `localStorage` keys.
 *
 * The POS namespace ('pos') MUST resolve to today's exact keys —
 * `hub-pos-calendar-color-block`, `hub-pos-calendar-color-sliver`,
 * `hub-pos-calendar-week-days`, `hub-pos-calendar-split` — so existing viewer
 * preferences survive the refactor untouched.
 *
 * `staff` is the ONE un-namespaced preference (`hub-calendar-staff`): the same
 * people are filtered on both surfaces, and a selection that sticks on one
 * calendar but resets on the other reads as a bug (owner 2026-10-06: "Nothing
 * should be conflicting nor rivaling"). Empty = all.
 */
import {
  DEFAULT_BLOCK_SOURCE,
  DEFAULT_SLIVER_SOURCE,
  parseColorSource,
  type ColorSource,
} from '../booking-color';
import {
  DEFAULT_PX_PER_HOUR,
  PX_PER_HOUR_MAX,
  PX_PER_HOUR_MIN,
  WEEK_DAYS_MIN,
  WEEK_DAYS_MAX,
} from '../BookingCalendar.svelte';

export interface CalendarPrefs {
  readonly blockColorBy: ColorSource;
  readonly sliverColorBy: ColorSource;
  readonly weekDays: number;
  readonly split: boolean;
  /** Time-axis scale (gutter drag). */
  readonly pxPerHour: number;
  /** Subcolumn source: a `ColorSource`, or `prop:<id>` for a custom select
   *  column on appointments; `'none'` = off. */
  readonly subBy: string;
  /** Board view axis: `status`, `staff`, or `prop:<id>`. */
  readonly boardBy: string;
  /** Persisted staff filter, shared across namespaces. Resource ids; empty =
   *  all. Pages pass it through `knownStaff` before filtering. */
  readonly staff: readonly string[];
  setColorBy(next: { block: ColorSource; sliver: ColorSource }): void;
  setWeekDays(n: number): void;
  setSplit(v: boolean): void;
  setPxPerHour(px: number): void;
  setSubBy(source: string): void;
  setBoardBy(axis: string): void;
  setStaff(ids: readonly string[]): void;
}

/**
 * The saved staff selection restricted to resources that still exist. A staff
 * member deactivated after the preference was saved must not keep filtering —
 * otherwise the calendar renders empty with the filter lit and nothing to
 * un-tick. Empty = all, so an all-stale selection falls back to everyone.
 */
export function knownStaff(
  saved: readonly string[],
  resources: readonly { id: string }[],
): Set<string> {
  const ids = new Set(resources.map((r) => r.id));
  return new Set(saved.filter((id) => ids.has(id)));
}

export function createCalendarPrefs(namespace: string): CalendarPrefs {
  const BLOCK_KEY = `hub-${namespace}-calendar-color-block`;
  const SLIVER_KEY = `hub-${namespace}-calendar-color-sliver`;
  const WEEK_DAYS_KEY = `hub-${namespace}-calendar-week-days`;
  const SPLIT_KEY = `hub-${namespace}-calendar-split`;
  const PX_KEY = `hub-${namespace}-calendar-px-per-hour`;
  const SUB_KEY = `hub-${namespace}-calendar-subcolumns`;
  const BOARD_KEY = `hub-${namespace}-calendar-board-by`;
  const STAFF_KEY = 'hub-calendar-staff'; // deliberately NOT namespaced — see file doc

  let blockColorBy = $state<ColorSource>(DEFAULT_BLOCK_SOURCE);
  let sliverColorBy = $state<ColorSource>(DEFAULT_SLIVER_SOURCE);
  let weekDays = $state(7);
  let split = $state(false);
  let pxPerHour = $state(DEFAULT_PX_PER_HOUR);
  let subBy = $state('none');
  let boardBy = $state('status');
  let staff = $state<string[]>([]);

  $effect(() => {
    try {
      blockColorBy = parseColorSource(localStorage.getItem(BLOCK_KEY), DEFAULT_BLOCK_SOURCE);
      sliverColorBy = parseColorSource(localStorage.getItem(SLIVER_KEY), DEFAULT_SLIVER_SOURCE);
    } catch {
      /* per-viewer convenience only */
    }
  });
  $effect(() => {
    try {
      const stored = Number(localStorage.getItem(WEEK_DAYS_KEY));
      if (Number.isInteger(stored) && stored >= WEEK_DAYS_MIN && stored <= WEEK_DAYS_MAX)
        weekDays = stored;
    } catch {
      /* per-viewer convenience only */
    }
  });
  $effect(() => {
    try {
      split = localStorage.getItem(SPLIT_KEY) === '1';
    } catch {
      /* per-viewer convenience only */
    }
  });
  $effect(() => {
    try {
      const stored = Number(localStorage.getItem(PX_KEY));
      if (Number.isInteger(stored) && stored >= PX_PER_HOUR_MIN && stored <= PX_PER_HOUR_MAX)
        pxPerHour = stored;
    } catch {
      /* per-viewer convenience only */
    }
  });
  $effect(() => {
    try {
      const stored = localStorage.getItem(SUB_KEY);
      subBy = stored?.startsWith('prop:') ? stored : parseColorSource(stored, 'none');
    } catch {
      /* per-viewer convenience only */
    }
  });
  $effect(() => {
    try {
      const stored = localStorage.getItem(BOARD_KEY);
      if (stored === 'status' || stored === 'staff' || stored?.startsWith('prop:'))
        boardBy = stored;
    } catch {
      /* per-viewer convenience only */
    }
  });

  $effect(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(STAFF_KEY) ?? '[]');
      if (Array.isArray(stored)) staff = stored.filter((v): v is string => typeof v === 'string');
    } catch {
      /* per-viewer convenience only */
    }
  });

  function setColorBy(next: { block: ColorSource; sliver: ColorSource }): void {
    blockColorBy = next.block;
    sliverColorBy = next.sliver;
    try {
      localStorage.setItem(BLOCK_KEY, next.block);
      localStorage.setItem(SLIVER_KEY, next.sliver);
    } catch {
      /* ignore */
    }
  }
  function setWeekDays(n: number): void {
    weekDays = n;
    try {
      localStorage.setItem(WEEK_DAYS_KEY, String(n));
    } catch {
      /* ignore */
    }
  }
  function setSplit(v: boolean): void {
    split = v;
    try {
      localStorage.setItem(SPLIT_KEY, v ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  function setPxPerHour(px: number): void {
    pxPerHour = Math.round(Math.min(PX_PER_HOUR_MAX, Math.max(PX_PER_HOUR_MIN, px)));
    try {
      localStorage.setItem(PX_KEY, String(pxPerHour));
    } catch {
      /* ignore */
    }
  }

  function setSubBy(source: string): void {
    subBy = source;
    try {
      localStorage.setItem(SUB_KEY, source);
    } catch {
      /* ignore */
    }
  }

  function setBoardBy(axis: string): void {
    boardBy = axis;
    try {
      localStorage.setItem(BOARD_KEY, axis);
    } catch {
      /* ignore */
    }
  }

  function setStaff(ids: readonly string[]): void {
    staff = [...ids];
    try {
      localStorage.setItem(STAFF_KEY, JSON.stringify(staff));
    } catch {
      /* ignore */
    }
  }

  return {
    get blockColorBy() {
      return blockColorBy;
    },
    get sliverColorBy() {
      return sliverColorBy;
    },
    get weekDays() {
      return weekDays;
    },
    get split() {
      return split;
    },
    get pxPerHour() {
      return pxPerHour;
    },
    get subBy() {
      return subBy;
    },
    get boardBy() {
      return boardBy;
    },
    get staff() {
      return staff;
    },
    setColorBy,
    setWeekDays,
    setSplit,
    setPxPerHour,
    setSubBy,
    setBoardBy,
    setStaff,
  };
}
