<script lang="ts">
  import { onMount } from 'svelte';
  import type { SparklineStyle } from '$lib/state/sparkline-style.svelte';

  let {
    bins,
    color,
    glow = false,
    chartStyle = 'area' as SparklineStyle,
  }: {
    bins: number[];
    color: string;
    glow?: boolean;
    chartStyle?: SparklineStyle;
  } = $props();

  let container: HTMLDivElement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chart: any;

  function buildOption(b: number[], c: string, g: boolean, s: SparklineStyle) {
    const shadowStyle = g ? { shadowBlur: 6, shadowColor: c } : {};
    let series: object;

    if (s === 'bar') {
      series = {
        type: 'bar',
        data: b,
        barMaxWidth: 4,
        barCategoryGap: '10%',
        itemStyle: { color: c, ...shadowStyle },
      };
    } else if (s === 'stepped') {
      series = {
        type: 'line',
        data: b,
        step: 'end',
        symbol: 'none',
        lineStyle: { color: c, width: 1.5, ...shadowStyle },
        itemStyle: { color: c },
        areaStyle: { opacity: 0 },
      };
    } else {
      // area (default)
      series = {
        type: 'line',
        data: b,
        smooth: 0.4,
        symbol: 'none',
        lineStyle: { color: c, width: 1.5, ...shadowStyle },
        itemStyle: { color: c },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: c + '55' },
              { offset: 1, color: c + '00' },
            ],
          },
        },
      };
    }

    return {
      animation: false,
      silent: true,
      grid: { top: 0, bottom: 0, left: 0, right: 0, containLabel: false },
      xAxis: { type: 'category', show: false, boundaryGap: s === 'bar' },
      yAxis: { type: 'value', show: false, min: 0 },
      series: [series],
    };
  }

  onMount(() => {
    let disposed = false;

    Promise.all([
      import('echarts/core'),
      import('echarts/charts'),
      import('echarts/components'),
      import('echarts/renderers'),
    ]).then(([echarts, { LineChart, BarChart }, { GridComponent }, { CanvasRenderer }]) => {
      if (disposed) return;
      echarts.use([LineChart, BarChart, GridComponent, CanvasRenderer]);
      chart = echarts.init(container, null, { renderer: 'canvas' });
      chart.setOption(buildOption(bins, color, glow, chartStyle));
    });

    return () => {
      disposed = true;
      chart?.dispose();
    };
  });

  $effect(() => {
    if (chart) {
      chart.setOption(buildOption(bins, color, glow, chartStyle), { notMerge: true });
    }
  });
</script>

<div bind:this={container} class="w-full h-[20px]"></div>
