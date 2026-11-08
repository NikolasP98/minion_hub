/**
 * Chart preset → ECharts option (spec 049 D5). Pure: the query result, the
 * resolved theme colours and a formatter come in, an option goes out;
 * `Chart.svelte` applies the theme defaults, resize and the a11y table.
 * Colours are resolved strings because canvas renderers cannot read `var()`.
 */
import type { EChartsOption } from 'echarts';
import type { ChartColors } from '$lib/utils/chart-colors';
import { bucketLabel, toNumber } from './format';
import { measureAlias } from './query';
import type { ChartSpec } from './schema';

export interface ChartResult {
  columns: Array<{ name: string; type: string }>;
  rows: Record<string, unknown>[];
}

export function chartPalette(c: ChartColors): string[] {
  return [c.accent, c.info, c.success, c.warning, c.purple, c.pink, c.cyan, c.emerald];
}

function measureLabel(m: ChartSpec['source']['measures'][number]): string {
  return m.label ?? (m.fn === 'count' ? 'count' : `${m.fn} ${m.col}`);
}

export function chartOption(
  spec: ChartSpec,
  result: ChartResult,
  colors: ChartColors,
  axisFormat: (value: unknown) => string,
  valueFormat: (value: unknown) => string,
): EChartsOption {
  const { source, preset } = spec;
  const labelCol = source.time ? source.time.col : (source.dimension ?? '');
  const categories = result.rows.map((row) =>
    source.time ? bucketLabel(row[labelCol], source.time.bucket) : String(row[labelCol] ?? '—'),
  );
  const measures = source.measures.map((m, i) => ({
    name: measureLabel(m),
    data: result.rows.map((row) => toNumber(row[measureAlias(i)]) ?? 0),
  }));
  const horizontal = preset === 'horizontal-bar';
  const base: EChartsOption = {
    color: chartPalette(colors),
    grid: { left: 8, right: 12, top: measures.length > 1 ? 36 : 16, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis', valueFormatter: valueFormat },
    legend: measures.length > 1 ? { top: 0 } : undefined,
  };

  if (preset === 'pie' || preset === 'donut') {
    const first = measures[0];
    return {
      color: base.color,
      tooltip: { trigger: 'item', valueFormatter: valueFormat },
      legend: { bottom: 0, type: 'scroll' },
      series: [
        {
          type: 'pie',
          name: first.name,
          radius: preset === 'donut' ? ['52%', '78%'] : '78%',
          center: ['50%', '45%'],
          itemStyle: { borderColor: colors.border, borderWidth: 1 },
          label: { show: false },
          data: categories.map((name, i) => ({ name, value: first.data[i] })),
        },
      ],
    };
  }

  const categoryAxis = { type: 'category' as const, data: categories, axisTick: { show: false } };
  const valueAxis = { type: 'value' as const, axisLabel: { formatter: axisFormat } };
  const seriesType = preset === 'line' || preset === 'area' ? 'line' : 'bar';
  return {
    ...base,
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    series: measures.map((m) => ({
      type: seriesType,
      name: m.name,
      data: m.data,
      ...(preset === 'stacked-bar' ? { stack: 'total' } : {}),
      ...(preset === 'area' ? { areaStyle: { opacity: 0.18 }, smooth: true } : {}),
      ...(preset === 'line' ? { smooth: true } : {}),
      ...(seriesType === 'bar' ? { barMaxWidth: 36, itemStyle: { borderRadius: 3 } } : {}),
    })),
  };
}
