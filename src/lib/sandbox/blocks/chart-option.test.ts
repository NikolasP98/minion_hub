import { describe, expect, it } from 'vitest';
import type { ChartColors } from '$lib/utils/chart-colors';
import { chartOption } from './chart-option';
import { bucketLabel, formatAxis, formatDelta, formatValue } from './format';
import { parseBlockSpec, type ChartSpec } from './schema';

const colors: ChartColors = {
  accent: '#a',
  info: '#i',
  success: '#s',
  warning: '#w',
  destructive: '#d',
  purple: '#p',
  pink: '#k',
  cyan: '#c',
  emerald: '#e',
  neutral: '#n',
  muted: '#m',
  mutedForeground: '#mf',
  foreground: '#f',
  border: '#b',
};
const axis = (v: unknown) => `A${v}`;
const value = (v: unknown) => `V${v}`;

function chart(extra: Partial<ChartSpec> & { source: ChartSpec['source'] }): ChartSpec {
  const spec = parseBlockSpec({ v: 1, type: 'chart', ...extra });
  if (spec.type !== 'chart') throw new Error('fixture');
  return spec;
}

const byProduct = chart({
  source: {
    dataset: 'pos.ticket_lines',
    dimension: 'product_name',
    measures: [
      { fn: 'sum', col: 'total', label: 'Revenue' },
      { fn: 'count', col: '*' },
    ],
  },
});
const rows = [
  { product_name: 'Botox', m0: '1200.5', m1: 3 },
  { product_name: 'Filler', m0: 800, m1: 2 },
];
const columns = [
  { name: 'product_name', type: 'text' },
  { name: 'm0', type: 'number' },
  { name: 'm1', type: 'number' },
];

describe('chartOption presets', () => {
  it('bar: categories on x, one bar series per measure, resolved palette, formatters wired', () => {
    const opt = chartOption(byProduct, { columns, rows }, colors, axis, value);
    expect(opt.color).toEqual(['#a', '#i', '#s', '#w', '#p', '#k', '#c', '#e']);
    expect(opt.xAxis).toMatchObject({ type: 'category', data: ['Botox', 'Filler'] });
    const yAxis = opt.yAxis as { type: string; axisLabel: { formatter: (v: unknown) => string } };
    expect(yAxis.type).toBe('value');
    expect(yAxis.axisLabel.formatter(5)).toBe('A5');
    expect(opt.series).toEqual([
      expect.objectContaining({ type: 'bar', name: 'Revenue', data: [1200.5, 800] }),
      expect.objectContaining({ type: 'bar', name: 'count', data: [3, 2] }),
    ]);
    expect(opt.legend).toBeDefined();
    expect((opt.tooltip as { valueFormatter: (v: unknown) => string }).valueFormatter(1)).toBe(
      'V1',
    );
  });

  it('horizontal-bar swaps the axes; stacked-bar stacks; area is a smooth line with fill', () => {
    const h = chartOption(
      { ...byProduct, preset: 'horizontal-bar' },
      { columns, rows },
      colors,
      axis,
      value,
    );
    expect(h.yAxis).toMatchObject({ type: 'category' });
    expect(h.xAxis).toMatchObject({ type: 'value' });
    const s = chartOption(
      { ...byProduct, preset: 'stacked-bar' },
      { columns, rows },
      colors,
      axis,
      value,
    );
    expect((s.series as Array<{ stack?: string }>)[0].stack).toBe('total');
    const a = chartOption({ ...byProduct, preset: 'area' }, { columns, rows }, colors, axis, value);
    expect(
      (a.series as Array<{ type: string; areaStyle?: unknown; smooth?: boolean }>)[0],
    ).toMatchObject({
      type: 'line',
      smooth: true,
    });
    expect((a.series as Array<{ areaStyle?: unknown }>)[0].areaStyle).toBeDefined();
  });

  it('donut uses the first measure only, as name/value pairs', () => {
    const d = chartOption(
      { ...byProduct, preset: 'donut' },
      { columns, rows },
      colors,
      axis,
      value,
    );
    const series = (d.series as Array<Record<string, unknown>>)[0];
    expect(series.type).toBe('pie');
    expect(series.radius).toEqual(['52%', '78%']);
    expect(series.data).toEqual([
      { name: 'Botox', value: 1200.5 },
      { name: 'Filler', value: 800 },
    ]);
    expect(d.xAxis).toBeUndefined();
  });

  it('time charts label buckets by unit', () => {
    const t = chart({
      preset: 'line',
      source: {
        dataset: 'pos.tickets',
        time: { col: 'submitted_at', bucket: 'month' },
        measures: [{ fn: 'sum', col: 'total' }],
      },
    });
    const opt = chartOption(
      t,
      {
        columns: [
          { name: 'submitted_at', type: 'timestamp' },
          { name: 'm0', type: 'number' },
        ],
        rows: [{ submitted_at: '2026-09-01T05:00:00.000Z', m0: 10 }],
      },
      colors,
      axis,
      value,
    );
    expect((opt.xAxis as { data: string[] }).data[0]).toBe(
      bucketLabel('2026-09-01T05:00:00.000Z', 'month'),
    );
    expect((opt.series as Array<{ name: string }>)[0].name).toBe('sum total');
  });
});

describe('format presets', () => {
  it('formats number, compact, money (with symbol) and percent ratios', () => {
    expect(formatValue('1234.5', 'number')).toMatch(/1[,.]234[.,]5/);
    expect(formatValue(1_250_000, 'compact')).toMatch(/1[.,]3\s?M/);
    expect(formatValue(1500, 'money')).toContain('S/');
    expect(formatValue(1500, 'money', 'USD')).toMatch(/\$|US/);
    expect(formatValue(0.1234, 'percent')).toMatch(/12[.,]3\s?%/);
    expect(formatValue(null, 'number')).toBe('—');
    expect(formatValue('abc', 'money')).toBe('—');
  });

  it('axis labels are compact; deltas are signed percents or null on a zero base', () => {
    expect(formatAxis(1_200_000, 'money')).toContain('S/');
    expect(formatAxis(3400, 'number')).toMatch(/3[.,]4\s?K/);
    expect(formatDelta(120, 100)).toMatch(/^\+20\s?%$/);
    expect(formatDelta(80, 100)).toMatch(/^-20\s?%$/);
    expect(formatDelta(100, 100)).toMatch(/^0\s?%$/);
    expect(formatDelta(5, 0)).toBeNull();
    expect(formatDelta(5, null)).toBeNull();
  });
});
