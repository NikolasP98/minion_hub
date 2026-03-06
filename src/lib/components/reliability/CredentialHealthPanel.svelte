<script lang="ts">
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { SvelteMap } from 'svelte/reactivity';
	import { KeyRound } from 'lucide-svelte';
	import Chart from '$lib/components/charts/Chart.svelte';
	import type { EChartsOption } from 'echarts';
	import {
		createCredentialHealthState,
		type CredentialProfile
	} from '$lib/state/reliability/credential-health.svelte';

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

	/** Group profiles by provider name. */
	let byProvider = $derived.by(() => {
		if (!parsed) return [] as Array<{ provider: string; profiles: CredentialProfile[] }>;
		const map = new SvelteMap<string, CredentialProfile[]>();
		for (const p of parsed.providers) {
			const list = map.get(p.provider);
			if (list) {
				list.push(p);
			} else {
				map.set(p.provider, [p]);
			}
		}
		return [...map.entries()].map(([provider, profiles]) => ({ provider, profiles }));
	});

	/** Profiles that have an expiresAt timestamp. */
	let expiringProfiles = $derived.by(() => {
		if (!parsed) return [];
		return parsed.providers.filter((p) => p.expiresAt != null);
	});

	/** Scatter chart options for credential expiration timeline. */
	let timelineOptions: EChartsOption = $derived.by(() => {
		const profiles = expiringProfiles;
		const categories = profiles.map((p) => `${p.provider}/${p.profileId}`);
		const data = profiles.map((p, i) => ({
			value: [p.expiresAt!, i],
			itemStyle: { color: statusEchartsColors[p.status] ?? '#64748b' }
		}));

		return {
			backgroundColor: 'transparent',
			tooltip: {
				trigger: 'item',
				formatter: (params: any) => {
					const d = new Date(params.value[0]);
					return `${categories[params.value[1]]}<br/>Expires: ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
				}
			},
			grid: {
				left: 10,
				right: 30,
				top: 10,
				bottom: 25,
				containLabel: true
			},
			xAxis: {
				type: 'time',
				axisLabel: { color: '#71717a', fontSize: 10 },
				splitLine: { show: false }
			},
			yAxis: {
				type: 'category',
				data: categories,
				axisLabel: { color: '#71717a', fontSize: 10 },
				splitLine: { show: false }
			},
			series: [
				{
					type: 'scatter',
					symbolSize: 10,
					data,
					markLine: {
						silent: true,
						symbol: 'none',
						lineStyle: { color: '#ef4444', type: 'dashed', width: 1 },
						data: [{ xAxis: Date.now() }],
						label: {
							formatter: 'Now',
							color: '#ef4444',
							fontSize: 10
						}
					}
				}
			]
		};
	});

	let capturedAgo = $derived.by(() => {
		if (!parsed) return '';
		const diff = Date.now() - parsed.capturedAt;
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
	});

	function statusColor(status: string): string {
		switch (status) {
			case 'ok':
				return 'var(--color-success)';
			case 'expiring':
				return 'var(--color-warning)';
			case 'expired':
				return 'var(--color-destructive)';
			case 'static':
			case 'missing':
			default:
				return 'var(--color-muted-foreground)';
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
		<KeyRound size={11} class="text-accent shrink-0" />
		<span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex-1">{m.reliability_credentialTitle()}</span>
		{#if capturedAgo}
			<span class="text-[10px] text-muted-foreground/60">{capturedAgo}</span>
		{/if}
	</div>

	{#if state.loading && !parsed}
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px]">{m.common_loading()}</div>
	{:else if state.error}
		<div class="flex items-center justify-center py-12 px-4 text-destructive text-[13px]">{state.error}</div>
	{:else if !parsed || parsed.providers.length === 0}
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px]">{m.reliability_noCredentials()}</div>
	{:else}
		<div class="flex gap-4 py-3 px-4">
			<!-- Donut chart (left) -->
			<div class="shrink-0" style="width:180px;height:180px;">
				<Chart options={donutOptions} height="180px" />
			</div>

			<!-- Provider details (right) -->
			<div class="flex-1 flex flex-col gap-3 min-w-0">
				{#each byProvider as group (group.provider)}
					<div class="flex flex-col gap-1.5">
						<div class="text-xs font-semibold text-muted uppercase tracking-wider">{group.provider}</div>
						<div class="flex flex-wrap gap-1.5">
							{#each group.profiles as profile (profile.profileId)}
								<div
									class="flex items-center gap-2 py-1.5 px-2.5 bg-bg3 border border-border border-l-[3px] rounded-md text-xs min-w-0"
									style:border-left-color={statusColor(profile.status)}
								>
									<span class="text-foreground max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap" title={profile.profileId}>
										{profile.profileId}
									</span>
									<span
										class="font-semibold text-[11px] whitespace-nowrap"
										style:color={statusColor(profile.status)}
									>
										{profile.status}
									</span>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		</div>

		<!-- Expiration timeline (conditional) -->
		{#if expiringProfiles.length > 0}
			<div class="px-4 pb-3 border-t border-border pt-3">
				<div class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Expiration Timeline</div>
				<Chart options={timelineOptions} height="150px" />
			</div>
		{/if}
	{/if}
</div>
