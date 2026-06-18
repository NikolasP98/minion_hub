<script lang="ts">
	import { Gauge } from 'lucide-svelte';
	import * as m from '$lib/paraglide/messages';
	import Chart from '$lib/components/charts/Chart.svelte';
	import type { EChartsOption } from 'echarts';
	import PanelHeader from './PanelHeader.svelte';
	import type { PerfSeries } from '$lib/state/reliability';
	import { chartColors } from '$lib/utils/chart-colors';

	interface Props {
		perf: PerfSeries | null;
	}

	let { perf }: Props = $props();

	let latest = $derived(perf?.latest ?? null);
	let snapshots = $derived(perf?.snapshots ?? []);

	function fmtMs(v: number | undefined): string {
		if (v == null) return '-';
		return v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`;
	}

	let chartOptions: EChartsOption = $derived.by(() => {
		const c = chartColors();
		const times = snapshots.map((s) => {
			const d = new Date(s.ts);
			return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
		});
		const p95 = snapshots.map((s) => s.latencyMs?.p95 ?? 0);
		const p99 = snapshots.map((s) => s.latencyMs?.p99 ?? 0);
		const evloop = snapshots.map((s) => s.eventLoopDelayMs?.p99 ?? 0);

		return {
			backgroundColor: 'transparent',
			tooltip: { trigger: 'axis', valueFormatter: (v) => `${Math.round(Number(v))}ms` },
			legend: { top: 0, textStyle: { fontSize: 10 } },
			grid: { top: 30, right: 16, bottom: 24, left: 44 },
			xAxis: {
				type: 'category',
				data: times,
				axisLabel: { fontSize: 10 },
				axisTick: { show: false },
				splitLine: { show: false }
			},
			yAxis: {
				type: 'value',
				name: 'ms',
				nameTextStyle: { fontSize: 10 },
				axisLabel: { fontSize: 10 }
			},
			series: [
				{
					name: 'p95',
					type: 'line',
					data: p95,
					smooth: true,
					symbol: 'none',
					lineStyle: { color: c.warning, width: 2 },
					itemStyle: { color: c.warning }
				},
				{
					name: 'p99',
					type: 'line',
					data: p99,
					smooth: true,
					symbol: 'none',
					lineStyle: { color: c.destructive, width: 2 },
					itemStyle: { color: c.destructive }
				},
				{
					name: m.reliability_eventLoop(),
					type: 'line',
					data: evloop,
					smooth: true,
					symbol: 'none',
					lineStyle: { color: c.cyan, width: 2, type: 'dashed' },
					itemStyle: { color: c.cyan }
				}
			]
		} satisfies EChartsOption;
	});
</script>

<div class="surface-2 rounded-lg overflow-hidden">
	<PanelHeader label={m.reliability_latencyTitle()} labelClass="flex-1">
		{#snippet icon()}
			<Gauge size={11} class="text-accent shrink-0" />
		{/snippet}
	</PanelHeader>

	{#if !latest}
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px]">
			{m.reliability_noPerfData()}
		</div>
	{:else}
		<!-- KPI stats -->
		<div class="grid grid-cols-3 sm:grid-cols-6 gap-px bg-border border-b border-border">
			<div class="flex flex-col items-center gap-1 py-3.5 px-2 bg-card">
				<span class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">p50</span>
				<span class="text-lg font-bold text-foreground tabular-nums">{fmtMs(latest.latencyMs?.p50)}</span>
			</div>
			<div class="flex flex-col items-center gap-1 py-3.5 px-2 bg-card">
				<span class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">p95</span>
				<span class="text-lg font-bold text-warning tabular-nums">{fmtMs(latest.latencyMs?.p95)}</span>
			</div>
			<div class="flex flex-col items-center gap-1 py-3.5 px-2 bg-card">
				<span class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">p99</span>
				<span class="text-lg font-bold text-destructive tabular-nums">{fmtMs(latest.latencyMs?.p99)}</span>
			</div>
			<div class="flex flex-col items-center gap-1 py-3.5 px-2 bg-card">
				<span class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">{m.reliability_throughput()}</span>
				<span class="text-lg font-bold text-foreground tabular-nums">{latest.throughputPerSec?.toFixed(1) ?? '-'}/s</span>
			</div>
			<div class="flex flex-col items-center gap-1 py-3.5 px-2 bg-card">
				<span class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">{m.reliability_errorRate()}</span>
				<span class="text-lg font-bold tabular-nums" class:text-destructive={(latest.errorRate ?? 0) > 0.05} class:text-foreground={(latest.errorRate ?? 0) <= 0.05}>
					{((latest.errorRate ?? 0) * 100).toFixed(1)}%
				</span>
			</div>
			<div class="flex flex-col items-center gap-1 py-3.5 px-2 bg-card">
				<span class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">{m.reliability_eventLoop()}</span>
				<span class="text-lg font-bold text-foreground tabular-nums">{fmtMs(latest.eventLoopDelayMs?.p99)}</span>
			</div>
		</div>

		<!-- Trend chart -->
		{#if snapshots.length >= 2}
			<div class="px-4 pt-3 pb-1">
				<span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground block mb-1">
					{m.reliability_latencyTrend()}
				</span>
				<Chart options={chartOptions} height="200px" />
			</div>
		{/if}

		<!-- Slowest methods -->
		{#if latest.slowestMethods && latest.slowestMethods.length > 0}
			<div class="px-4 py-3 border-t border-border">
				<span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground block mb-2">
					{m.reliability_slowestMethods()}
				</span>
				<div class="flex flex-col gap-1">
					{#each latest.slowestMethods as mth (mth.method)}
						<div class="flex items-center gap-2 text-[12px]">
							<span class="font-mono text-foreground/80 flex-1 truncate">{mth.method}</span>
							<span class="text-muted-foreground tabular-nums w-16 text-right">{mth.count}×</span>
							<span class="text-warning tabular-nums w-16 text-right">{fmtMs(mth.p95)}</span>
							<span class="text-destructive tabular-nums w-16 text-right">{fmtMs(mth.max)}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	{/if}
</div>
