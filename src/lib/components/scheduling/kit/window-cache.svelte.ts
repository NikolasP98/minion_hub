/**
 * Week-bucketed data cache for a `BookingCalendar` page's infinite scrolling.
 *
 * The runway scrolls through a year without navigating, so a page's data can't
 * be "whatever the last load fetched" any more. This keeps one payload per ISO
 * week: the caller's SSR load seeds whichever weeks it covers, `onRange` fetches
 * the missing neighbours as the calendar settles, and weeks far from the screen
 * are evicted so an hour of scrolling can't grow the tab without bound.
 *
 * Lifted verbatim (behaviour-identical) from `/pos/appointments/+page.svelte`'s
 * `fetchWeek`/`loadMissing`/`onRange` trio — generalised over the payload type
 * `T` so `/scheduling/calendar` can share it. `T`-specific bucketing (which
 * fields go in which week) stays with the caller: this module only knows ISO
 * Monday keys and how to merge whole-week payloads.
 */
import { untrack } from 'svelte';
import { dayAt, mondayOf } from '../runway';

export interface CalendarWindowCacheConfig<T> {
  /** Reactive: ISO days the caller's OWN load window covers this render (wider
   *  than the rendered view — see `calendarLoadWindow`). Every ISO Monday among
   *  these counts as already seeded, even for a week the payload holds nothing
   *  for — otherwise an empty week would be refetched on every settle forever. */
  seedRange: () => string[];
  /** Reactive: the caller's load payload, already bucketed per ISO Monday key.
   *  Sparse is fine — a week absent here simply contributes nothing to `data`. */
  seed: () => Map<string, T>;
  /** GET one ISO week's payload: `[monday, monday+6]`. */
  fetchWindow: (from: string, to: string) => Promise<T>;
  /** Merge every loaded week's payload (seed ∪ fetched) into what the caller renders. */
  merge: (parts: T[]) => T;
  /** Weeks kept either side of the visible range before eviction. Default 4
   *  (matches the POS page's original `WEEK_KEEP`). */
  keepWeeks?: number;
  /** A week failed to fetch. The key stays unloaded, so the next settle over it
   *  retries — this is just the notification hook (e.g. a toast). */
  onError?: (e: unknown, key: string) => void;
}

export interface CalendarWindowCache<T> {
  /** The union of every loaded week — what the calendar renders. */
  readonly data: T;
  /** Any week fetch currently in flight (drives a toolbar spinner). */
  readonly busy: boolean;
  /** The calendar settled on a new visible range (and on init): load missing
   *  neighbours, evict weeks past `keepWeeks`. */
  onRange(first: string, last: string): void;
  /** After a mutation's `refresh()`, the caller's own reload only covers ITS
   *  window — every other on-screen week may now be stale (a box moved into or
   *  out of it), so re-fetch everything visible that isn't freshly seeded. */
  refetchVisible(): void;
}

/** `W(first) − pad … W(last) + pad`, as ISO Mondays. */
function weekKeysAround(first: string, last: string, pad = 1): string[] {
  const to = dayAt(mondayOf(last), 7 * pad);
  const keys: string[] = [];
  for (let key = dayAt(mondayOf(first), -7 * pad); key <= to; key = dayAt(key, 7)) keys.push(key);
  return keys;
}

export function createCalendarWindowCache<T>(
  config: CalendarWindowCacheConfig<T>,
): CalendarWindowCache<T> {
  const keepWeeks = config.keepWeeks ?? 4;

  let fetchedWeeks = $state(new Map<string, T>());
  /** In-flight week keys — plain `Set` (never rendered); `busyCount` is the
   *  reactive projection `busy` reads. */
  const inflight = new Set<string>();
  let busyCount = $state(0);
  let visibleFirst = $state('');
  let visibleLast = $state('');

  const seededKeys = $derived(new Set(config.seedRange().map(mondayOf)));
  const weeks = $derived.by(() => {
    const out = new Map(fetchedWeeks);
    for (const [key, week] of config.seed()) out.set(key, week);
    return out;
  });
  const data = $derived(config.merge([...weeks.values()]));

  function weekEnd(monday: string): string {
    return dayAt(monday, 6);
  }

  async function fetchWeek(key: string): Promise<void> {
    inflight.add(key);
    busyCount = inflight.size;
    try {
      const week = await config.fetchWindow(key, weekEnd(key));
      fetchedWeeks = new Map(fetchedWeeks).set(key, week);
    } catch (e) {
      config.onError?.(e, key);
    } finally {
      inflight.delete(key);
      busyCount = inflight.size;
    }
  }

  function loadMissing(first: string, last: string): void {
    for (const key of weekKeysAround(first, last))
      if (!seededKeys.has(key) && !weeks.has(key) && !inflight.has(key)) void fetchWeek(key);
  }

  function onRange(first: string, last: string): void {
    visibleFirst = first;
    visibleLast = last;
    // `untrack`: the calendar emits this from an effect of its own, so reading
    // `weeks`/`seededKeys` here would subscribe THAT effect to the cache it
    // then writes to.
    untrack(() => {
      loadMissing(first, last);
      const min = dayAt(mondayOf(first), -7 * keepWeeks);
      const max = dayAt(mondayOf(last), 7 * keepWeeks);
      const keep = new Map([...fetchedWeeks].filter(([key]) => key >= min && key <= max));
      if (keep.size !== fetchedWeeks.size) fetchedWeeks = keep;
    });
  }

  function refetchVisible(): void {
    if (!visibleFirst) return;
    untrack(() => {
      for (const key of weekKeysAround(visibleFirst, visibleLast))
        if (!seededKeys.has(key) && !inflight.has(key)) void fetchWeek(key);
    });
  }

  return {
    get data() {
      return data;
    },
    get busy() {
      return busyCount > 0;
    },
    onRange,
    refetchVisible,
  };
}
