<script lang="ts">
	import { onMount } from 'svelte';
	import type { EChartsOption, ECharts } from 'echarts';

	let {
		options,
		class: className = '',
		style = '',
		height = '300px',
		onItemClick,
		onLegendToggle,
		notMergeUpdate = true
	}: {
		options: EChartsOption;
		class?: string;
		style?: string;
		height?: string;
		/** Optional ECharts click handler (receives the click params). */
		onItemClick?: (params: unknown) => void;
		/** Optional legend show/hide handler (ECharts `legendselectchanged`). */
		onLegendToggle?: (params: { name: string; selected: Record<string, boolean> }) => void;
		/** Default replaces the whole option on update (full re-render/intro anim).
		 *  Set false to MERGE updates so ECharts tweens changed values in place —
		 *  needed for stacked areas that toggle series (vertical morph, no L→R wipe).
		 *  Requires stable series names across renders or the changed series re-intros. */
		notMergeUpdate?: boolean;
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

		// Default ECharts auto-color palette, resolved from theme tokens so series
		// without an explicit color follow the active theme. Order matches the prior
		// hardcoded ramp: info, success, warning, destructive, purple, pink.
		const palette = [
			getCSSVar('--color-info', '#3b82f6'),
			getCSSVar('--color-success', '#22c55e'),
			getCSSVar('--color-warning', '#f59e0b'),
			getCSSVar('--color-destructive', '#ef4444'),
			getCSSVar('--color-purple', '#a855f7'),
			getCSSVar('--color-pink', '#ec4899'),
		];

		return {
			color: palette,
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
			if (onItemClick) chart.on('click', onItemClick);
			if (onLegendToggle) chart.on('legendselectchanged', onLegendToggle as (p: unknown) => void);

			// ECharts measures the container at init; inside a flex/grid that hasn't
			// laid out yet that can be ~0, leaving the chart rendered tiny. Re-measure
			// after the first frame so it fills its container.
			requestAnimationFrame(() => chart?.resize());

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
				if (onItemClick) chart.on('click', onItemClick);
				if (onLegendToggle) chart.on('legendselectchanged', onLegendToggle as (p: unknown) => void);
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
			chart.setOption(applyDefaults(options), { notMerge: notMergeUpdate });
		}
	});
</script>

<div
	bind:this={container}
	class={className}
	style="width:100%;height:{height};{style}"
></div>
