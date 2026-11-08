/**
 * Declared connection → query specs (spec 049 I3). Pure: `now` is a parameter
 * so a period window is reproducible, and the output is the same `QuerySpec`
 * shape `/api/sandbox/query` compiles (registry identifiers, bound values,
 * RBAC/RLS on the server). Blocks never compute dates or group rows in the
 * browser; the SQL does it.
 */
import type { BlockSpec, Bucket, Range } from './schema';

/** Client-side mirror of the server `QuerySpec` (`$server` is not importable here). */
export interface BlockQuery {
  dataset: string;
  select?: string[];
  where?: Array<{ col: string; op: string; value?: unknown }>;
  orderBy?: Array<{ col: string; dir?: 'asc' | 'desc' }>;
  limit?: number;
  groupBy?: string[];
  aggregate?: Array<{ fn: string; col: string; as: string }>;
  bucket?: { col: string; unit: Bucket };
}

/** Half-open window `[from, to)` in the browser's local time. */
export interface Window {
  from: Date;
  to: Date;
}

const DAY = 86_400_000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Monday-first, matching the hub's calendar and date-range controls. */
function startOfWeek(d: Date): Date {
  const day = startOfDay(d);
  const offset = (day.getDay() + 6) % 7;
  return new Date(day.getTime() - offset * DAY);
}

/** `null` means no window (`range: 'all'`). */
export function periodWindow(range: Range, now: Date): Window | null {
  const today = startOfDay(now);
  const tomorrow = new Date(today.getTime() + DAY);
  switch (range) {
    case 'today':
      return { from: today, to: tomorrow };
    case 'yesterday':
      return { from: new Date(today.getTime() - DAY), to: today };
    case 'last_7d':
      return { from: new Date(today.getTime() - 6 * DAY), to: tomorrow };
    case 'last_30d':
      return { from: new Date(today.getTime() - 29 * DAY), to: tomorrow };
    case 'last_90d':
      return { from: new Date(today.getTime() - 89 * DAY), to: tomorrow };
    case 'this_week':
      return { from: startOfWeek(now), to: tomorrow };
    case 'this_month':
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: tomorrow };
    case 'last_month':
      return {
        from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        to: new Date(now.getFullYear(), now.getMonth(), 1),
      };
    case 'this_year':
      return { from: new Date(now.getFullYear(), 0, 1), to: tomorrow };
    case 'all':
      return null;
  }
}

function shiftMonths(d: Date, months: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + months, d.getDate());
}

/**
 * The comparison window: the previous calendar month/year for calendar
 * ranges (so "last month" compares whole months), otherwise the window of the
 * same length that ends where `w` starts.
 */
export function previousWindow(w: Window, range?: Range): Window {
  if (range === 'this_month' || range === 'last_month') {
    return { from: shiftMonths(w.from, -1), to: shiftMonths(w.to, -1) };
  }
  if (range === 'this_year') {
    return { from: shiftMonths(w.from, -12), to: shiftMonths(w.to, -12) };
  }
  return { from: new Date(w.from.getTime() - (w.to.getTime() - w.from.getTime())), to: w.from };
}

function windowWhere(col: string, w: Window | null): NonNullable<BlockQuery['where']> {
  if (!w) return [];
  return [
    { col, op: 'gte', value: w.from.toISOString() },
    { col, op: 'lt', value: w.to.toISOString() },
  ];
}

function base(
  source: {
    dataset: string;
    filters?: BlockQuery['where'];
    period?: { col: string; range: Range };
  },
  now: Date,
  window?: Window | null,
): BlockQuery {
  const w =
    window === undefined ? (source.period ? periodWindow(source.period.range, now) : null) : window;
  const where = [
    ...(source.filters ?? []),
    ...(source.period ? windowWhere(source.period.col, w) : []),
  ];
  return { dataset: source.dataset, ...(where.length ? { where } : {}) };
}

/** The alias every single-metric block reads its number from. */
export const VALUE = 'value';
/** Chart measure aliases are positional (`m0`, `m1`, …); labels live in the spec. */
export const measureAlias = (index: number) => `m${index}`;

const TREND_LIMIT = 400;
const SERIES_LIMIT = 500;
const CATEGORY_LIMIT = 20;

export type BlockQueries =
  | { kind: 'kpi'; value: BlockQuery; compare?: BlockQuery; trend?: BlockQuery }
  | { kind: 'chart' | 'table' | 'list'; rows: BlockQuery };

export function blockQueries(spec: BlockSpec, now: Date): BlockQueries {
  switch (spec.type) {
    case 'kpi': {
      const { source } = spec;
      const metric = [{ fn: source.metric.fn, col: source.metric.col, as: VALUE }];
      const window = source.period ? periodWindow(source.period.range, now) : null;
      const value: BlockQuery = { ...base(source, now, window), aggregate: metric };
      const out: BlockQueries = { kind: 'kpi', value };
      if (spec.compare && source.period && window) {
        out.compare = {
          ...base(source, now, previousWindow(window, source.period.range)),
          aggregate: metric,
        };
      }
      if (spec.trend && source.period) {
        out.trend = {
          ...base(source, now, window),
          bucket: { col: source.period.col, unit: spec.trend },
          aggregate: metric,
          orderBy: [{ col: source.period.col, dir: 'asc' }],
          limit: TREND_LIMIT,
        };
      }
      return out;
    }
    case 'chart': {
      const { source } = spec;
      const aggregate = source.measures.map((m, i) => ({
        fn: m.fn,
        col: m.col,
        as: measureAlias(i),
      }));
      if (source.time) {
        return {
          kind: 'chart',
          rows: {
            ...base(source, now),
            bucket: { col: source.time.col, unit: source.time.bucket },
            aggregate,
            orderBy: [{ col: source.time.col, dir: 'asc' }],
            limit: source.limit ?? SERIES_LIMIT,
          },
        };
      }
      const dimension = source.dimension ?? '';
      const sort = source.sort ?? 'value_desc';
      return {
        kind: 'chart',
        rows: {
          ...base(source, now),
          groupBy: [dimension],
          aggregate,
          orderBy:
            sort === 'label'
              ? [{ col: dimension, dir: 'asc' }]
              : [{ col: measureAlias(0), dir: sort === 'value_asc' ? 'asc' : 'desc' }],
          limit: source.limit ?? CATEGORY_LIMIT,
        },
      };
    }
    case 'table': {
      const { source } = spec;
      return {
        kind: 'table',
        rows: {
          ...base(source, now),
          ...(source.select?.length ? { select: source.select } : {}),
          ...(source.orderBy?.length ? { orderBy: source.orderBy } : {}),
          limit: source.limit,
        },
      };
    }
    case 'list': {
      const { source } = spec;
      return {
        kind: 'list',
        rows: {
          ...base(source, now),
          groupBy: [source.dimension],
          aggregate: [{ fn: source.metric.fn, col: source.metric.col, as: VALUE }],
          orderBy: [{ col: VALUE, dir: 'desc' }],
          limit: source.limit,
        },
      };
    }
  }
}
