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

/** Inclusive ms bounds. Missing bounds become ±Infinity (open). */
export function toTimestamps(range: DateRange): { fromTs: number; toTs: number } {
  const from = range.from ? Date.parse(`${range.from}${START_OF_DAY}`) : Number.NaN;
  const to = range.to ? Date.parse(`${range.to}${END_OF_DAY}`) : Number.NaN;
  return {
    fromTs: Number.isFinite(from) ? from : -Infinity,
    toTs: Number.isFinite(to) ? to : Infinity,
  };
}

/** Inverse of toTimestamps — ms bounds back to 'YYYY-MM-DD' ('' when open). */
export function fromTimestamps(fromTs: number, toTs: number): DateRange {
  const iso = (t: number) =>
    Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '';
  return { from: iso(fromTs), to: iso(toTs) };
}
