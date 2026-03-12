<script lang="ts">
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { KeyRound } from 'lucide-svelte';
	import Chart from '$lib/components/charts/Chart.svelte';
	import type { EChartsOption } from 'echarts';
	import { createCredentialHealthState } from '$lib/state/reliability/credential-health.svelte';

	interface Props {
		serverId: string;
	}

	let { serverId }: Props = $props();

	const state = createCredentialHealthState();
	let parsed = $derived(state.parseLatest());

	const statusEchartsColors: Record<string, string> = {
		ok: '#22c55e',
		expiring: '#f59e0b',
		expired: '#ef4444',
		static: '#64748b',
		missing: '#a855f7'
	};

	/** Group profiles by status for the summary row. */
	let statusCounts = $derived.by(() => {
		if (!parsed) return { ok: 0, expiring: 0, expired: 0, static: 0, missing: 0 };
		const counts: Record<string, number> = { ok: 0, expiring: 0, expired: 0, static: 0, missing: 0 };
		for (const p of parsed.providers) {
			counts[p.status] = (counts[p.status] ?? 0) + 1;
		}
		return counts;
	});

	/** Donut chart options derived from statusCounts. */
	let donutOptions: EChartsOption = $derived.by(() => {
		const data = Object.entries(statusCounts)
			.filter(([, count]) => count > 0)
			.map(([status, count]) => ({
				name: status,
				value: count,
				itemStyle: { color: statusEchartsColors[status] ?? '#64748b' }
			}));

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
			]
		};
	});

	/** Profiles that have an expiresAt timestamp (includes expired). */
	let timelineProfiles = $derived.by(() => {
		if (!parsed) return [];
		return parsed.providers.filter((p) => p.expiresAt != null);
	});

	function formatExpiry(expiresAt: number): string {
		const diff = expiresAt - Date.now();
		if (diff < 0) {
			const ago = Math.abs(diff);
			if (ago < 3_600_000) return `expired ${Math.floor(ago / 60_000)}m ago`;
			if (ago < 86_400_000) return `expired ${Math.floor(ago / 3_600_000)}h ago`;
			return `expired ${Math.floor(ago / 86_400_000)}d ago`;
		}
		if (diff < 3_600_000) return `in ${Math.floor(diff / 60_000)}m`;
		if (diff < 86_400_000) return `in ${Math.floor(diff / 3_600_000)}h`;
		return `in ${Math.floor(diff / 86_400_000)}d`;
	}

	function expiryBarPercent(expiresAt: number): number {
		const diff = expiresAt - Date.now();
		const windowMs = 30 * 86_400_000;
		return Math.max(0, Math.min(100, (diff / windowMs) * 100));
	}

	onMount(() => {
		state.load(serverId);
		const interval = setInterval(() => state.load(serverId), 60_000);
		return () => clearInterval(interval);
	});
</script>

<div class="bg-card border border-border rounded-lg overflow-hidden grid grid-rows-subgrid row-span-4">
	<!-- Row 1: HEADER -->
	<div class="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg3/20">
		<KeyRound size={11} class="text-accent shrink-0" />
		<span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex-1">{m.reliability_credentialTitle()}</span>
		{#if parsed}
			<span class="text-[10px] text-muted-foreground/60">{parsed.providers.length} credential{parsed.providers.length !== 1 ? 's' : ''}</span>
		{/if}
	</div>

	{#if state.loading && !parsed}
		<div></div>
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px]">{m.common_loading()}</div>
		<div></div>
	{:else if state.error}
		<div></div>
		<div class="flex items-center justify-center py-12 px-4 text-destructive text-[13px]">{state.error}</div>
		<div></div>
	{:else if !parsed || parsed.providers.length === 0}
		<div></div>
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px]">{m.reliability_noCredentials()}</div>
		<div></div>
	{:else}
		<!-- Row 2: STATS -->
		<div class="grid grid-cols-4 gap-px bg-border border-b border-border">
			<div class="flex flex-col items-center gap-1 py-3 px-2 bg-card">
				<span class="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">OK</span>
				<span class="text-lg font-bold text-success tabular-nums whitespace-nowrap">{statusCounts.ok}</span>
			</div>
			<div class="flex flex-col items-center gap-1 py-3 px-2 bg-card">
				<span class="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Expiring</span>
				<span class="text-lg font-bold tabular-nums whitespace-nowrap" class:text-warning={statusCounts.expiring > 0} class:text-muted-foreground={statusCounts.expiring === 0}>{statusCounts.expiring}</span>
			</div>
			<div class="flex flex-col items-center gap-1 py-3 px-2 bg-card">
				<span class="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Expired</span>
				<span class="text-lg font-bold tabular-nums whitespace-nowrap" class:text-destructive={statusCounts.expired > 0} class:text-muted-foreground={statusCounts.expired === 0}>{statusCounts.expired}</span>
			</div>
			<div class="flex flex-col items-center gap-1 py-3 px-2 bg-card">
				<span class="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Static</span>
				<span class="text-lg font-bold text-muted-foreground tabular-nums whitespace-nowrap">{statusCounts.static}</span>
			</div>
		</div>
		<!-- Row 3: MIDDLE (donut chart) -->
		<div class="flex justify-center py-3">
			<div style="width:180px;height:180px;">
				<Chart options={donutOptions} height="180px" />
			</div>
		</div>
		<!-- Row 4: BOTTOM (expiration timeline) -->
		<div>
			{#if timelineProfiles.length > 0}
				<div class="px-4 py-3 border-t border-border">
					<div class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Expiration Timeline</div>
					<div class="flex flex-col gap-2">
						{#each timelineProfiles as profile (profile.profileId)}
							{@const pct = expiryBarPercent(profile.expiresAt!)}
							{@const expired = profile.expiresAt! < Date.now()}
							<div class="flex items-center gap-2 text-[11px]">
								<span class="text-foreground/80 truncate min-w-0 w-36 shrink-0" title="{profile.provider}/{profile.profileId}">
									{profile.provider}/{profile.profileId}
								</span>
								<div class="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
									<div
										class="h-full rounded-full transition-all"
										style="width:{pct}%;background:{expired ? '#ef4444' : pct < 20 ? '#f59e0b' : '#22c55e'}"
									></div>
								</div>
								<span
									class="tabular-nums shrink-0 w-24 text-right font-medium"
									style:color={expired ? '#ef4444' : pct < 20 ? '#f59e0b' : '#22c55e'}
								>
									{formatExpiry(profile.expiresAt!)}
								</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>
