/**
 * The runway's "settled day" workaround, lifted verbatim from
 * `/pos/appointments/+page.svelte`.
 *
 * The calendar's runway moves the focused day with a SHALLOW `replaceState` as
 * it scrolls, so it runs ahead of the page's own load (`pageDay()`, the day the
 * last real load ran for) — a `goto` on every settled scroll would re-run the
 * load at exactly the latency the runway exists to remove. Own state rather
 * than `page.url`: a shallow replace did not turn over `page.url.searchParams`
 * reliably (a day switch after several scrolled weeks went to the LOADED day,
 * not the settled one), so the settled day is kept here and re-seeded whenever
 * a real load lands (`pageDay()` changes).
 */
import { track } from '$lib/analytics/track';

export interface SettledDayConfig {
  /** Reactive: the day the last real load ran for (`data.day`). */
  pageDay: () => string;
  /** Reactive: the current view (`data.view`) — carried into the replaced URL. */
  view: () => string;
  /** Write the URL for a settled scroll WITHOUT a navigation/reload — e.g.
   *  `(params) => replaceState(\`?${params}\`, page.state)`. */
  replaceUrl: (params: URLSearchParams) => void;
}

export interface SettledDay {
  /** `settledDay ?? pageDay()` — everything that builds a link or a prefilled
   *  form reads this, never `pageDay()` directly. */
  readonly currentDay: string;
  /** The runway settled on a new week: mirror it in the URL with a shallow
   *  replace and remember it until the next real load. */
  replaceDate(day: string): void;
}

// Browser caps history.replaceState at 100 calls / 10s (SecurityError past
// that — seen in prod on a long scroll session). A fast runway scroll can
// settle many days a second, so the URL write is throttled: at most one
// replaceUrl per window, trailing-edge, always carrying the latest day.
const URL_WRITE_THROTTLE_MS = 250;

export function createSettledDay(config: SettledDayConfig): SettledDay {
  let settledDay = $state<string | null>(null);
  let pendingFlush: ReturnType<typeof setTimeout> | null = null;
  let dropped = 0;

  $effect(() => {
    void config.pageDay();
    settledDay = null;
  });

  const currentDay = $derived(settledDay ?? config.pageDay());

  function writeUrl(day: string): void {
    config.replaceUrl(new URLSearchParams({ view: config.view(), date: day }));
  }

  function replaceDate(day: string): void {
    if (day === settledDay) return;
    settledDay = day;

    if (pendingFlush !== null) {
      dropped += 1;
      return;
    }

    writeUrl(day);
    pendingFlush = setTimeout(() => {
      pendingFlush = null;
      if (dropped > 0) {
        const coalesced = dropped;
        dropped = 0;
        // settledDay is non-null here: replaceDate always set it before scheduling.
        writeUrl(settledDay!);
        track('calendar_url_replace_coalesced', { dropped: coalesced });
      }
    }, URL_WRITE_THROTTLE_MS);
  }

  return {
    get currentDay() {
      return currentDay;
    },
    replaceDate,
  };
}
