import { describe, expect, test } from 'vitest';
import { canvasSummary, describeElement, layoutUpdates } from './canvas';

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
