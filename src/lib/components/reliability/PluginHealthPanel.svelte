<script lang="ts">
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { Puzzle } from 'lucide-svelte';
	import Chart from '$lib/components/charts/Chart.svelte';
	import type { EChartsOption } from 'echarts';
	import {
		createPluginHealthState,
		type PluginEntry
	} from '$lib/state/reliability/plugin-health.svelte';

	interface Props {
		serverId: string;
	}

	let { serverId }: Props = $props();

	const state = createPluginHealthState();
	let snap = $derived(state.snapshot);

	const STATUS_COLORS: Record<string, string> = {
		loaded: '#22c55e',
		failed: '#ef4444'
	};

	let statusCounts = $derived.by(() => {
		if (!snap) return { loaded: 0, failed: 0 };
		const counts = { loaded: 0, failed: 0 };
		for (const p of snap.plugins) {
			if (p.status === 'loaded') counts.loaded++;
			else counts.failed++;
		}
		return counts;
	});

	let donutOptions: EChartsOption = $derived.by(() => {
		const data = Object.entries(statusCounts)
			.filter(([, count]) => count > 0)
			.map(([status, count]) => ({
				name: status,
				value: count,
				itemStyle: { color: STATUS_COLORS[status] ?? '#64748b' }
			}));

		const total = (statusCounts.loaded ?? 0) + (statusCounts.failed ?? 0);

		return {
			backgroundColor: 'transparent',
			tooltip: {
				trigger: 'item',
				formatter: '{b}: {c} ({d}%)'
			},
			series: [
				{
					type: 'pie',
					radius: ['50%', '75%'],
					avoidLabelOverlap: false,
					label: { show: false },
					emphasis: {
						label: {
							show: true,
							fontSize: 14,
							fontWeight: 'bold'
						}
					},
					labelLine: { show: false },
					data
				}
			],
			graphic: [
				{
					type: 'text',
					left: 'center',
					top: '44%',
					style: {
						text: String(total),
						fontSize: 18,
						fontWeight: 'bold',
						fill: '#a1a1aa',
						textAlign: 'center',
						textVerticalAlign: 'middle'
					}
				}
			]
		};
	});

	let capturedAgo = $derived.by(() => {
		if (!snap?.summary) return '';
		const diff = Date.now() - snap.summary.capturedAt;
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
	});

	function statusColor(status: string): string {
		switch (status) {
			case 'loaded':
				return 'var(--color-success)';
			case 'failed':
				return 'var(--color-destructive)';
			default:
				return 'var(--color-muted-foreground)';
		}
	}

	function originBadgeClass(origin?: string): string {
		switch (origin) {
			case 'bundled':
				return 'bg-accent/10 text-accent';
			case 'workspace':
				return 'bg-purple-500/10 text-purple-400';
			default:
				return 'bg-bg3 text-muted-foreground';
		}
	}

	onMount(() => {
		state.load(serverId);
		const interval = setInterval(() => state.load(serverId), 60_000);
		return () => clearInterval(interval);
	});
</script>

<div class="bg-card border border-border rounded-lg overflow-hidden">
	<div class="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg3/20">
		<Puzzle size={11} class="text-accent shrink-0" />
		<span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex-1"
			>{m.reliability_pluginTitle()}</span
		>
		{#if snap?.summary?.loadTimeMs != null}
			<span class="text-[10px] text-muted-foreground/60">{snap.summary.loadTimeMs}ms</span>
		{/if}
		{#if capturedAgo}
			<span class="text-[10px] text-muted-foreground/60">{capturedAgo}</span>
		{/if}
	</div>

	{#if state.loading && !snap}
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px]">
			{m.common_loading()}
		</div>
	{:else if state.error}
		<div class="flex items-center justify-center py-12 px-4 text-destructive text-[13px]">
			{state.error}
		</div>
	{:else if !snap || snap.plugins.length === 0}
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px]">
			{m.reliability_noPlugins()}
		</div>
	{:else}
		<div class="flex gap-4 py-3 px-4">
			<!-- Donut chart (left) -->
			<div class="shrink-0" style="width:160px;height:160px;">
				<Chart options={donutOptions} height="160px" />
			</div>

			<!-- Plugin cards (right) -->
			<div class="flex-1 flex flex-col gap-1.5 min-w-0 overflow-y-auto max-h-[200px]">
				{#each snap.plugins as plugin (plugin.pluginId)}
					<div
						class="flex items-center gap-2 py-1.5 px-2.5 bg-bg3 border border-border border-l-[3px] rounded-md text-xs min-w-0"
						style:border-left-color={statusColor(plugin.status)}
					>
						<!-- Plugin ID -->
						<span
							class="text-foreground font-medium max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap"
							title={plugin.pluginId}
						>
							{plugin.pluginId}
						</span>

						<!-- Origin badge -->
						{#if plugin.origin}
							<span
								class="text-[10px] px-1.5 py-0.5 rounded-sm font-medium whitespace-nowrap {originBadgeClass(plugin.origin)}"
							>
								{plugin.origin}
							</span>
						{/if}

						<!-- Spacer -->
						<span class="flex-1"></span>

						<!-- Status / Error -->
						{#if plugin.status === 'failed' && plugin.error}
							<span
								class="text-[11px] text-destructive max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap"
								title={plugin.error}
							>
								{plugin.error}
							</span>
						{:else if plugin.status === 'loaded'}
							{#if plugin.tools != null}
								<span class="text-[10px] text-muted-foreground whitespace-nowrap"
									>{plugin.tools} tools</span
								>
							{/if}
							{#if plugin.channels && plugin.channels.length > 0}
								<span class="text-[10px] text-muted-foreground whitespace-nowrap"
									>{plugin.channels.join(', ')}</span
								>
							{/if}
						{/if}
					</div>
				{/each}
			</div>
		</div>

		<!-- Summary bar -->
		{#if snap.summary}
			<div
				class="flex items-center gap-3 px-4 py-2 border-t border-border text-[10px] text-muted-foreground"
			>
				<span
					>{snap.summary.loaded}/{snap.summary.total} loaded</span
				>
				{#if snap.summary.failed > 0}
					<span class="text-destructive font-semibold"
						>{snap.summary.failed} failed</span
					>
				{/if}
			</div>
		{/if}
	{/if}
</div>
