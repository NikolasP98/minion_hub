<script lang="ts">
	import { onMount } from 'svelte';
	import type { ECharts } from 'echarts';

	let { bins, color = '#3b82f6' }: { bins: number[]; color?: string } = $props();

	let container: HTMLDivElement;
	let chart: ECharts | undefined;
	let resizeObserver: ResizeObserver | undefined;

	/**
	 * Convert a hex color string to an rgba string with the given alpha.
	 */
	function hexToRgba(hex: string, alpha: number): string {
		const cleaned = hex.replace('#', '');
		const r = parseInt(cleaned.substring(0, 2), 16);
		const g = parseInt(cleaned.substring(2, 4), 16);
		const b = parseInt(cleaned.substring(4, 6), 16);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}

	function buildOption(data: number[], barColor: string) {
		return {
			animation: false,
			backgroundColor: 'transparent',
			grid: {
				left: 0,
				right: 0,
				top: 0,
				bottom: 0
			},
			xAxis: {
				type: 'category' as const,
				show: false,
				data: data.map((_, i) => i)
			},
			yAxis: {
				type: 'value' as const,
				show: false,
				min: 0
			},
			tooltip: {
				show: false
			},
			series: [
				{
					type: 'bar' as const,
					data: data,
					barWidth: '90%',
					barCategoryGap: '10%',
					itemStyle: {
						color: hexToRgba(barColor, 0.6),
						borderRadius: [1, 1, 0, 0]
					},
					emphasis: {
						itemStyle: {
							color: hexToRgba(barColor, 1.0)
						}
					},
					silent: false
				}
			]
		};
	}

	onMount(() => {
		let destroyed = false;

		import('echarts').then((echarts) => {
			if (destroyed) return;

			chart = echarts.init(container, undefined, {
				renderer: 'canvas',
				width: container.clientWidth || undefined,
				height: 28
			});

			chart.setOption(buildOption(bins, color));

			resizeObserver = new ResizeObserver(() => {
				if (chart && !chart.isDisposed()) {
					chart.resize();
				}
			});
			resizeObserver.observe(container);
		});

		return () => {
			destroyed = true;
			resizeObserver?.disconnect();
			if (chart && !chart.isDisposed()) {
				chart.dispose();
			}
		};
	});

	$effect(() => {
		if (chart && !chart.isDisposed()) {
			chart.setOption(buildOption(bins, color));
		}
	});
</script>

<div bind:this={container} class="sparkline"></div>

<style>
	.sparkline {
		width: 100%;
		height: 28px;
	}
</style>
