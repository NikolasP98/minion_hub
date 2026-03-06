<script lang="ts">
	import { onMount } from 'svelte';
	import { Plug } from 'lucide-svelte';
	import Chart from '$lib/components/charts/Chart.svelte';
	import type { EChartsOption } from 'echarts';

	interface Props {
		serverId: string;
	}

	interface ConnectionEvent {
		id: number;
		serverId: string;
		eventType: string;
		hostName: string | null;
		hostUrl: string | null;
		durationMs: number | null;
		reason: string | null;
		occurredAt: number;
	}

	let { serverId }: Props = $props();

	let events = $state<ConnectionEvent[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	const EVENT_COLORS: Record<string, string> = {
		connect: '#22c55e',
		disconnect: '#ef4444',
	};
	const DEFAULT_COLOR = '#64748b';

	function formatDuration(ms: number): string {
		const totalSeconds = Math.floor(ms / 1000);
		const days = Math.floor(totalSeconds / 86400);
		const hours = Math.floor((totalSeconds % 86400) / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;
		if (days > 0) return `${days}d ${hours}h`;
		if (hours > 0) return `${hours}h ${minutes}m`;
		if (minutes > 0) return `${minutes}m ${seconds}s`;
		return `${seconds}s`;
	}

	let chartOptions: EChartsOption = $derived.by(() => {
		if (events.length === 0) {
			return {
				backgroundColor: 'transparent',
				grid: { left: 48, right: 24, top: 16, bottom: 32 },
				xAxis: { type: 'time', data: [] },
				yAxis: { type: 'value', show: false },
				series: [],
			};
		}

		// Group events by type for separate series (so legend/colors work)
		const typeGroups = new Map<string, ConnectionEvent[]>();
		for (const ev of events) {
			const group = typeGroups.get(ev.eventType) ?? [];
			group.push(ev);
			typeGroups.set(ev.eventType, group);
		}

		const series = [...typeGroups.entries()].map(([type, evts]) => ({
			name: type,
			type: 'scatter' as const,
			symbolSize: 12,
			data: evts.map((ev) => [ev.occurredAt, 0]),
			itemStyle: { color: EVENT_COLORS[type] ?? DEFAULT_COLOR },
		}));

		return {
			backgroundColor: 'transparent',
			tooltip: {
				trigger: 'item',
				formatter: (params: any) => {
					const idx = params.dataIndex as number;
					const typeName = params.seriesName as string;
					const group = typeGroups.get(typeName);
					if (!group) return '';
					const ev = group[idx];
					if (!ev) return '';
					const d = new Date(ev.occurredAt);
					const timeStr = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
					let html = `<div style="font-size:11px">`;
					html += `<div style="margin-bottom:4px;color:#a1a1aa">${timeStr}</div>`;
					html += `<div><strong>${ev.eventType}</strong></div>`;
					if (ev.hostName) html += `<div>Host: ${ev.hostName}</div>`;
					if (ev.reason) html += `<div>Reason: ${ev.reason}</div>`;
					if (ev.durationMs != null) html += `<div>Duration: ${formatDuration(ev.durationMs)}</div>`;
					html += `</div>`;
					return html;
				},
			},
			legend: {
				top: 0,
				right: 8,
				textStyle: { color: '#71717a', fontSize: 10 },
			},
			grid: { left: 48, right: 24, top: 28, bottom: 32 },
			xAxis: {
				type: 'time',
				axisLabel: {
					color: '#71717a',
					fontSize: 10,
					formatter: (value: number) => {
						const d = new Date(value);
						return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
					},
				},
				axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
				axisTick: { show: false },
				splitLine: { show: false },
			},
			yAxis: {
				type: 'value',
				show: false,
				min: -1,
				max: 1,
			},
			series,
		} satisfies EChartsOption;
	});

	async function load() {
		loading = true;
		error = null;
		try {
			const res = await globalThis.fetch(
				`/api/metrics/connection-events?serverId=${encodeURIComponent(serverId)}&limit=50`,
			);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			events = data.events ?? [];
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
		<Plug size={11} class="text-accent shrink-0" />
		<span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Connection Events</span>
	</div>

	{#if loading && events.length === 0}
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px]">Loading...</div>
	{:else if error}
		<div class="flex items-center justify-center py-12 px-4 text-destructive text-[13px]">{error}</div>
	{:else if events.length === 0}
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px]">No connection events recorded</div>
	{:else}
		<Chart options={chartOptions} height="180px" />
	{/if}
</div>
