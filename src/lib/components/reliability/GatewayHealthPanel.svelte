<script lang="ts">
	import { onMount } from 'svelte';
	import StatusDot from '$lib/components/decorations/StatusDot.svelte';
	import { Server } from 'lucide-svelte';
	import ChannelBrandIcon from '$lib/components/channels/ChannelBrandIcon.svelte';
	import * as m from '$lib/paraglide/messages';
	import Chart from '$lib/components/charts/Chart.svelte';
	import type { EChartsOption } from 'echarts';
	import PanelHeader from './PanelHeader.svelte';
	import { chartColors } from '$lib/utils/chart-colors';

	interface Props {
		serverId: string;
	}

	interface Heartbeat {
		id: number;
		serverId: string;
		uptimeMs: number;
		activeSessions: number;
		activeAgents: number;
		memoryRssMb: number | null;
		capturedAt: number;
		credentialSummaryJson: string | null;
		channelStatusJson: string | null;
	}

	interface ChannelAccountStatus {
		enabled?: boolean;
		configured?: boolean;
		running?: boolean;
		connected?: boolean;
		reconnectAttempts?: number;
	}

	interface ChannelStatusData {
		channelAccounts: {
			[channelId: string]: {
				[accountId: string]: ChannelAccountStatus;
			};
		};
	}

	let { serverId }: Props = $props();

	let heartbeats = $state<Heartbeat[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	let latest = $derived(heartbeats.length > 0 ? heartbeats[0] : null);

	/** Heartbeats in chronological order (oldest first) for charting. */
	let chronological = $derived([...heartbeats].reverse());

	let chartOptions: EChartsOption = $derived.by(() => {
		const c = chartColors();
		const timestamps = chronological.map((hb) => {
			const d = new Date(hb.capturedAt);
			return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
		});
		const memoryData = chronological.map((hb) => hb.memoryRssMb ?? null);
		const sessionsData = chronological.map((hb) => hb.activeSessions);
		const agentsData = chronological.map((hb) => hb.activeAgents);

		return {
			backgroundColor: 'transparent',
			tooltip: {
				trigger: 'axis',
			},
			legend: {
				top: 0,
				textStyle: { fontSize: 10 }
			},
			grid: { top: 30, right: 50, bottom: 24, left: 50 },
			xAxis: {
				type: 'category',
				data: timestamps,
				axisLabel: { fontSize: 10 },
				axisTick: { show: false },
				splitLine: { show: false }
			},
			yAxis: [
				{
					type: 'value',
					name: 'MB',
					nameTextStyle: { fontSize: 10 },
					axisLabel: { fontSize: 10 },
				},
				{
					type: 'value',
					name: 'Count',
					nameTextStyle: { fontSize: 10 },
					axisLabel: { fontSize: 10 },
					splitLine: { show: false }
				}
			],
			series: [
				{
					name: m.reliability_gatewayMemoryMb(),
					type: 'line',
					yAxisIndex: 0,
					data: memoryData,
					smooth: true,
					symbol: 'none',
					lineStyle: { color: c.info, width: 2 },
					itemStyle: { color: c.info },
					areaStyle: { color: c.info, opacity: 0.18 }
				},
				{
					name: m.reliability_gatewaySessions(),
					type: 'line',
					yAxisIndex: 1,
					data: sessionsData,
					smooth: true,
					symbol: 'none',
					lineStyle: { color: c.success, width: 2 },
					itemStyle: { color: c.success }
				},
				{
					name: m.reliability_gatewayAgents(),
					type: 'line',
					yAxisIndex: 1,
					data: agentsData,
					smooth: true,
					symbol: 'none',
					lineStyle: { color: c.warning, width: 2 },
					itemStyle: { color: c.warning }
				}
			]
		} satisfies EChartsOption;
	});

	/** Parse channel status from latest heartbeat, grouped by channel type then sorted by account. */
	let channelGroups = $derived.by((): { channel: string; accounts: { account: string; status: ChannelAccountStatus }[] }[] | null => {
		if (!latest?.channelStatusJson) return null;
		try {
			const data: ChannelStatusData = JSON.parse(latest.channelStatusJson);
			if (!data.channelAccounts) return null;
			const groupMap = new Map<string, { account: string; status: ChannelAccountStatus }[]>();
			for (const [channelId, accounts] of Object.entries(data.channelAccounts)) {
				const list: { account: string; status: ChannelAccountStatus }[] = [];
				for (const [accountId, status] of Object.entries(accounts)) {
					list.push({ account: accountId, status });
				}
				list.sort((a, b) => a.account.localeCompare(b.account));
				groupMap.set(channelId, list);
			}
			const groups = [...groupMap.entries()]
				.map(([channel, accounts]) => ({ channel, accounts }))
				.sort((a, b) => a.channel.localeCompare(b.channel));
			return groups.length > 0 ? groups : null;
		} catch {
			return null;
		}
	});

	function getChannelDotColor(s: ChannelAccountStatus): string {
		const c = chartColors();
		if (!s.enabled || !s.configured) return c.mutedForeground; // gray
		if (s.running && s.connected) return c.success; // green
		if (s.running && !s.connected) return c.warning; // yellow
		return c.destructive; // red
	}

	function getChannelDotLabel(s: ChannelAccountStatus): string {
		if (!s.enabled || !s.configured) return m.reliability_channelDisabled();
		if (s.running && s.connected) return m.reliability_channelConnected();
		if (s.running && !s.connected) return m.reliability_channelDisconnected();
		return m.reliability_channelStopped();
	}

	function formatUptime(ms: number): string {
		const totalSeconds = Math.floor(ms / 1000);
		const days = Math.floor(totalSeconds / 86400);
		const hours = Math.floor((totalSeconds % 86400) / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;
		if (days > 0) return `${days}d ${hours}h`;
		if (hours > 0) return `${hours}h ${minutes}m`;
		if (minutes > 0) return `${minutes}m`;
		return `${seconds}s`;
	}

	async function load() {
		loading = true;
		error = null;
		try {
			const res = await globalThis.fetch(
				`/api/metrics/gateway-heartbeats?serverId=${encodeURIComponent(serverId)}&limit=50`,
			);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			heartbeats = data.heartbeats ?? [];
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		load();
		const interval = setInterval(load, 60_000);
		return () => clearInterval(interval);
	});
</script>

<div class="surface-2 rounded-lg overflow-hidden grid grid-rows-subgrid row-span-4">
	<!-- Row 1: HEADER -->
	<PanelHeader label={m.reliability_gatewayTitle()} labelClass="flex-1">
		{#snippet icon()}
			<Server size={11} class="text-accent shrink-0" />
		{/snippet}
		{#snippet actions()}
			<StatusDot status={latest ? 'running' : 'idle'} size="sm" />
		{/snippet}
	</PanelHeader>

	{#if loading && !latest}
		<div></div>
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[length:var(--font-size-body)]">{m.common_loading()}</div>
		<div></div>
	{:else if error}
		<div></div>
		<div class="flex items-center justify-center py-12 px-4 text-destructive text-[length:var(--font-size-body)]">{error}</div>
		<div></div>
	{:else if !latest}
		<div></div>
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[length:var(--font-size-body)]">{m.reliability_noHeartbeat()}</div>
		<div></div>
	{:else}
		<!-- Row 2: STATS -->
		<div class="grid grid-cols-4 gap-px bg-border border-b border-border">
			<div class="flex flex-col items-center gap-1 py-3.5 px-2 bg-card">
				<span class="text-[length:var(--font-size-label)] text-muted-foreground uppercase tracking-wider font-medium">{m.reliability_uptime()}</span>
				<span class="text-lg font-bold text-success tabular-nums whitespace-nowrap">{formatUptime(latest.uptimeMs)}</span>
			</div>
			<div class="flex flex-col items-center gap-1 py-3.5 px-2 bg-card">
				<span class="text-[length:var(--font-size-label)] text-muted-foreground uppercase tracking-wider font-medium">{m.reliability_gatewaySessions()}</span>
				<span class="text-lg font-bold text-foreground tabular-nums whitespace-nowrap">{latest.activeSessions}</span>
			</div>
			<div class="flex flex-col items-center gap-1 py-3.5 px-2 bg-card">
				<span class="text-[length:var(--font-size-label)] text-muted-foreground uppercase tracking-wider font-medium">{m.reliability_gatewayAgents()}</span>
				<span class="text-lg font-bold text-foreground tabular-nums whitespace-nowrap">{latest.activeAgents}</span>
			</div>
			<div class="flex flex-col items-center gap-1 py-3.5 px-2 bg-card">
				<span class="text-[length:var(--font-size-label)] text-muted-foreground uppercase tracking-wider font-medium">{m.reliability_gatewayMemory()}</span>
				<span class="text-lg font-bold text-foreground tabular-nums whitespace-nowrap">
					{latest.memoryRssMb != null ? `${latest.memoryRssMb.toFixed(0)} MB` : '-'}
				</span>
			</div>
		</div>
		<!-- Row 3: MIDDLE -->
		<div>
			{#if chronological.length >= 2}
				<div class="px-4 pt-3 pb-1">
					<Chart options={chartOptions} height="200px" />
				</div>
			{/if}
		</div>
		<!-- Row 4: BOTTOM -->
		<div>
			{#if channelGroups}
				<div class="px-4 py-3 border-t border-border">
					<span class="text-[length:var(--font-size-telemetry)] font-semibold uppercase tracking-widest text-muted-foreground block mb-2">{m.reliability_channelStatus()}</span>
					<div class="flex flex-wrap gap-x-5 gap-y-3">
						{#each channelGroups as group (group.channel)}
							<div class="flex flex-col gap-0.5 min-w-[100px]">
								<div class="flex items-center gap-1.5 mb-0.5">
									<ChannelBrandIcon channel={group.channel} size={12} class="text-muted-strong" />
									<span class="text-[length:var(--font-size-telemetry)] font-semibold uppercase tracking-widest text-muted-strong">{group.channel}</span>
								</div>
								{#each group.accounts as { account, status: accStatus } (`${group.channel}:${account}`)}
									<div class="flex items-center gap-1.5 h-5 pl-0.5" title={getChannelDotLabel(accStatus)}>
										<span
											class="inline-block w-1.5 h-1.5 rounded-full shrink-0"
											style:background-color={getChannelDotColor(accStatus)}
										></span>
										<span class="text-[length:var(--font-size-label)] text-foreground/80">{account}</span>
									</div>
								{/each}
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>
