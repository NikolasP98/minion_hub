<script lang="ts">
  import type { EChartsOption } from 'echarts';
  import Chart from '$lib/components/charts/Chart.svelte';
  import { chartColors } from '$lib/utils/chart-colors';
  import * as m from '$lib/paraglide/messages';

  let {
    points,
    current,
  }: {
    points: { day: string; avg: number; n: number }[];
    current: { avg: number; n: number } | null;
  } = $props();

  const fmtScore = (v: number) => (v > 0 ? '+' : '') + v.toFixed(2);
  const fmtDay = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });

  const byDay = $derived(new Map(points.map((p) => [p.day, p])));
  const c = $derived(chartColors());

  const option = $derived<EChartsOption>({
    grid: { left: 6, right: 14, top: 14, bottom: 22, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: c.accent } },
      formatter: (raw: unknown) => {
        const arr = Array.isArray(raw) ? raw : [raw];
        const p = arr[0] as { axisValue?: string; data?: number };
        const day = String(p?.axisValue ?? '');
        const rec = byDay.get(day);
        const score = typeof p?.data === 'number' ? p.data : 0;
        const color = score >= 0 ? 'var(--color-success)' : 'var(--color-destructive)';
        return `<div style="font-weight:600">${fmtDay(day)}</div>
          <div style="color:${color};font-weight:700;font-variant-numeric:tabular-nums">${fmtScore(score)}</div>
          <div style="opacity:0.7;font-size: var(--font-size-body){m.crm_insights_sentiment_n({ count: rec?.n ?? 0 })}</div>`;
      },
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: points.map((p) => p.day),
      axisLabel: { formatter: (v: string) => fmtDay(v), hideOverlap: true },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      min: -1,
      max: 1,
      interval: 0.5,
      axisLabel: { formatter: (v: number) => fmtScore(v) },
    },
    series: [
      {
        type: 'line',
        smooth: true,
        showSymbol: points.length <= 60,
        symbolSize: 5,
        data: points.map((p) => p.avg),
        lineStyle: { width: 2, color: c.accent },
        itemStyle: { color: c.accent },
        areaStyle: { color: c.accent, opacity: 0.14 },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: c.border, type: 'dashed' },
          label: { show: false },
          data: [{ yAxis: 0 }],
        },
      },
    ],
  });
</script>

<header class="trend-head">
  {#if current}
    <span
      class="trend-cur"
      style:color={current.avg >= 0 ? 'var(--color-success)' : 'var(--color-destructive)'}
    >
      {fmtScore(current.avg)}
    </span>
    <span class="t-caption">{m.crm_insights_sentiment_n({ count: current.n })}</span>
  {:else}
    <span class="t-caption">{m.crm_insights_sentiment_none()}</span>
  {/if}
</header>

{#if points.length > 0}
  <Chart options={option} height="220px" />
{/if}
