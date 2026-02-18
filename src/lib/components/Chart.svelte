<script lang="ts">
	import { onMount } from 'svelte';
	import type { EChartsOption, ECharts } from 'echarts';

	let {
		options,
		class: className = '',
		style = '',
		height = '300px'
	}: {
		options: EChartsOption;
		class?: string;
		style?: string;
		height?: string;
	} = $props();

	let container: HTMLDivElement;
	let chart: ECharts | undefined;
	let observer: ResizeObserver | undefined;

	const darkTheme = {
		color: ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#ec4899'],
		backgroundColor: 'transparent',
		textStyle: { color: '#e2e8f0' },
		title: {
			textStyle: { color: '#e2e8f0' },
			subtextStyle: { color: '#94a3b8' }
		},
		legend: {
			textStyle: { color: '#94a3b8' }
		},
		tooltip: {
			backgroundColor: '#151d2e',
			borderColor: '#2a3548',
			textStyle: { color: '#e2e8f0' }
		},
		categoryAxis: {
			axisLine: { lineStyle: { color: '#2a3548' } },
			axisTick: { lineStyle: { color: '#2a3548' } },
			axisLabel: { color: '#94a3b8' },
			splitLine: { lineStyle: { color: '#1e293b' } }
		},
		valueAxis: {
			axisLine: { lineStyle: { color: '#2a3548' } },
			axisTick: { lineStyle: { color: '#2a3548' } },
			axisLabel: { color: '#94a3b8' },
			splitLine: { lineStyle: { color: '#1e293b' } }
		},
		line: {
			symbolSize: 4,
			smooth: false
		},
		grid: {
			containLabel: true
		}
	};

	onMount(() => {
		let disposed = false;

		import('echarts').then((echarts) => {
			if (disposed) return;

			echarts.registerTheme('minion-dark', darkTheme);
			chart = echarts.init(container, 'minion-dark');
			chart.setOption(options);

			observer = new ResizeObserver(() => {
				chart?.resize();
			});
			observer.observe(container);
		});

		return () => {
			disposed = true;
			observer?.disconnect();
			chart?.dispose();
		};
	});

	$effect(() => {
		if (chart) {
			chart.setOption(options, { notMerge: true });
		}
	});
</script>

<div
	bind:this={container}
	class={className}
	style="width:100%;height:{height};{style}"
></div>
