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

export function createSettledDay(config: SettledDayConfig): SettledDay {
  let settledDay = $state<string | null>(null);

  $effect(() => {
    void config.pageDay();
    settledDay = null;
  });

  const currentDay = $derived(settledDay ?? config.pageDay());

  function replaceDate(day: string): void {
    settledDay = day;
    config.replaceUrl(new URLSearchParams({ view: config.view(), date: day }));
  }

  return {
    get currentDay() {
      return currentDay;
    },
    replaceDate,
  };
}
