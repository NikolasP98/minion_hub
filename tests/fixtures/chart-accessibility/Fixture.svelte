<script lang="ts">
  import Chart from '$lib/components/charts/Chart.svelte';
  import type { EChartsOption } from 'echarts';
  let updated = $state(false);
  const wide: EChartsOption = {
    xAxis: {
      type: 'category',
      data: ['CategoryWithAnIntentionallyLongUnbrokenLabelForMobileScrolling'],
    },
    yAxis: { type: 'value' },
    series: Array.from({ length: 8 }, (_, index) => ({
      type: 'bar' as const,
      name: `Long series heading ${index + 1}`,
      data: [index + 1],
    })),
  };
  const formatted = $derived<EChartsOption>({
    xAxis: {
      type: 'category',
      data: [{ value: updated ? 'B' : 'A' }],
      axisLabel: { formatter: 'Day {value}' },
    },
    yAxis: [
      { type: 'value' },
      { type: 'value', axisLabel: { formatter: (v: number) => `USD ${v.toFixed(2)}` } },
    ],
    series: {
      name: 'Revenue',
      type: 'bar',
      yAxisIndex: 1,
      animation: true,
      data: [{ value: updated ? 7.5 : 2.5 }],
    },
  });
  import CrmSentimentTrend from '$lib/components/crm/CrmSentimentTrend.svelte';

  const points = [
    { day: '2026-08-01', avg: 0.42, n: 5 },
    { day: '2026-08-02', avg: -0.1, n: 3 },
    { day: '2026-08-03', avg: 0.68, n: 9 },
  ];
</script>

<main>
  <h1>Chart accessibility fixture</h1>
  <div id="chart-region">
    <CrmSentimentTrend {points} current={{ avg: 0.68, n: 9 }} granularity="day" />
  </div>
  <label><input type="checkbox" bind:checked={updated} />Update chart fixture</label>
  <div id="formatted-chart"><Chart options={formatted} ariaLabel="Revenue by day" /></div>
  <div id="wide-chart"><Chart options={wide} ariaLabel="Wide chart values" /></div>
</main>
