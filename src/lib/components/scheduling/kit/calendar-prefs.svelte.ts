import { untrack } from 'svelte';
import { layoutRecord } from '$lib/components/data-view/layout-catalog';
import { createScopedPreference } from '$lib/state/ui/scoped-preference.svelte';
/** Calendar preferences are isolated by actor/org; staff is shared across calendars within that owner. */
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
  const bounded = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v)
      ? Math.round(Math.min(max, Math.max(min, v)))
      : fallback;
  const prop = (v: unknown) => typeof v === 'string' && /^prop:[A-Za-z0-9_-]{1,100}$/.test(v);
  const sub = (v: unknown) =>
    prop(v) ? (v as string) : parseColorSource(typeof v === 'string' ? v : null, 'none');
  const board = (v: unknown) =>
    v === 'status' || v === 'staff' || prop(v) ? (v as string) : 'status';
  const defaults = () => ({
    version: 1,
    blockColorBy: DEFAULT_BLOCK_SOURCE,
    sliverColorBy: DEFAULT_SLIVER_SOURCE,
    weekDays: 7,
    split: false,
    pxPerHour: DEFAULT_PX_PER_HOUR,
    subBy: 'none',
    boardBy: 'status',
  });
  const normalize = (value: unknown) => {
    const v = layoutRecord(value) ?? {};
    return {
      version: 1,
      blockColorBy: parseColorSource(
        typeof v.blockColorBy === 'string' ? v.blockColorBy : null,
        DEFAULT_BLOCK_SOURCE,
      ),
      sliverColorBy: parseColorSource(
        typeof v.sliverColorBy === 'string' ? v.sliverColorBy : null,
        DEFAULT_SLIVER_SOURCE,
      ),
      weekDays: bounded(v.weekDays, 7, WEEK_DAYS_MIN, WEEK_DAYS_MAX),
      split: v.split === true,
      pxPerHour: bounded(v.pxPerHour, DEFAULT_PX_PER_HOUR, PX_PER_HOUR_MIN, PX_PER_HOUR_MAX),
      subBy: sub(v.subBy),
      boardBy: board(v.boardBy),
    };
  };
  const pref = createScopedPreference(`calendar:${namespace}`, defaults, normalize);
  const staffPref = createScopedPreference<string[]>(
    'calendar:staff',
    () => [],
    (v) =>
      Array.isArray(v)
        ? [
            ...new Set(
              v.filter(
                (id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 100,
              ),
            ),
          ]
        : [],
  );
  function update(next: Partial<ReturnType<typeof defaults>>) {
    untrack(() => pref.set(normalize({ ...pref.value, ...next })));
  }
  return {
    get blockColorBy() {
      return pref.value.blockColorBy;
    },
    get sliverColorBy() {
      return pref.value.sliverColorBy;
    },
    get weekDays() {
      return pref.value.weekDays;
    },
    get split() {
      return pref.value.split;
    },
    get pxPerHour() {
      return pref.value.pxPerHour;
    },
    get subBy() {
      return pref.value.subBy;
    },
    get boardBy() {
      return pref.value.boardBy;
    },
    get staff() {
      return staffPref.value;
    },
    setColorBy(next) {
      update({ blockColorBy: next.block, sliverColorBy: next.sliver });
    },
    setWeekDays(n) {
      update({ weekDays: n });
    },
    setSplit(v) {
      update({ split: v });
    },
    setPxPerHour(v) {
      update({ pxPerHour: v });
    },
    setSubBy(v) {
      update({ subBy: v });
    },
    setBoardBy(v) {
      update({ boardBy: v });
    },
    setStaff(ids) {
      staffPref.set([
        ...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 100)),
      ]);
    },
  };
}
