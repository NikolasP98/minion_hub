/**
 * Declared connection → query specs (spec 049 I3). Pure: `now` is a parameter
 * so a period window is reproducible, and the output is the same `QuerySpec`
 * shape `/api/sandbox/query` compiles (registry identifiers, bound values,
 * RBAC/RLS on the server). Blocks never compute dates or group rows in the
 * browser; the SQL does it.
 */
import type { DataBlockSpec, Bucket, PageValue, Range } from './schema';

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
  window: Window | null,
  extra: NonNullable<BlockQuery['where']>,
): BlockQuery {
  const where = [
    ...(source.filters ?? []),
    ...(source.period ? windowWhere(source.period.col, window) : []),
    ...extra,
  ];
  return { dataset: source.dataset, ...(where.length ? { where } : {}) };
}

/** One working connection resolved to the page value it currently reads (spec 150). */
export interface Binding {
  /** The block's own column the value filters. */
  col: string;
  value: PageValue;
}

/**
 * Folds bindings into the block's own conditions. A date value on the column of
 * the block's own period REPLACES that window (and drives compare/trend);
 * on any other column it adds a window of its own. Pickers add `=` / `in`.
 */
function resolve(
  source: { period?: { col: string; range: Range } },
  bindings: readonly Binding[],
  now: Date,
) {
  let window = source.period ? periodWindow(source.period.range, now) : null;
  let range = source.period?.range;
  let overridden = false;
  const extra: NonNullable<BlockQuery['where']> = [];
  for (const { col, value } of bindings) {
    if (value.kind === 'date') {
      if (source.period && col === source.period.col && !overridden) {
        range = value.range;
        window = periodWindow(value.range, now);
        overridden = true;
      } else extra.push(...windowWhere(col, periodWindow(value.range, now)));
    } else if (value.kind === 'select') {
      extra.push({ col, op: 'eq', value: value.value });
    } else if (value.values.length > 0) {
      extra.push({ col, op: 'in', value: value.values });
    }
  }
  return { window, range, overridden, extra };
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

export function blockQueries(
  spec: DataBlockSpec,
  now: Date,
  bindings: readonly Binding[] = [],
): BlockQueries {
  const { window, range, overridden, extra } = resolve(spec.source, bindings, now);
  switch (spec.type) {
    case 'kpi': {
      const { source } = spec;
      const metric = [{ fn: source.metric.fn, col: source.metric.col, as: VALUE }];
      const value: BlockQuery = { ...base(source, window, extra), aggregate: metric };
      const out: BlockQueries = { kind: 'kpi', value };
      if (spec.compare && source.period && window) {
        out.compare = {
          ...base(source, previousWindow(window, range), extra),
          aggregate: metric,
        };
      }
      // An "all time" filter on the block's own column has no window to bucket.
      if (spec.trend && source.period && !(overridden && !window)) {
        out.trend = {
          ...base(source, window, extra),
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
            ...base(source, window, extra),
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
          ...base(source, window, extra),
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
          ...base(source, window, extra),
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
          ...base(source, window, extra),
          groupBy: [source.dimension],
          aggregate: [{ fn: source.metric.fn, col: source.metric.col, as: VALUE }],
          orderBy: [{ col: VALUE, dir: 'desc' }],
          limit: source.limit,
        },
      };
    }
  }
}

/** Choices a picker shows (FR-002). One more than shown is fetched so a cut-off list is detectable. */
export const OPTIONS_LIMIT = 200;

/**
 * The query behind a picker: distinct values of one column, most common first.
 * It goes through `/api/sandbox/query`, so the viewer only sees values from rows
 * their role may read, and a personal-data column was refused at save.
 *
 * TODO(handoff): choices beyond the first 200 need a server-side search
 * (`startsWith` on the typed text) — planned for S2 of spec 150; until then a
 * longer list is cut at 200 with no hint to the viewer.
 */
export function optionsQuery(options: { dataset: string; col: string }): BlockQuery {
  return {
    dataset: options.dataset,
    groupBy: [options.col],
    aggregate: [{ fn: 'count', col: '*', as: 'n' }],
    orderBy: [{ col: 'n', dir: 'desc' }],
    limit: OPTIONS_LIMIT + 1,
  };
}

export interface PickerOption {
  value: string | number | boolean;
  count: number;
}

/** Drops the blank group (never a choice) and keeps the first 200. */
export function pickerOptions(rows: Record<string, unknown>[], col: string): PickerOption[] {
  return rows
    .filter((r) => r[col] !== null && r[col] !== undefined && r[col] !== '')
    .slice(0, OPTIONS_LIMIT)
    .map((r) => ({ value: r[col] as PickerOption['value'], count: Number(r.n) || 0 }));
}
