<script lang="ts">
	import Chart from '$lib/components/Chart.svelte';
	import DateRangePicker from '$lib/components/reliability/DateRangePicker.svelte';
	import IncidentTable from '$lib/components/reliability/IncidentTable.svelte';
	import CredentialHealthPanel from '$lib/components/reliability/CredentialHealthPanel.svelte';
	import SkillStatsPanel from '$lib/components/reliability/SkillStatsPanel.svelte';
	import GatewayHealthPanel from '$lib/components/reliability/GatewayHealthPanel.svelte';
	import ScanLine from '$lib/components/decorations/ScanLine.svelte';
	import Topbar from '$lib/components/Topbar.svelte';
	import {
		reliability,
		loadReliabilitySummary,
		loadReliabilityEvents
	} from '$lib/state/reliability.svelte';
	import { hostsState } from '$lib/state/hosts.svelte';
	import { onMount, untrack } from 'svelte';
	import type { EChartsOption } from 'echarts';
	import * as m from '$lib/paraglide/messages';
	import {
		ShieldCheck,
		Activity,
		AlertCircle,
		Clock,
		Globe,
		KeyRound,
		Radio,
		TrendingUp,
		BarChart2,
		PieChart,
		RefreshCw,
		Server,
	} from 'lucide-svelte';

	const CATEGORY_COLORS: Record<string, string> = {
		cron:     '#3b82f6',
		browser:  '#f59e0b',
		timezone: '#a855f7',
		general:  '#64748b',
		auth:     '#22c55e',
		skill:    '#06b6d4',
		agent:    '#ec4899',
		gateway:  '#10b981'
	};

	const SEVERITY_COLORS: Record<string, string> = {
		critical: '#ef4444',
		high:     '#f59e0b',
		medium:   '#a855f7',
		low:      '#64748b'
	};

	const CATEGORIES = ['cron', 'browser', 'timezone', 'general', 'auth', 'skill', 'agent', 'gateway'] as const;

	let summary = $derived(reliability.summary);
	let loading = $derived(reliability.loading);
	let serverId = $derived(hostsState.activeHostId);

	// Overview stat cells
	const statItems = $derived([
		{ key: 'total',    Icon: Activity,      color: 'var(--color-accent)',       label: m.reliability_totalEvents(),    value: summary?.total ?? 0 },
		{ key: 'critical', Icon: AlertCircle,   color: 'var(--color-destructive)',  label: m.reliability_criticalEvents(), value: summary?.bySeverity?.critical ?? 0 },
		{ key: 'cron',     Icon: Clock,         color: 'var(--color-warning)',      label: m.reliability_cronIssues(),     value: summary?.byCategory?.cron ?? 0 },
		{ key: 'browser',  Icon: Globe,         color: 'var(--color-purple)',       label: m.reliability_browserIssues(), value: summary?.byCategory?.browser ?? 0 },
		{ key: 'auth',     Icon: KeyRound,      color: 'var(--color-success)',      label: m.reliability_authIssues(),     value: summary?.byCategory?.auth ?? 0 },
		{ key: 'gateway',  Icon: Radio,         color: 'var(--color-cyan)',         label: m.reliability_gatewayIssues(), value: summary?.byCategory?.gateway ?? 0 },
	]);

	async function loadData() {
		if (!serverId) return;
		const { from, to } = reliability.dateRange;
		await Promise.all([
			loadReliabilitySummary(serverId, from, to),
			loadReliabilityEvents(serverId, { from, to, limit: 200 })
		]);
	}

	function handleDateChange(from: number, to: number) {
		reliability.dateRange.from = from;
		reliability.dateRange.to = to;
	}

	onMount(() => {
		if (serverId) {
			loadData();
		}
	});

	$effect(() => {
		const _from = reliability.dateRange.from;
		const _to = reliability.dateRange.to;
		const _sid = serverId;
		if (_sid) {
			untrack(() => loadData());
		}
	});

	// ── Timeline chart ────────────────────────────────────────────────────────
	let timelineOptions: EChartsOption = $derived.by(() => {
		const ts = summary?.timeseries ?? [];
		if (ts.length === 0) {
			return {
				backgroundColor: 'transparent',
				grid: { left: 48, right: 24, top: 24, bottom: 32 },
				xAxis: { type: 'time', data: [] },
				yAxis: { type: 'value' },
				series: []
			};
		}

		const bucketSet = new Set<number>();
		for (const point of ts) bucketSet.add(point.bucket);
		const buckets = [...bucketSet].sort((a, b) => a - b);

		const lookup = new Map<number, Map<string, number>>();
		for (const point of ts) {
			if (!lookup.has(point.bucket)) lookup.set(point.bucket, new Map());
			lookup.get(point.bucket)!.set(point.category, point.count);
		}

		const series = CATEGORIES.map((cat) => ({
			name: cat,
			type: 'line' as const,
			stack: 'events',
			smooth: true,
			symbol: 'none',
			lineStyle: { width: 1.5, color: CATEGORY_COLORS[cat] },
			itemStyle: { color: CATEGORY_COLORS[cat] },
			areaStyle: { opacity: 0.25, color: CATEGORY_COLORS[cat] },
			data: buckets.map((b) => [b, lookup.get(b)?.get(cat) ?? 0])
		}));

		return {
			backgroundColor: 'transparent',
			tooltip: {
				trigger: 'axis',
				axisPointer: { type: 'cross' },
				formatter: (params: any) => {
					if (!Array.isArray(params)) return '';
					const ps = params as Array<{ value: [number, number]; marker: string; seriesName: string }>;
					const nonZero = ps.filter((p) => p.value[1] > 0);
					if (nonZero.length === 0) return '';
					const d = new Date(ps[0].value[0]);
					const timeStr = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
					const rows = nonZero.map((p) => `<tr><td style="padding-right:12px">${p.marker}${p.seriesName}</td><td style="text-align:right;font-weight:600">${p.value[1]}</td></tr>`).join('');
					return `<div style="font-size:11px"><div style="margin-bottom:4px;color:#a1a1aa">${timeStr}</div><table>${rows}</table></div>`;
				}
			},
			legend: {
				data: [...CATEGORIES],
				top: 4,
				right: 8,
				textStyle: { fontSize: 10, color: '#71717a' }
			},
			grid: { left: 48, right: 24, top: 32, bottom: 32 },
			xAxis: {
				type: 'time',
				axisLabel: {
					fontSize: 10,
					color: '#71717a',
					formatter: (value: number) => {
						const d = new Date(value);
						return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
					}
				}
			},
			yAxis: {
				type: 'value',
				minInterval: 1,
				axisLabel: { fontSize: 10, color: '#71717a' }
			},
			series
		};
	});

	// ── Top Events bar chart ──────────────────────────────────────────────────
	let topEventsOptions: EChartsOption = $derived.by(() => {
		const topEvents = summary?.topEvents ?? [];
		if (topEvents.length === 0) {
			return {
				backgroundColor: 'transparent',
				grid: { left: 48, right: 24, top: 8, bottom: 24 },
				xAxis: { type: 'value' },
				yAxis: { type: 'category', data: [] },
				series: []
			};
		}

		const reversed = [...topEvents].reverse();
		return {
			backgroundColor: 'transparent',
			tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
			grid: { left: 120, right: 24, top: 8, bottom: 24 },
			xAxis: {
				type: 'value',
				minInterval: 1,
				axisLabel: { fontSize: 10, color: '#71717a' }
			},
			yAxis: {
				type: 'category',
				data: reversed.map((e) => e.event),
				axisLabel: { fontSize: 10, color: '#71717a', width: 100, overflow: 'truncate' }
			},
			series: [{
				type: 'bar',
				data: reversed.map((e) => e.count),
				itemStyle: { color: '#3b82f6', borderRadius: [0, 4, 4, 0] },
				barMaxWidth: 20
			}]
		};
	});

	// ── Severity pie ──────────────────────────────────────────────────────────
	let severityOptions: EChartsOption = $derived.by(() => {
		const bySeverity = summary?.bySeverity ?? {};
		const total = summary?.total ?? 0;
		const data = Object.entries(bySeverity)
			.filter(([, count]) => count > 0)
			.map(([name, value]) => ({
				name,
				value,
				itemStyle: { color: SEVERITY_COLORS[name] ?? '#64748b' }
			}));

		return {
			backgroundColor: 'transparent',
			tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
			series: [{
				type: 'pie',
				radius: ['40%', '65%'],
				center: ['50%', '52%'],
				avoidLabelOverlap: true,
				label: { show: true, fontSize: 11, color: '#71717a' },
				emphasis: { label: { show: true, fontWeight: 'bold' } },
				data,
				itemStyle: { borderColor: 'transparent', borderWidth: 2 }
			}],
			graphic: [{
				type: 'text',
				left: 'center',
				top: '46%',
				style: {
					text: String(total),
					fontSize: 20,
					fontWeight: 'bold',
					fill: '#a1a1aa',
					textAlign: 'center',
					textVerticalAlign: 'middle'
				}
			}]
		};
	});
</script>

<div class="relative z-10 flex flex-col h-screen text-foreground">
	<Topbar />

	<!-- Toolbar -->
	<header class="shrink-0 flex items-end gap-3 px-4 py-2.5 border-b border-border bg-bg2/80 backdrop-blur-sm">
		<ShieldCheck size={14} class="text-accent shrink-0" />
		<h1 class="text-sm font-semibold tracking-tight">{m.reliability_title()}</h1>
		<div class="flex-1"></div>
		<DateRangePicker
			from={reliability.dateRange.from}
			to={reliability.dateRange.to}
			onchange={handleDateChange}
		/>
		<button
			type="button"
			class="flex items-center justify-center w-7 h-7 rounded border border-border bg-bg3 text-muted-foreground hover:text-foreground hover:bg-border cursor-pointer transition-colors"
			onclick={loadData}
			title="Refresh data"
		>
			<RefreshCw size={12} class={loading ? 'animate-spin' : ''} />
		</button>
	</header>

	<main class="flex-1 min-h-0 overflow-y-auto p-4">
		{#if !serverId}
			<div class="h-full flex items-center justify-center">
				<div class="text-center">
					<Server size={32} class="text-muted-foreground/30 mx-auto mb-3" />
					<p class="text-muted-foreground text-sm">{m.reliability_connectToView()}</p>
				</div>
			</div>
		{:else if loading && !summary}
			<div class="h-full flex items-center justify-center">
				<div class="flex flex-col items-center gap-3">
					<div class="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin"></div>
					<p class="text-muted-foreground text-xs">{m.common_loading()}</p>
				</div>
			</div>
		{:else}
		<div class="flex flex-col gap-3">
			<!-- ── Overview Stats Widget ───────────────────────────────────────── -->
			<div class="bg-card border border-border rounded-lg overflow-hidden">
				<div class="grid grid-cols-6 divide-x divide-border/60 max-[900px]:grid-cols-3 max-sm:grid-cols-2">
					{#each statItems as item (item.key)}
						{@const Icon = item.Icon}
						<div class="relative px-5 pt-4 pb-5 flex flex-col gap-2">
							<!-- Colored top accent stripe -->
							<div class="absolute top-0 left-0 right-0 h-[2px]" style:background={item.color}></div>
							<div class="flex items-center gap-1.5 mt-0.5">
								<span style:color={item.color} class="shrink-0 flex"><Icon size={10} /></span>
								<span class="text-[9px] font-semibold text-muted-foreground uppercase tracking-widest truncate">{item.label}</span>
							</div>
							<span class="text-4xl font-bold font-mono tabular-nums leading-none tracking-tight" style:color={item.color}>
								{item.value}
							</span>
						</div>
					{/each}
				</div>
			</div>

			<!-- ── Event Timeline Widget ───────────────────────────────────────── -->
			<div class="bg-card border border-border rounded-lg overflow-hidden">
				<div class="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg3/20">
					<TrendingUp size={11} class="text-accent shrink-0" />
					<span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Event Timeline</span>
				</div>
				<div class="relative overflow-hidden">
					<ScanLine speed={10} opacity={0.018} />
					<Chart options={timelineOptions} height="300px" />
				</div>
			</div>

			<!-- ── Two-column: Top Events + Severity ──────────────────────────── -->
			<div class="grid grid-cols-2 gap-3 max-[800px]:grid-cols-1">
				<div class="bg-card border border-border rounded-lg overflow-hidden">
					<div class="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg3/20">
						<BarChart2 size={11} class="text-accent shrink-0" />
						<span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Top Events</span>
					</div>
					<div class="relative overflow-hidden">
						<ScanLine speed={14} opacity={0.018} />
						<Chart options={topEventsOptions} height="300px" />
					</div>
				</div>

				<div class="bg-card border border-border rounded-lg overflow-hidden">
					<div class="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg3/20">
						<PieChart size={11} class="text-accent shrink-0" />
						<span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Severity Distribution</span>
					</div>
					<div class="relative overflow-hidden">
						<ScanLine speed={8} opacity={0.018} />
						<Chart options={severityOptions} height="300px" />
					</div>
				</div>
			</div>

			<!-- ── Health Panels ────────────────────────────────────────────────── -->
			<div class="grid grid-cols-3 gap-3 max-[900px]:grid-cols-1">
				<GatewayHealthPanel {serverId} />
				<CredentialHealthPanel {serverId} />
				<SkillStatsPanel {serverId} />
			</div>

			<!-- ── Incident Table ───────────────────────────────────────────────── -->
			<IncidentTable events={reliability.events} title={m.reliability_recentIncidents()} />
		</div>
		{/if}
	</main>
</div>
