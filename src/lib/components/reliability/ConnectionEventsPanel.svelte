<script lang="ts">
	import { onMount } from 'svelte';
	import { Activity, ChevronRight } from 'lucide-svelte';
	import Chart from '$lib/components/charts/Chart.svelte';
	import type { EChartsOption } from 'echarts';

	interface Props {
		serverId: string;
	}

	interface UnifiedEvent {
		id: number;
		serverId: string;
		localEventId: number;
		category: string;
		severity: string;
		event: string;
		message: string;
		agentId: string | null;
		correlationId: string | null;
		metadata: string | null;
		occurredAt: number;
		createdAt: number;
	}

	interface EventSummary {
		total: number;
		byCategory: Record<string, number>;
		bySeverity: Record<string, number>;
	}

	let { serverId }: Props = $props();

	let events = $state<UnifiedEvent[]>([]);
	let summary = $state<EventSummary | null>(null);
	let loading = $state(true);
	let fetchError = $state<string | null>(null);
	let selectedCategory = $state<string>('all');
	let expandedRows = $state(new Set<number>());

	const CATEGORIES = [
		'all',
		'gateway',
		'agent',
		'tool',
		'message',
		'channel',
		'orchestration',
		'skill',
		'crash',
		'connection',
		'auth',
		'cron',
	];

	const CATEGORY_COLORS: Record<string, string> = {
		gateway: '#3b82f6',
		agent: '#22c55e',
		tool: '#a855f7',
		message: '#06b6d4',
		channel: '#f59e0b',
		orchestration: '#ec4899',
		skill: '#8b5cf6',
		crash: '#ef4444',
		connection: '#14b8a6',
		auth: '#f97316',
		cron: '#64748b',
	};

	const SEVERITY_Y: Record<string, number> = {
		critical: 3,
		high: 2,
		medium: 1,
		low: 0,
		info: -1,
	};

	const SEVERITY_COLORS: Record<string, string> = {
		critical: '#ef4444',
		high: '#f97316',
		medium: '#eab308',
		low: '#3b82f6',
		info: '#6b7280',
	};

	const SEVERITY_BG: Record<string, string> = {
		critical: 'bg-red-500/20 text-red-400',
		high: 'bg-orange-500/20 text-orange-400',
		medium: 'bg-yellow-500/20 text-yellow-400',
		low: 'bg-blue-500/20 text-blue-400',
		info: 'bg-zinc-500/20 text-zinc-400',
	};

	const CATEGORY_BG: Record<string, string> = {
		gateway: 'bg-blue-500/20 text-blue-400',
		agent: 'bg-green-500/20 text-green-400',
		tool: 'bg-purple-500/20 text-purple-400',
		message: 'bg-cyan-500/20 text-cyan-400',
		channel: 'bg-amber-500/20 text-amber-400',
		orchestration: 'bg-pink-500/20 text-pink-400',
		skill: 'bg-violet-500/20 text-violet-400',
		crash: 'bg-red-500/20 text-red-400',
		connection: 'bg-teal-500/20 text-teal-400',
		auth: 'bg-orange-500/20 text-orange-400',
		cron: 'bg-slate-500/20 text-slate-400',
	};

	function relativeTime(ts: number): string {
		const diff = Date.now() - ts;
		if (diff < 0) return 'just now';
		const seconds = Math.floor(diff / 1000);
		if (seconds < 60) return `${seconds}s ago`;
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	function parseMetadata(raw: string | null): Record<string, unknown> | null {
		if (!raw) return null;
		try {
			return JSON.parse(raw);
		} catch {
			return null;
		}
	}

	function toggleRow(id: number) {
		const next = new Set(expandedRows);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		expandedRows = next;
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

		// Group events by category for separate colored series
		const categoryGroups = new Map<string, UnifiedEvent[]>();
		for (const ev of events) {
			const group = categoryGroups.get(ev.category) ?? [];
			group.push(ev);
			categoryGroups.set(ev.category, group);
		}

		const series = [...categoryGroups.entries()].map(([cat, evts]) => ({
			name: cat,
			type: 'scatter' as const,
			symbolSize: 10,
			data: evts.map((ev) => [ev.occurredAt, SEVERITY_Y[ev.severity] ?? 0]),
			itemStyle: { color: CATEGORY_COLORS[cat] ?? '#64748b' },
		}));

		return {
			backgroundColor: 'transparent',
			tooltip: {
				trigger: 'item',
				formatter: (params: any) => {
					const idx = params.dataIndex as number;
					const catName = params.seriesName as string;
					const group = categoryGroups.get(catName);
					if (!group) return '';
					const ev = group[idx];
					if (!ev) return '';
					const d = new Date(ev.occurredAt);
					const timeStr = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
					let html = `<div style="font-size:11px">`;
					html += `<div style="margin-bottom:4px;color:#a1a1aa">${timeStr}</div>`;
					html += `<div><strong>${ev.event}</strong></div>`;
					html += `<div style="color:#71717a">${ev.message}</div>`;
					html += `<div style="margin-top:2px;font-size:10px;color:#a1a1aa">${ev.category} / ${ev.severity}</div>`;
					html += `</div>`;
					return html;
				},
			},
			legend: {
				top: 0,
				right: 8,
				textStyle: { color: '#71717a', fontSize: 10 },
			},
			grid: { left: 60, right: 24, top: 28, bottom: 32 },
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
				min: -2,
				max: 4,
				axisLabel: {
					color: '#71717a',
					fontSize: 9,
					formatter: (value: number) => {
						const labels: Record<number, string> = {
							3: 'critical',
							2: 'high',
							1: 'medium',
							0: 'low',
							[-1]: 'info',
						};
						return labels[value] ?? '';
					},
				},
				axisLine: { show: false },
				axisTick: { show: false },
				splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
			},
			series,
		} satisfies EChartsOption;
	});

	async function load() {
		loading = true;
		fetchError = null;
		try {
			const params = new URLSearchParams({
				serverId,
				limit: '100',
				summary: '1',
			});
			if (selectedCategory !== 'all') {
				params.set('category', selectedCategory);
			}
			const res = await globalThis.fetch(`/api/metrics/connection-events?${params}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			events = data.events ?? [];
			summary = data.summary ?? null;
		} catch (e) {
			fetchError = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	function selectCategory(cat: string) {
		selectedCategory = cat;
		expandedRows = new Set();
		load();
	}

	onMount(() => {
		load();
		const interval = setInterval(load, 60_000);
		return () => clearInterval(interval);
	});
</script>

<div class="bg-card border border-border rounded-lg overflow-hidden">
	<!-- Header -->
	<div class="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg3/20">
		<Activity size={11} class="text-accent shrink-0" />
		<span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
			>Activity Log</span
		>
		{#if summary}
			<span class="ml-auto text-[10px] text-muted-foreground">{summary.total} events</span>
		{/if}
	</div>

	<!-- Category filter tabs -->
	<div
		class="flex items-center gap-1 px-3 py-2 border-b border-border overflow-x-auto scrollbar-hide"
	>
		{#each CATEGORIES as cat}
			{@const count =
				cat === 'all'
					? summary?.total ?? 0
					: summary?.byCategory?.[cat] ?? 0}
			<button
				class="shrink-0 px-2 py-0.5 rounded text-[10px] font-medium transition-colors
					{selectedCategory === cat
					? 'bg-accent/20 text-accent'
					: 'text-muted-foreground hover:text-foreground hover:bg-card'}"
				onclick={() => selectCategory(cat)}
			>
				{cat}
				{#if count > 0}
					<span
						class="ml-0.5 text-[9px] opacity-70"
						>({count})</span
					>
				{/if}
			</button>
		{/each}
	</div>

	{#if loading && events.length === 0}
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px]">
			Loading...
		</div>
	{:else if fetchError}
		<div class="flex items-center justify-center py-12 px-4 text-destructive text-[13px]">
			{fetchError}
		</div>
	{:else if events.length === 0}
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px]">
			No events recorded
		</div>
	{:else}
		<!-- Scatter chart -->
		<Chart options={chartOptions} height="180px" />

		<!-- Event list -->
		<div class="border-t border-border max-h-[400px] overflow-y-auto">
			{#each events as ev (ev.id)}
				{@const meta = parseMetadata(ev.metadata)}
				{@const isExpanded = expandedRows.has(ev.id)}
				<button
					class="w-full text-left border-b border-border/50 hover:bg-card/80 transition-colors"
					onclick={() => toggleRow(ev.id)}
				>
					<div class="flex items-center gap-2 px-3 py-1.5">
						<!-- Expand chevron -->
						<ChevronRight
							size={11}
							class="shrink-0 text-muted-foreground transition-transform {isExpanded
								? 'rotate-90'
								: ''}"
						/>

						<!-- Time -->
						<span class="shrink-0 text-[10px] text-muted-foreground w-14 text-right">
							{relativeTime(ev.occurredAt)}
						</span>

						<!-- Category badge -->
						<span
							class="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-medium {CATEGORY_BG[
								ev.category
							] ?? 'bg-zinc-500/20 text-zinc-400'}"
						>
							{ev.category}
						</span>

						<!-- Event name -->
						<span class="text-[11px] text-foreground font-medium truncate min-w-0">
							{ev.event}
						</span>

						<!-- Message (truncated) -->
						<span class="text-[11px] text-muted-foreground truncate min-w-0 flex-1">
							{ev.message}
						</span>

						<!-- Severity badge -->
						<span
							class="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-medium {SEVERITY_BG[
								ev.severity
							] ?? 'bg-zinc-500/20 text-zinc-400'}"
						>
							{ev.severity}
						</span>
					</div>

					<!-- Expanded detail -->
					{#if isExpanded}
						<div class="px-3 pb-2 pt-0 ml-6">
							<div class="bg-bg3/30 border border-border/50 rounded p-2 text-[10px]">
								<div class="grid grid-cols-2 gap-x-4 gap-y-1 mb-2">
									<div>
										<span class="text-muted-foreground">Event:</span>
										<span class="text-foreground ml-1">{ev.event}</span>
									</div>
									<div>
										<span class="text-muted-foreground">Category:</span>
										<span class="text-foreground ml-1">{ev.category}</span>
									</div>
									<div>
										<span class="text-muted-foreground">Severity:</span>
										<span class="text-foreground ml-1">{ev.severity}</span>
									</div>
									<div>
										<span class="text-muted-foreground">Time:</span>
										<span class="text-foreground ml-1"
											>{new Date(ev.occurredAt).toLocaleString()}</span
										>
									</div>
									{#if ev.agentId}
										<div>
											<span class="text-muted-foreground">Agent:</span>
											<span class="text-foreground ml-1">{ev.agentId}</span>
										</div>
									{/if}
									{#if ev.correlationId}
										<div>
											<span class="text-muted-foreground">Correlation:</span>
											<span class="text-foreground ml-1"
												>{ev.correlationId}</span
											>
										</div>
									{/if}
								</div>
								<div>
									<span class="text-muted-foreground">Message:</span>
									<span class="text-foreground ml-1">{ev.message}</span>
								</div>
								{#if meta}
									<div class="mt-2">
										<span class="text-muted-foreground">Metadata:</span>
										<pre
											class="mt-1 text-[9px] text-foreground/80 bg-bg3/50 rounded p-1.5 overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(meta, null, 2)}</pre>
									</div>
								{/if}
							</div>
						</div>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>
