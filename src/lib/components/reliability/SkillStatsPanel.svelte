<script lang="ts">
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { createSkillStatsState, type SkillStatus } from '$lib/state/reliability/skill-stats.svelte';
	import { Zap } from 'lucide-svelte';
	import Chart from '$lib/components/Chart.svelte';
	import type { EChartsOption } from 'echarts';

	interface Props {
		serverId: string;
	}

	let { serverId }: Props = $props();

	const state = createSkillStatsState();
	let skills = $derived(state.aggregate());

	const STATUS_ORDER: SkillStatus[] = ['ok', 'error', 'auth_error', 'timeout'];

	const STATUS_COLORS: Record<SkillStatus, string> = {
		ok: '#22c55e',
		error: '#ef4444',
		auth_error: '#f59e0b',
		timeout: '#a855f7',
	};

	const STATUS_LABELS: Record<SkillStatus, string> = {
		ok: 'OK',
		error: 'Error',
		auth_error: 'Auth Error',
		timeout: 'Timeout',
	};

	function formatSkillName(name: string): string {
		if (name.startsWith('builtin:')) {
			return name.slice(8).replace(/_/g, ' ');
		}
		return name;
	}

	function formatDuration(ms: number | null): string {
		if (ms == null) return '-';
		if (ms < 1000) return `${Math.round(ms)}ms`;
		return `${(ms / 1000).toFixed(1)}s`;
	}

	let chartHeight = $derived(`${Math.max(200, skills.length * 32)}px`);

	let chartOptions: EChartsOption = $derived.by(() => {
		const skillNames = skills.map((s) => formatSkillName(s.skillName));

		const statusSeries = STATUS_ORDER.map((status) => ({
			name: STATUS_LABELS[status],
			type: 'bar' as const,
			stack: 'count',
			barMaxWidth: 20,
			itemStyle: { color: STATUS_COLORS[status] },
			data: skills.map((s) => s.byStatus[status] ?? 0),
		}));

		const durationSeries = {
			name: 'Avg Duration',
			type: 'line' as const,
			xAxisIndex: 1,
			lineStyle: { type: 'dashed' as const, color: '#06b6d4', width: 2 },
			itemStyle: { color: '#06b6d4' },
			symbol: 'circle' as const,
			symbolSize: 6,
			data: skills.map((s) => s.avgDurationMs ?? 0),
			tooltip: {
				valueFormatter: (value: unknown) => formatDuration(Number(value)),
			},
		};

		return {
			backgroundColor: 'transparent',
			tooltip: {
				trigger: 'axis',
				axisPointer: { type: 'shadow' },
			},
			legend: {
				top: 0,
				textStyle: { fontSize: 10 },
			},
			grid: { top: 30, right: 20, bottom: 10, left: 120 },
			xAxis: [
				{ type: 'value', name: 'Count' },
				{
					type: 'value',
					name: 'Avg Duration (ms)',
					position: 'top',
					axisLabel: { color: '#71717a', fontSize: 10 },
				},
			],
			yAxis: {
				type: 'category',
				data: skillNames,
				inverse: true,
				axisLabel: {
					color: '#71717a',
					fontSize: 10,
					width: 110,
					overflow: 'truncate',
				},
			},
			series: [...statusSeries, durationSeries],
		} satisfies EChartsOption;
	});

	onMount(() => {
		state.load(serverId);
		const interval = setInterval(() => state.load(serverId), 60_000);
		return () => clearInterval(interval);
	});
</script>

<div class="bg-card border border-border rounded-lg overflow-hidden">
	<div class="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg3/20">
		<Zap size={11} class="text-accent shrink-0" />
		<span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex-1">{m.reliability_skillTitle()}</span>
	</div>

	{#if state.loading && skills.length === 0}
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px]">{m.common_loading()}</div>
	{:else if state.error}
		<div class="flex items-center justify-center py-12 px-4 text-destructive text-[13px]">{state.error}</div>
	{:else if skills.length === 0}
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px]">{m.reliability_noSkills()}</div>
	{:else}
		<div class="px-4 py-3">
			<Chart options={chartOptions} height={chartHeight} />
		</div>
	{/if}
</div>
