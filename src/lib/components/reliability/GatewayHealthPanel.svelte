<script lang="ts">
	import { onMount } from 'svelte';
	import StatusDot from '$lib/components/decorations/StatusDot.svelte';
	import { Server } from 'lucide-svelte';
	import * as m from '$lib/paraglide/messages';
	import Chart from '$lib/components/charts/Chart.svelte';
	import type { EChartsOption } from 'echarts';

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
				backgroundColor: '#151d2e',
				borderColor: '#2a3548',
				textStyle: { color: '#e2e8f0', fontSize: 12 }
			},
			legend: {
				top: 0,
				textStyle: { color: '#94a3b8', fontSize: 10 }
			},
			grid: { top: 30, right: 50, bottom: 24, left: 50 },
			xAxis: {
				type: 'category',
				data: timestamps,
				axisLabel: { color: '#71717a', fontSize: 10 },
				axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
				axisTick: { show: false },
				splitLine: { show: false }
			},
			yAxis: [
				{
					type: 'value',
					name: 'MB',
					nameTextStyle: { color: '#71717a', fontSize: 10 },
					axisLabel: { color: '#71717a', fontSize: 10 },
					splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } }
				},
				{
					type: 'value',
					name: 'Count',
					nameTextStyle: { color: '#71717a', fontSize: 10 },
					axisLabel: { color: '#71717a', fontSize: 10 },
					splitLine: { show: false }
				}
			],
			series: [
				{
					name: 'Memory (MB)',
					type: 'line',
					yAxisIndex: 0,
					data: memoryData,
					smooth: true,
					symbol: 'none',
					lineStyle: { color: '#3b82f6', width: 2 },
					itemStyle: { color: '#3b82f6' },
					areaStyle: {
						color: {
							type: 'linear',
							x: 0,
							y: 0,
							x2: 0,
							y2: 1,
							colorStops: [
								{ offset: 0, color: 'rgba(59,130,246,0.25)' },
								{ offset: 1, color: 'rgba(59,130,246,0.02)' }
							]
						}
					}
				},
				{
					name: 'Sessions',
					type: 'line',
					yAxisIndex: 1,
					data: sessionsData,
					smooth: true,
					symbol: 'none',
					lineStyle: { color: '#22c55e', width: 2 },
					itemStyle: { color: '#22c55e' }
				},
				{
					name: 'Agents',
					type: 'line',
					yAxisIndex: 1,
					data: agentsData,
					smooth: true,
					symbol: 'none',
					lineStyle: { color: '#f59e0b', width: 2 },
					itemStyle: { color: '#f59e0b' }
				}
			]
		} satisfies EChartsOption;
	});

	/** Parse channel status from latest heartbeat. */
	let channelStatus = $derived.by((): { channel: string; account: string; status: ChannelAccountStatus }[] | null => {
		if (!latest?.channelStatusJson) return null;
		try {
			const data: ChannelStatusData = JSON.parse(latest.channelStatusJson);
			if (!data.channelAccounts) return null;
			const entries: { channel: string; account: string; status: ChannelAccountStatus }[] = [];
			for (const [channelId, accounts] of Object.entries(data.channelAccounts)) {
				for (const [accountId, status] of Object.entries(accounts)) {
					entries.push({ channel: channelId, account: accountId, status });
				}
			}
			return entries.length > 0 ? entries : null;
		} catch {
			return null;
		}
	});

	function getChannelDotColor(s: ChannelAccountStatus): string {
		if (!s.enabled || !s.configured) return '#71717a'; // gray
		if (s.running && s.connected) return '#22c55e'; // green
		if (s.running && !s.connected) return '#f59e0b'; // yellow
		return '#ef4444'; // red
	}

	function getChannelDotLabel(s: ChannelAccountStatus): string {
		if (!s.enabled || !s.configured) return 'Disabled';
		if (s.running && s.connected) return 'Connected';
		if (s.running && !s.connected) return 'Disconnected';
		return 'Stopped';
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

	function formatAgo(ts: number): string {
		const diff = Date.now() - ts;
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
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

<div class="bg-card border border-border rounded-lg overflow-hidden">
	<div class="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg3/20">
		<Server size={11} class="text-accent shrink-0" />
		<span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex-1">{m.reliability_gatewayTitle()}</span>
		<StatusDot status={latest ? 'running' : 'idle'} size="sm" />
		{#if latest}
			<span class="text-[10px] text-muted-foreground/60 tabular-nums ml-1">{formatAgo(latest.capturedAt)}</span>
		{/if}
	</div>

	{#if loading && !latest}
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px]">{m.common_loading()}</div>
	{:else if error}
		<div class="flex items-center justify-center py-12 px-4 text-destructive text-[13px]">{error}</div>
	{:else if !latest}
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px]">{m.reliability_noHeartbeat()}</div>
	{:else}
		<div class="grid grid-cols-4 gap-px bg-border border-b border-border">
			<div class="flex flex-col items-center gap-1 py-3.5 px-2 bg-card">
				<span class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Uptime</span>
				<span class="text-lg font-bold text-success tabular-nums">{formatUptime(latest.uptimeMs)}</span>
			</div>
			<div class="flex flex-col items-center gap-1 py-3.5 px-2 bg-card">
				<span class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Sessions</span>
				<span class="text-lg font-bold text-foreground tabular-nums">{latest.activeSessions}</span>
			</div>
			<div class="flex flex-col items-center gap-1 py-3.5 px-2 bg-card">
				<span class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Agents</span>
				<span class="text-lg font-bold text-foreground tabular-nums">{latest.activeAgents}</span>
			</div>
			<div class="flex flex-col items-center gap-1 py-3.5 px-2 bg-card">
				<span class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Memory</span>
				<span class="text-lg font-bold text-foreground tabular-nums">
					{latest.memoryRssMb != null ? `${latest.memoryRssMb.toFixed(0)} MB` : '-'}
				</span>
			</div>
		</div>

		{#if chronological.length >= 2}
			<div class="px-4 pt-3 pb-1">
				<Chart options={chartOptions} height="200px" />
			</div>
		{/if}

		{#if channelStatus}
			<div class="px-4 py-3 border-t border-border">
				<span class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium block mb-2">Channel Status</span>
				<div class="flex flex-wrap gap-3">
					{#each channelStatus as { channel, account, status } (`${channel}:${account}`)}
						<div class="flex items-center gap-1.5" title={getChannelDotLabel(status)}>
							<span
								class="inline-block w-2 h-2 rounded-full shrink-0"
								style="background-color: {getChannelDotColor(status)}"
							></span>
							<span class="text-[11px] text-foreground/80">{channel}</span>
							<span class="text-[10px] text-muted-foreground/60">{account}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	{/if}
</div>
