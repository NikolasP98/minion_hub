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
	let chart: ECharts | undefined = $state();
	let resizeObs: ResizeObserver | undefined;

	function applyDefaults(opts: EChartsOption): EChartsOption {
		return {
			...opts,
			tooltip: {
				appendToBody: true,
				...(typeof opts.tooltip === 'object' && !Array.isArray(opts.tooltip) ? opts.tooltip : {}),
			},
		};
	}

	function getCSSVar(name: string, fallback: string): string {
		return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
	}

	function buildTheme() {
		const card = getCSSVar('--color-card', '#0c0c0e');
		const border = getCSSVar('--color-border', '#27272a');
		const fg = getCSSVar('--color-foreground', '#fafafa');
		const muted = getCSSVar('--color-muted', '#a1a1aa');
		const mutedFg = getCSSVar('--color-muted-foreground', '#71717a');
		const bg2 = getCSSVar('--color-bg2', '#18181b');

		return {
			color: ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#ec4899'],
			backgroundColor: 'transparent',
			textStyle: { color: fg },
			title: {
				textStyle: { color: fg },
				subtextStyle: { color: muted }
			},
			legend: {
				textStyle: { color: muted }
			},
			tooltip: {
				backgroundColor: card,
				borderColor: border,
				textStyle: { color: fg }
			},
			categoryAxis: {
				axisLine: { lineStyle: { color: border } },
				axisTick: { lineStyle: { color: border } },
				axisLabel: { color: mutedFg },
				splitLine: { lineStyle: { color: bg2 } }
			},
			valueAxis: {
				axisLine: { lineStyle: { color: border } },
				axisTick: { lineStyle: { color: border } },
				axisLabel: { color: mutedFg },
				splitLine: { lineStyle: { color: bg2 } }
			},
			line: {
				symbolSize: 4,
				smooth: false
			},
			grid: {
				containLabel: true
			}
		};
	}

	onMount(() => {
		let disposed = false;
		let echartsLib: typeof import('echarts') | undefined;
		let themeObserver: MutationObserver | undefined;

		import('echarts').then((echarts) => {
			if (disposed) return;
			echartsLib = echarts;

			echarts.registerTheme('minion-dark', buildTheme());
			chart = echarts.init(container, 'minion-dark');
			chart.setOption(applyDefaults(options));

			resizeObs = new ResizeObserver(() => {
				chart?.resize();
			});
			resizeObs.observe(container);

			// Re-register theme when CSS variables change (theme switch)
			themeObserver = new MutationObserver(() => {
				if (!echartsLib || !chart) return;
				echartsLib.registerTheme('minion-dark', buildTheme());
				// Re-init with updated theme
				const currentOpts = chart.getOption() as EChartsOption;
				chart.dispose();
				chart = echartsLib.init(container, 'minion-dark');
				chart.setOption(applyDefaults(currentOpts));
			});
			themeObserver.observe(document.documentElement, {
				attributes: true,
				attributeFilter: ['data-theme', 'style']
			});
		});

		return () => {
			disposed = true;
			themeObserver?.disconnect();
			resizeObs?.disconnect();
			chart?.dispose();
		};
	});

	$effect(() => {
		if (chart) {
			chart.setOption(applyDefaults(options), { notMerge: true });
		}
	});
</script>

<div
	bind:this={container}
	class={className}
	style="width:100%;height:{height};{style}"
></div>
