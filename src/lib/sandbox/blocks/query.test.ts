import { describe, expect, it } from 'vitest';
import { blockQueries, periodWindow, previousWindow } from './query';
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
