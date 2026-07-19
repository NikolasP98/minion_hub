// URL + timestamp adapters. Dashboards differ in how they persist a window
// (from/to params, an "all" sentinel, raw ms timestamps), so the SDK converts
// rather than forcing one convention.
import type { DateRange } from './ranges';
import type { Period } from './periods';

export interface RangeParamOptions {
  fromKey?: string;
  toKey?: string;
  /** Param that carries the granularity (omit to skip). */
  periodKey?: string;
  /** Sentinel used when the window is open, e.g. `range=all`. */
  allKey?: string;
  allValue?: string;
}

const defaults = (o: RangeParamOptions = {}) => ({
  fromKey: o.fromKey ?? 'from',
  toKey: o.toKey ?? 'to',
  periodKey: o.periodKey,
  allKey: o.allKey,
  allValue: o.allValue ?? 'all',
});

/** Read a window (and optional period) out of search params. */
export function fromSearchParams(
  params: URLSearchParams,
  opts: RangeParamOptions = {},
): DateRange & { period?: string } {
  const o = defaults(opts);
  if (o.allKey && params.get(o.allKey) === o.allValue) {
    return { from: '', to: '', period: o.periodKey ? (params.get(o.periodKey) ?? undefined) : undefined };
  }
  return {
    from: params.get(o.fromKey) ?? '',
    to: params.get(o.toKey) ?? '',
    period: o.periodKey ? (params.get(o.periodKey) ?? undefined) : undefined,
  };
}

/**
 * Serialize a window to search params. An open window writes the `allKey`
 * sentinel when configured, so "all time" survives a reload.
 */
export function toSearchParams(
  value: DateRange & { period?: Period | string },
  opts: RangeParamOptions = {},
): URLSearchParams {
  const o = defaults(opts);
  const p = new URLSearchParams();
  const open = !value.from || !value.to;
  if (open && o.allKey) {
    p.set(o.allKey, o.allValue);
  } else {
    if (value.from) p.set(o.fromKey, value.from);
    if (value.to) p.set(o.toKey, value.to);
  }
  if (o.periodKey && value.period) p.set(o.periodKey, String(value.period));
  return p;
}

// ── Timestamp adapters ───────────────────────────────────────────────────────
// The end bound is INCLUSIVE of the whole `to` day (23:59:59.999). A plain
// midnight `to` silently drops that day's records — the bug that made
// from=to=Jun-1 return zero. Any JS-side date filter should go through here.

export const START_OF_DAY = 'T00:00:00.000';
export const END_OF_DAY = 'T23:59:59.999';

const hasTime = (v: string) => v.includes('T');

/**
 * Inclusive ms bounds. A date-only bound is widened to the whole day; a datetime
 * bound ('YYYY-MM-DDTHH:mm', from sub-day ranges) is used as given. Missing
 * bounds become ±Infinity (open).
 */
export function toTimestamps(range: DateRange): { fromTs: number; toTs: number } {
  const from = range.from
    ? Date.parse(hasTime(range.from) ? range.from : `${range.from}${START_OF_DAY}`)
    : Number.NaN;
  const to = range.to
    ? Date.parse(hasTime(range.to) ? range.to : `${range.to}${END_OF_DAY}`)
    : Number.NaN;
  return {
    fromTs: Number.isFinite(from) ? from : -Infinity,
    toTs: Number.isFinite(to) ? to : Infinity,
  };
}

/**
 * Inverse of toTimestamps. `withTime` emits local 'YYYY-MM-DDTHH:mm' (what a
 * time-of-day surface round-trips); otherwise plain 'YYYY-MM-DD'. '' when open.
 */
export function fromTimestamps(
  fromTs: number,
  toTs: number,
  opts: { withTime?: boolean } = {},
): DateRange {
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (t: number) => {
    if (!Number.isFinite(t)) return '';
    const d = new Date(t);
    if (!opts.withTime) return d.toISOString().slice(0, 10);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  return { from: fmt(fromTs), to: fmt(toTs) };
}

// ── Business-timezone day windows ────────────────────────────────────────────
// A calendar day is a LOCAL concept. Comparing a Lima (UTC-5) business's sales
// against UTC day boundaries cuts its day at 19:00 — evening sales roll into the
// next "day". These resolve a from/to DATE pair to the absolute instants that
// bracket those local days, so SQL keeps comparing a plain indexed timestamp
// (sargable) instead of `issued_at at time zone tz`.

/** Offset (ms) of `tz` from UTC at the given instant. */
function tzOffsetMs(at: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(at)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return asUtc - at.getTime();
}

/** The instant at which 'YYYY-MM-DD' 00:00 begins in `tz`. */
export function zonedStartOfDay(date: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, (m ?? 1) - 1, d ?? 1);
  // Correct twice so a DST boundary near midnight still lands exactly.
  let ms = guess - tzOffsetMs(new Date(guess), tz);
  ms = guess - tzOffsetMs(new Date(ms), tz);
  return new Date(ms);
}

/**
 * Half-open instant window covering the local days `from`..`to` INCLUSIVE in
 * `tz`: [start of `from`, start of the day AFTER `to`). Either bound may be ''
 * for an open side.
 */
export function zonedDayWindow(
  from: string,
  to: string,
  tz: string,
): { from: Date | null; to: Date | null } {
  const start = from ? zonedStartOfDay(from, tz) : null;
  let end: Date | null = null;
  if (to) {
    const [y, m, d] = to.split('-').map(Number);
    const next = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + 1));
    end = zonedStartOfDay(next.toISOString().slice(0, 10), tz);
  }
  return { from: start, to: end };
}
