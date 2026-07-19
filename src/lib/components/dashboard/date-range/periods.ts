// Period (granularity) logic for the dashboard date controls.
// A period is "viewable" only when the window spans at least one whole unit of
// it — otherwise the chart collapses to a single bucket. Thresholds are data,
// so a dashboard can tighten them without forking the logic.

export type Period = 'day' | 'week' | 'month' | 'year';

export const ALL_PERIODS: Period[] = ['day', 'week', 'month', 'year'];

/** Minimum span (in days) for each period to be worth rendering. */
export const PERIOD_MIN_DAYS: Record<Period, number> = {
  day: 0,
  week: 7,
  month: 28,
  year: 365,
};

const DAY_MS = 86_400_000;

/** Whole days between two 'YYYY-MM-DD' bounds (0 when either is missing/invalid). */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / DAY_MS));
}

/** An open bound (all-time) can't be measured — every period stays available. */
export function periodEnabled(
  p: Period,
  from: string,
  to: string,
  minDays: Record<Period, number> = PERIOD_MIN_DAYS,
): boolean {
  if (!from || !to) return true;
  return daysBetween(from, to) >= minDays[p];
}

export function enabledPeriods(
  from: string,
  to: string,
  allowed: Period[] = ALL_PERIODS,
  minDays: Record<Period, number> = PERIOD_MIN_DAYS,
): Period[] {
  return allowed.filter((p) => periodEnabled(p, from, to, minDays));
}

/**
 * Keep `current` if it is still viewable, else fall back to the COARSEST period
 * that is (day always qualifies). Call this whenever the window changes so a
 * now-too-coarse selection snaps down instead of rendering one bar.
 */
export function coercePeriod(
  current: Period,
  from: string,
  to: string,
  allowed: Period[] = ALL_PERIODS,
  minDays: Record<Period, number> = PERIOD_MIN_DAYS,
): Period {
  if (allowed.includes(current) && periodEnabled(current, from, to, minDays)) return current;
  for (let i = allowed.length - 1; i >= 0; i--) {
    if (periodEnabled(allowed[i], from, to, minDays)) return allowed[i];
  }
  return 'day';
}
