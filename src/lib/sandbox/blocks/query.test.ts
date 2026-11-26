import { describe, expect, it } from 'vitest';
import {
  type Binding,
  blockQueries,
  optionsQuery,
  periodWindow,
  pickerOptions,
  previousWindow,
} from './query';
import { parseBlockSpec } from './schema';

// Saturday 2026-11-07 15:30 local time.
const now = new Date(2026, 10, 7, 15, 30);
const iso = (y: number, m: number, d: number) => new Date(y, m, d).toISOString();

describe('periodWindow (half-open, local time)', () => {
  it('computes rolling and calendar presets from a fixed now', () => {
    expect(periodWindow('today', now)).toEqual({
      from: new Date(2026, 10, 7),
      to: new Date(2026, 10, 8),
    });
    expect(periodWindow('yesterday', now)).toEqual({
      from: new Date(2026, 10, 6),
      to: new Date(2026, 10, 7),
    });
    expect(periodWindow('last_7d', now)?.from).toEqual(new Date(2026, 10, 1));
    expect(periodWindow('last_30d', now)?.from).toEqual(new Date(2026, 9, 9));
    // Monday-first week: Sat 7 Nov → Mon 2 Nov.
    expect(periodWindow('this_week', now)?.from).toEqual(new Date(2026, 10, 2));
    expect(periodWindow('this_month', now)?.from).toEqual(new Date(2026, 10, 1));
    expect(periodWindow('last_month', now)).toEqual({
      from: new Date(2026, 9, 1),
      to: new Date(2026, 10, 1),
    });
    expect(periodWindow('this_year', now)?.from).toEqual(new Date(2026, 0, 1));
    expect(periodWindow('all', now)).toBeNull();
  });

  it('previousWindow: same length for rolling ranges, previous calendar unit for month/year', () => {
    const w = periodWindow('last_7d', now)!;
    expect(previousWindow(w, 'last_7d')).toEqual({
      from: new Date(2026, 9, 25),
      to: new Date(2026, 10, 1),
    });
    expect(previousWindow(periodWindow('last_month', now)!, 'last_month')).toEqual({
      from: new Date(2026, 8, 1),
      to: new Date(2026, 9, 1),
    });
    expect(previousWindow(periodWindow('this_month', now)!, 'this_month')).toEqual({
      from: new Date(2026, 9, 1),
      to: new Date(2026, 9, 8),
    });
  });
});

describe('blockQueries', () => {
  it('kpi: totals query, compare window and bucketed trend', () => {
    const spec = parseBlockSpec({
      v: 1,
      type: 'kpi',
      source: {
        dataset: 'pos.tickets',
        metric: { fn: 'sum', col: 'total' },
        period: { col: 'submitted_at', range: 'last_month' },
        filters: [{ col: 'status', op: 'eq', value: 'submitted' }],
      },
      compare: true,
      trend: 'day',
    });
    const q = blockQueries(spec, now);
    expect(q.kind).toBe('kpi');
    if (q.kind !== 'kpi') return;
    expect(q.value).toEqual({
      dataset: 'pos.tickets',
      where: [
        { col: 'status', op: 'eq', value: 'submitted' },
        { col: 'submitted_at', op: 'gte', value: iso(2026, 9, 1) },
        { col: 'submitted_at', op: 'lt', value: iso(2026, 10, 1) },
      ],
      aggregate: [{ fn: 'sum', col: 'total', as: 'value' }],
    });
    expect(q.compare?.where?.slice(1)).toEqual([
      { col: 'submitted_at', op: 'gte', value: iso(2026, 8, 1) },
      { col: 'submitted_at', op: 'lt', value: iso(2026, 9, 1) },
    ]);
    expect(q.trend).toMatchObject({
      bucket: { col: 'submitted_at', unit: 'day' },
      orderBy: [{ col: 'submitted_at', dir: 'asc' }],
    });
  });

  it('kpi without a period has no window, no compare and no trend', () => {
    const q = blockQueries(
      parseBlockSpec({
        v: 1,
        type: 'kpi',
        source: { dataset: 'crm.contacts', metric: { fn: 'count', col: '*' } },
        compare: true,
        trend: 'week',
      }),
      now,
    );
    expect(q).toEqual({
      kind: 'kpi',
      value: { dataset: 'crm.contacts', aggregate: [{ fn: 'count', col: '*', as: 'value' }] },
    });
  });

  it('chart: dimension groups by the category with positional aliases; time buckets', () => {
    const byDim = blockQueries(
      parseBlockSpec({
        v: 1,
        type: 'chart',
        source: {
          dataset: 'pos.ticket_lines',
          dimension: 'product_name',
          measures: [
            { fn: 'sum', col: 'total' },
            { fn: 'count', col: '*' },
          ],
          sort: 'label',
          limit: 5,
        },
      }),
      now,
    );
    expect(byDim).toEqual({
      kind: 'chart',
      rows: {
        dataset: 'pos.ticket_lines',
        groupBy: ['product_name'],
        aggregate: [
          { fn: 'sum', col: 'total', as: 'm0' },
          { fn: 'count', col: '*', as: 'm1' },
        ],
        orderBy: [{ col: 'product_name', dir: 'asc' }],
        limit: 5,
      },
    });
    const byTime = blockQueries(
      parseBlockSpec({
        v: 1,
        type: 'chart',
        preset: 'area',
        source: {
          dataset: 'pos.tickets',
          time: { col: 'submitted_at', bucket: 'week' },
          measures: [{ fn: 'sum', col: 'total' }],
          period: { col: 'submitted_at', range: 'last_90d' },
        },
      }),
      now,
    );
    expect(byTime.kind === 'chart' && byTime.rows).toMatchObject({
      bucket: { col: 'submitted_at', unit: 'week' },
      orderBy: [{ col: 'submitted_at', dir: 'asc' }],
      limit: 500,
    });
    expect(byTime.kind === 'chart' && byTime.rows.where).toHaveLength(2);
  });

  it('table passes select/orderBy/limit through; list ranks by the value alias', () => {
    const table = blockQueries(
      parseBlockSpec({
        v: 1,
        type: 'table',
        source: { dataset: 'crm.contacts', select: ['display_name', 'created_at'], limit: 20 },
      }),
      now,
    );
    expect(table).toEqual({
      kind: 'table',
      rows: { dataset: 'crm.contacts', select: ['display_name', 'created_at'], limit: 20 },
    });
    const list = blockQueries(
      parseBlockSpec({
        v: 1,
        type: 'list',
        source: {
          dataset: 'pos.ticket_lines',
          dimension: 'product_name',
          metric: { fn: 'sum', col: 'qty' },
        },
      }),
      now,
    );
    expect(list).toEqual({
      kind: 'list',
      rows: {
        dataset: 'pos.ticket_lines',
        groupBy: ['product_name'],
        aggregate: [{ fn: 'sum', col: 'qty', as: 'value' }],
        orderBy: [{ col: 'value', dir: 'desc' }],
        limit: 8,
      },
    });
  });
});

describe('blockQueries with page bindings (spec 150)', () => {
  const kpi = (
    extra: Record<string, unknown> = {},
    period: unknown = { col: 'submitted_at', range: 'this_year' },
  ) =>
    parseBlockSpec({
      v: 1,
      type: 'kpi',
      source: {
        dataset: 'pos.tickets',
        metric: { fn: 'sum', col: 'total' },
        period,
        filters: [{ col: 'status', op: 'eq', value: 'submitted' }],
      },
      ...extra,
    });
  const date = (range: string) => ({ kind: 'date' as const, range: range as never });
  const value = (spec: ReturnType<typeof kpi>, bindings: Binding[] = []) => {
    const q = blockQueries(spec, now, bindings);
    if (q.kind !== 'kpi') throw new Error('kpi');
    return q;
  };

  it('no bindings is exactly the unbound query', () => {
    const spec = kpi({ compare: true });
    expect(blockQueries(spec, now, [])).toEqual(blockQueries(spec, now));
  });

  it('AS1: a date binding on the block own column replaces its window (appended after own filters)', () => {
    const q = value(kpi(), [{ col: 'submitted_at', value: date('last_30d') }]);
    expect(q.value.where).toEqual([
      { col: 'status', op: 'eq', value: 'submitted' },
      { col: 'submitted_at', op: 'gte', value: iso(2026, 9, 9) },
      { col: 'submitted_at', op: 'lt', value: iso(2026, 10, 8) },
    ]);
  });

  it('AS2: an "all" binding on the same column removes the window and skips compare and trend', () => {
    const q = value(kpi({ compare: true, trend: 'day' }), [
      { col: 'submitted_at', value: date('all') },
    ]);
    expect(q.value.where).toEqual([{ col: 'status', op: 'eq', value: 'submitted' }]);
    expect(q.compare).toBeUndefined();
    expect(q.trend).toBeUndefined();
  });

  it('AS3: clearing the filter (no binding) brings the own range back', () => {
    const q = value(kpi());
    expect(q.value.where?.[1]).toEqual({ col: 'submitted_at', op: 'gte', value: iso(2026, 0, 1) });
  });

  it('AS4: a date binding on another column adds its window next to the own one', () => {
    const q = value(kpi(), [{ col: 'voided_at', value: date('today') }]);
    expect(q.value.where).toEqual([
      { col: 'status', op: 'eq', value: 'submitted' },
      { col: 'submitted_at', op: 'gte', value: iso(2026, 0, 1) },
      { col: 'submitted_at', op: 'lt', value: iso(2026, 10, 8) },
      { col: 'voided_at', op: 'gte', value: iso(2026, 10, 7) },
      { col: 'voided_at', op: 'lt', value: iso(2026, 10, 8) },
    ]);
  });

  it('compare uses the previous window of the filter range and keeps the other clauses; trend covers the filter range', () => {
    const q = value(kpi({ compare: true, trend: 'week' }), [
      { col: 'submitted_at', value: date('last_month') },
      { col: 'status', value: { kind: 'select', value: 'void' } },
    ]);
    expect(q.compare?.where).toEqual([
      { col: 'status', op: 'eq', value: 'submitted' },
      { col: 'submitted_at', op: 'gte', value: iso(2026, 8, 1) },
      { col: 'submitted_at', op: 'lt', value: iso(2026, 9, 1) },
      { col: 'status', op: 'eq', value: 'void' },
    ]);
    expect(q.trend?.where?.slice(1, 3)).toEqual([
      { col: 'submitted_at', op: 'gte', value: iso(2026, 9, 1) },
      { col: 'submitted_at', op: 'lt', value: iso(2026, 10, 1) },
    ]);
    expect(q.trend?.where?.at(-1)).toEqual({ col: 'status', op: 'eq', value: 'void' });
  });

  it('select adds eq, multi adds in, an empty multi adds nothing', () => {
    const spec = parseBlockSpec({
      v: 1,
      type: 'table',
      source: { dataset: 'pos.tickets' },
    });
    const rows = (b: Parameters<typeof blockQueries>[2]) => {
      const q = blockQueries(spec, now, b);
      if (q.kind === 'kpi') throw new Error('rows');
      return q.rows.where;
    };
    expect(rows([{ col: 'status', value: { kind: 'select', value: 'void' } }])).toEqual([
      { col: 'status', op: 'eq', value: 'void' },
    ]);
    expect(rows([{ col: 'status', value: { kind: 'multi', values: ['a', 'b'] } }])).toEqual([
      { col: 'status', op: 'in', value: ['a', 'b'] },
    ]);
    expect(rows([{ col: 'status', value: { kind: 'multi', values: [] } }])).toBeUndefined();
  });

  it('a date binding on a block without a period adds a window; charts and lists honour bindings', () => {
    const chart = parseBlockSpec({
      v: 1,
      type: 'chart',
      source: {
        dataset: 'pos.tickets',
        dimension: 'status',
        measures: [{ fn: 'count', col: '*' }],
      },
    });
    const q = blockQueries(chart, now, [{ col: 'submitted_at', value: date('today') }]);
    expect(q.kind === 'chart' && q.rows.where).toEqual([
      { col: 'submitted_at', op: 'gte', value: iso(2026, 10, 7) },
      { col: 'submitted_at', op: 'lt', value: iso(2026, 10, 8) },
    ]);
  });
});

describe('picker choices (spec 150 FR-002)', () => {
  it('asks for distinct values by count, one past the 200 shown', () => {
    expect(optionsQuery({ dataset: 'pos.tickets', col: 'status' })).toEqual({
      dataset: 'pos.tickets',
      groupBy: ['status'],
      aggregate: [{ fn: 'count', col: '*', as: 'n' }],
      orderBy: [{ col: 'n', dir: 'desc' }],
      limit: 201,
    });
  });

  it('drops the blank group and keeps at most 200', () => {
    const rows = [
      { status: null, n: 9 },
      { status: '', n: 8 },
      ...Array.from({ length: 205 }, (_, i) => ({ status: `s${i}`, n: 205 - i })),
    ];
    const out = pickerOptions(rows, 'status');
    expect(out).toHaveLength(200);
    expect(out[0]).toEqual({ value: 's0', count: 205 });
    expect(out.some((o) => o.value === null || o.value === '')).toBe(false);
  });
});
