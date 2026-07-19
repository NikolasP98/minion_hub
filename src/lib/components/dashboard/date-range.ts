// Shared date-range logic for the standard dashboard date controls (from/to +
// quick ranges + smart period picker). Pure + testable; the UI lives in
// DateRangeControls.svelte. Dates are 'YYYY-MM-DD' strings ('' = open/all-time).

export type Period = 'day' | 'week' | 'month' | 'year';
export const ALL_PERIODS: Period[] = ['day', 'week', 'month', 'year'];

// A period is viewable only when the range spans at least one whole unit of it
// — otherwise the chart collapses to a single bucket ("not enough to view").
// Tunable; mirrored in the UI-governance date-controls contract.
const MIN_DAYS: Record<Period, number> = { day: 0, week: 7, month: 28, year: 365 };

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

// Open range (missing from OR to = all-time) enables every period.
export function periodEnabled(p: Period, from: string, to: string): boolean {
  if (!from || !to) return true;
  return daysBetween(from, to) >= MIN_DAYS[p];
}

// Keep the current period if still viewable; else fall back to the coarsest
// period that IS viewable within `allowed` (day always qualifies).
export function coercePeriod(
  current: Period,
  from: string,
  to: string,
  allowed: Period[] = ALL_PERIODS,
): Period {
  if (allowed.includes(current) && periodEnabled(current, from, to)) return current;
  for (let i = allowed.length - 1; i >= 0; i--) {
    if (periodEnabled(allowed[i], from, to)) return allowed[i];
  }
  return 'day';
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

// Quick + extended range ids → {from,to} for a reference "now". 'all' clamps to
// dataMin when known, else an open ('') start.
export function quickRange(
  id: string,
  now: Date,
  dataMin?: string,
): { from: string; to: string } | null {
  const to = iso(now);
  const from = new Date(now);
  switch (id) {
    case '1d': from.setDate(from.getDate() - 1); break;
    case '7d': from.setDate(from.getDate() - 7); break;
    case '30d': from.setDate(from.getDate() - 30); break;
    case 'ytd': return { from: `${now.getFullYear()}-01-01`, to };
    case '1y': from.setFullYear(from.getFullYear() - 1); break;
    case 'mtd': from.setDate(1); break;
    case '2mo': from.setMonth(from.getMonth() - 2); break;
    case '3mo': from.setMonth(from.getMonth() - 3); break;
    case '6mo': from.setMonth(from.getMonth() - 6); break;
    case 'all': return { from: dataMin ?? '', to: '' };
    default: return null;
  }
  return { from: iso(from), to };
}

// Which quick-range id (if any) currently produces this from/to.
export function matchQuickRange(
  from: string,
  to: string,
  ids: string[],
  now: Date,
  dataMin?: string,
): string | null {
  for (const id of ids) {
    const r = quickRange(id, now, dataMin);
    if (r && r.from === from && r.to === to) return id;
  }
  return null;
}
