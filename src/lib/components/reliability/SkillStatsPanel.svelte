<script lang="ts">
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { createSkillStatsState, type SkillStatus } from '$lib/state/reliability/skill-stats.svelte';
	import { Zap } from 'lucide-svelte';
	import Chart from '$lib/components/charts/Chart.svelte';
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

	/** Computed summary stats from skill aggregates. */
	let totalExecs = $derived(skills.reduce((sum, s) => sum + s.total, 0));
	let totalOk = $derived(skills.reduce((sum, s) => sum + (s.byStatus.ok ?? 0), 0));
	let successRate = $derived(totalExecs > 0 ? ((totalOk / totalExecs) * 100).toFixed(1) : '-');
	let avgDuration = $derived.by(() => {
		let weightedSum = 0;
		let weightedCount = 0;
		for (const s of skills) {
			if (s.avgDurationMs != null) {
				weightedSum += s.avgDurationMs * s.total;
				weightedCount += s.total;
			}
		}
		return weightedCount > 0 ? weightedSum / weightedCount : null;
	});
	let totalErrors = $derived(
		skills.reduce((sum, s) => sum + (s.byStatus.error ?? 0) + (s.byStatus.auth_error ?? 0) + (s.byStatus.timeout ?? 0), 0),
	);

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
			type: 'custom' as const,
			xAxisIndex: 1,
			z: 10,
			renderItem: (_params: any, api: any) => {
				const catIdx = api.value(0);
				const minVal = api.value(1);
				const avgVal = api.value(2);
				const maxVal = api.value(3);
				const yCenter = api.coord([0, catIdx])[1];
				const minX = api.coord([minVal, catIdx])[0];
				const avgX = api.coord([avgVal, catIdx])[0];
				const maxX = api.coord([maxVal, catIdx])[0];
				const children: any[] = [];
				if (maxVal > minVal) {
					children.push(
						{
							type: 'rect',
							shape: { x: minX, y: yCenter - 1.5, width: Math.max(maxX - minX, 1), height: 3 },
							style: { fill: 'rgba(255, 255, 255, 0.35)' },
						},
						{
							type: 'rect',
							shape: { x: minX - 1, y: yCenter - 5, width: 2, height: 10 },
							style: { fill: 'rgba(255, 255, 255, 0.5)' },
						},
						{
							type: 'rect',
							shape: { x: maxX - 1, y: yCenter - 5, width: 2, height: 10 },
							style: { fill: 'rgba(255, 255, 255, 0.5)' },
						},
					);
				}
				children.push({
					type: 'circle',
					shape: { cx: avgX, cy: yCenter, r: 5 },
					style: { fill: '#ffffff', stroke: '#0f172a', lineWidth: 2 },
				});
				return { type: 'group' as const, children };
			},
			encode: { x: [1, 2, 3], y: 0 },
			data: skills.map((s, i) => [
				i,
				(s.minDurationMs ?? 0) / 1000,
				(s.avgDurationMs ?? 0) / 1000,
				(s.maxDurationMs ?? 0) / 1000,
			]),
			tooltip: {
				formatter: (params: any) => {
					const [, min, avg, max] = params.value as number[];
					return `<div style="font-size:11px"><b>Duration</b><br/>Min: ${formatDuration(min * 1000)}<br/>Avg: ${formatDuration(avg * 1000)}<br/>Max: ${formatDuration(max * 1000)}</div>`;
				},
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
			grid: { top: 50, right: 10, bottom: 10, left: 10, containLabel: true },
			xAxis: [
				{ type: 'value', name: 'Count', nameGap: 6, nameTextStyle: { fontSize: 10 } },
				{
					type: 'value',
					name: 'Duration (s)',
					nameGap: 6,
					nameTextStyle: { fontSize: 10 },
					position: 'top',
					axisLabel: { fontSize: 10 },
				},
			],
			yAxis: {
				type: 'category',
				data: skillNames,
				inverse: true,
				axisLabel: {
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

<div class="bg-card border border-border rounded-lg overflow-hidden grid grid-rows-subgrid row-span-4">
	<!-- Row 1: HEADER -->
	<div class="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg3/20">
		<Zap size={11} class="text-accent shrink-0" />
		<span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex-1">{m.reliability_skillTitle()}</span>
	</div>

	{#if state.loading && skills.length === 0}
		<div></div>
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px]">{m.common_loading()}</div>
		<div></div>
	{:else if state.error}
		<div></div>
		<div class="flex items-center justify-center py-12 px-4 text-destructive text-[13px]">{state.error}</div>
		<div></div>
	{:else if skills.length === 0}
		<div></div>
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px]">{m.reliability_noSkills()}</div>
		<div></div>
	{:else}
		<!-- Row 2: STATS -->
		<div class="grid grid-cols-4 gap-px bg-border border-b border-border">
			<div class="flex flex-col items-center gap-1 py-3 px-2 bg-card">
				<span class="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Total</span>
				<span class="text-lg font-bold text-foreground tabular-nums whitespace-nowrap">{totalExecs}</span>
			</div>
			<div class="flex flex-col items-center gap-1 py-3 px-2 bg-card">
				<span class="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Success</span>
				<span class="text-lg font-bold text-success tabular-nums whitespace-nowrap">{successRate}%</span>
			</div>
			<div class="flex flex-col items-center gap-1 py-3 px-2 bg-card">
				<span class="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Errors</span>
				<span class="text-lg font-bold tabular-nums whitespace-nowrap" class:text-destructive={totalErrors > 0} class:text-muted-foreground={totalErrors === 0}>{totalErrors}</span>
			</div>
			<div class="flex flex-col items-center gap-1 py-3 px-2 bg-card">
				<span class="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Avg Time</span>
				<span class="text-lg font-bold text-foreground tabular-nums whitespace-nowrap">{formatDuration(avgDuration)}</span>
			</div>
		</div>
		<!-- Row 3: MIDDLE (chart) -->
		<div class="px-4 py-3 min-h-0">
			<Chart options={chartOptions} height={chartHeight} />
		</div>
		<!-- Row 4: BOTTOM (per skill) -->
		<div>
			{#if skills.length > 0}
				<div class="border-t border-border px-4 py-3">
					<div class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Per Skill</div>
					<div class="flex flex-col gap-1.5">
						{#each skills as skill (skill.skillName)}
							{@const okPct = skill.total > 0 ? ((skill.byStatus.ok ?? 0) / skill.total) * 100 : 0}
							<div class="flex items-center gap-2 text-[11px]">
								<span class="text-foreground/80 truncate flex-1 min-w-0" title={skill.skillName}>{formatSkillName(skill.skillName)}</span>
								<span class="text-muted-foreground tabular-nums shrink-0">{skill.total}×</span>
								<div class="w-16 h-1.5 rounded-full bg-border shrink-0 overflow-hidden">
									<div class="h-full rounded-full" style="width:{okPct}%;background:{okPct === 100 ? '#22c55e' : okPct >= 80 ? '#f59e0b' : '#ef4444'}"></div>
								</div>
								<span class="text-muted-foreground/60 tabular-nums shrink-0 w-12 text-right">{formatDuration(skill.avgDurationMs)}</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>
