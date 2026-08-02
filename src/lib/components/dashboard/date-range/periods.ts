// Period (granularity) logic for the dashboard date controls.
// A period is "viewable" only when the window spans at least one whole unit of
// it — otherwise the chart collapses to a single bucket. Sub-day periods also
// carry a MAX span (hourly buckets over a year would be 8,760 bars).
// Thresholds are data, so a dashboard can tighten them without forking logic.

export type Period = 'hour' | 'day' | 'week' | 'month' | 'year';

/** Date-granular default — what most dashboards offer. */
export const ALL_PERIODS: Period[] = ['day', 'week', 'month', 'year'];
/** Opt-in set for sub-day surfaces (telemetry). See `withTime` on the controls. */
export const ALL_PERIODS_WITH_TIME: Period[] = ['hour', 'day', 'week', 'month', 'year'];

const MIN = 60_000;
const DAY_MIN = 1440;

/** Minimum span (minutes) for a period to be worth rendering. */
export const PERIOD_MIN_MINUTES: Record<Period, number> = {
  hour: 0,
  day: 0,
  week: 7 * DAY_MIN,
  month: 28 * DAY_MIN,
  year: 365 * DAY_MIN,
};

/** Maximum span (minutes) before a period is too FINE to plot. */
export const PERIOD_MAX_MINUTES: Partial<Record<Period, number>> = {
  hour: 14 * DAY_MIN,
};

/** A bound may be a date ('YYYY-MM-DD') or a datetime ('YYYY-MM-DDTHH:mm'). */
const hasTime = (v: string) => v.includes('T');
const parseBound = (v: string) => Date.parse(hasTime(v) ? v : `${v}T00:00:00.000`);

/** Exact span in minutes (fractional days survive, unlike daysBetween). */
export function spanMinutes(from: string, to: string): number {
  const a = parseBound(from);
  const b = parseBound(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, (b - a) / MIN);
}

/** Whole days between two bounds. */
export function daysBetween(from: string, to: string): number {
  if (!from || !to) return 0;
  return Math.round(spanMinutes(from, to) / DAY_MIN);
}

/** An open bound (all-time) can't be measured — every period stays available. */
export function periodEnabled(
  p: Period,
  from: string,
  to: string,
  minMinutes: Record<Period, number> = PERIOD_MIN_MINUTES,
  maxMinutes: Partial<Record<Period, number>> = PERIOD_MAX_MINUTES,
): boolean {
  if (!from || !to) return true;
  const span = spanMinutes(from, to);
  const max = maxMinutes[p];
  return span >= minMinutes[p] && (max == null || span <= max);
}

export function enabledPeriods(
  from: string,
  to: string,
  allowed: Period[] = ALL_PERIODS,
  minMinutes: Record<Period, number> = PERIOD_MIN_MINUTES,
  maxMinutes: Partial<Record<Period, number>> = PERIOD_MAX_MINUTES,
): Period[] {
  return allowed.filter((p) => periodEnabled(p, from, to, minMinutes, maxMinutes));
}

/**
 * Bucket label for a 'YYYY-MM-DD' date at `p` — the key a client-side rollup
 * groups daily rows by when a dashboard already holds the daily series and
 * doesn't need a re-query per granularity. Week snaps to its ISO Monday.
 */
export function bucketKey(date: string, p: Period): string {
  if (p === 'day' || p === 'hour') return date;
  if (p === 'month') return date.slice(0, 7);
  if (p === 'year') return date.slice(0, 4);
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * Keep `current` if it is still viewable, else fall back to the COARSEST period
 * that is. Call this whenever the window changes so a now-unsuitable selection
 * snaps instead of rendering one bar (or ten thousand).
 */
export function coercePeriod(
  current: Period,
  from: string,
  to: string,
  allowed: Period[] = ALL_PERIODS,
  minMinutes: Record<Period, number> = PERIOD_MIN_MINUTES,
  maxMinutes: Partial<Record<Period, number>> = PERIOD_MAX_MINUTES,
): Period {
  if (allowed.includes(current) && periodEnabled(current, from, to, minMinutes, maxMinutes)) {
    return current;
  }
  for (let i = allowed.length - 1; i >= 0; i--) {
    if (periodEnabled(allowed[i], from, to, minMinutes, maxMinutes)) return allowed[i];
  }
  return allowed[0] ?? 'day';
}
