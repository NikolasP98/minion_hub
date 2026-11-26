import { describe, expect, test } from 'vitest';
import { canvasSummary, describeElement, joinsGrid, layoutUpdates } from './canvas';

const el = (
  id: string,
  position: number,
  js = '',
  extra: Partial<{ w: number; h: number }> = {},
) => ({
  id,
  title: `T-${id}`,
  w: 2,
  h: 1,
  position,
  js,
  ...extra,
});

describe('describeElement', () => {
  test('a block is described from its spec, not from JS inference (spec 049)', () => {
    const spec = {
      v: 1 as const,
      type: 'chart' as const,
      preset: 'area' as const,
      format: 'money' as const,
      source: {
        dataset: 'pos.tickets',
        time: { col: 'submitted_at', bucket: 'week' as const },
        measures: [{ fn: 'sum' as const, col: 'total' }],
      },
    };
    const d = describeElement({ ...el('b', 0, "dataset: 'finance.invoices'"), spec });
    expect(d.datasets).toEqual(['pos.tickets']);
    expect(d.chart).toBe('chart:area');
    expect(canvasSummary([{ ...el('b', 0), spec }])).toContain('pos.tickets · chart:area');
  });

  test('finds the datasets and the chart type in the element JS', () => {
    const d = describeElement(
      el(
        'a',
        0,
        `minion.ready(async () => {
          const inv = await minion.query({ dataset: 'finance.invoices', limit: 500 });
          const bk = await minion.query({ dataset: "scheduling.bookings" });
          const again = await minion.query({ dataset: 'finance.invoices' });
          chart.setOption({ series: [{ type: 'bar', data: [] }, { type: 'line' }] });
        })`,
      ),
    );
    expect(d.datasets).toEqual(['finance.invoices', 'scheduling.bookings']);
    expect(d.chart).toBe('bar');
  });

  test('an element without a query reports none', () => {
    expect(describeElement(el('a', 0, '<p>hi</p>'))).toMatchObject({ datasets: [], chart: null });
  });
});

describe('canvasSummary', () => {
  test('lists elements in display order with id, size and data', () => {
    const s = canvasSummary([
      el('b', 1, "minion.query({ dataset: 'pos.tickets' })"),
      el('a', 0, '', { w: 1, h: 1 }),
    ]);
    expect(s.split('\n')).toEqual([
      'Canvas (4 columns, 2 elements, display order):',
      '1. [a] "T-a" 1x1 · no query',
      '2. [b] "T-b" 2x1 · pos.tickets',
    ]);
  });

  test('an empty board says so', () => {
    expect(canvasSummary([])).toBe('Canvas: empty (4 columns).');
  });
});

describe('layoutUpdates', () => {
  test('writes only the rows whose position or size changed', () => {
    const elements = [el('a', 0), el('b', 1), el('c', 2)];
    const updates = layoutUpdates(elements, {
      order: ['b', 'a', 'c'],
      span: { a: { w: 2, h: 1 }, b: { w: 4, h: 2 }, c: { w: 2, h: 1 } },
    });
    expect(updates).toEqual([
      { id: 'b', position: 0, w: 4, h: 2 },
      { id: 'a', position: 1 },
    ]);
  });

  test('ignores ids the board does not have', () => {
    expect(layoutUpdates([el('a', 0)], { order: ['ghost', 'a'], span: {} })).toEqual([
      { id: 'a', position: 1 },
    ]);
  });
});

describe('joinsGrid', () => {
  test('a filter never joins the grid order; blocks and custom elements do', () => {
    expect(joinsGrid({ spec: { v: 1, type: 'filter', var: 'p', control: 'date_range' } })).toBe(
      false,
    );
    expect(joinsGrid({ spec: null })).toBe(true);
    expect(joinsGrid({})).toBe(true);
  });
});

describe('canvasSummary on a synced page (spec 150 FR-010, SC-007)', () => {
  const filter = (id: string, position: number, spec: Record<string, unknown>) => ({
    ...el(id, position),
    spec: { v: 1 as const, type: 'filter' as const, ...spec } as never,
  });
  const kpi = (id: string, position: number, listens: Array<{ var: string; col: string }>) => ({
    ...el(id, position),
    spec: {
      v: 1 as const,
      type: 'kpi' as const,
      source: { dataset: 'pos.tickets', metric: { fn: 'count' as const, col: '*' } },
      format: 'number' as const,
      tone: 'accent' as const,
      listens,
    },
  });

  test('lists filters first, then each block with its connections and problems', () => {
    const elements = [
      filter('f1', 0, {
        var: 'period',
        control: 'date_range',
        default: { kind: 'date', range: 'last_30d' },
      }),
      filter('f2', 1, {
        var: 'status',
        control: 'select',
        options: { dataset: 'pos.tickets', col: 'status' },
      }),
      filter('f3', 2, { var: 'period', control: 'date_range' }),
      kpi('k1', 3, [{ var: 'period', col: 'submitted_at' }]),
      kpi('k2', 4, [
        { var: 'gone', col: 'status' },
        { var: 'status', col: 'submitted_at' },
      ]),
    ];
    const wiring = {
      publishers: [],
      duplicates: [{ var: 'period', elementIds: ['f1', 'f3'] }],
      blocks: {
        k1: { bindings: [{ var: 'period', col: 'submitted_at' }], problems: [] },
        k2: {
          bindings: [],
          problems: [
            { var: 'gone', code: 'no_publisher' as const, detail: 'no filter publishes "gone"' },
            {
              var: 'status',
              code: 'kind_mismatch' as const,
              detail: 'a select filter does not fit column "submitted_at"',
            },
          ],
        },
      },
    };
    expect(canvasSummary(elements, wiring)).toMatchInlineSnapshot(`
      "Filters (3, shown in the filter bar above the grid):
      - [f1] "T-f1" date_range · value name "period" · default last_30d
      - [f2] "T-f2" select · value name "status" · choices from pos.tickets.status · default none
      - [f3] "T-f3" date_range · value name "period" · default none
      Note: filters [f1], [f3] share the value name "period"; they set the same value.
      Canvas (4 columns, 2 elements, display order):
      1. [k1] "T-k1" 2x1 · pos.tickets · kpi · connected: period → submitted_at
      2. [k2] "T-k2" 2x1 · pos.tickets · kpi · connected: gone → status, status → submitted_at · PROBLEMS: gone (no_publisher: no filter publishes "gone"); status (kind_mismatch: a select filter does not fit column "submitted_at")"
    `);
  });

  test('a page of only filters still says the canvas is empty; no filters leaves the old text', () => {
    expect(canvasSummary([filter('f1', 0, { var: 'period', control: 'date_range' })])).toContain(
      'Canvas: empty (4 columns).',
    );
    expect(canvasSummary([el('a', 0)])).not.toContain('Filters');
  });
});
