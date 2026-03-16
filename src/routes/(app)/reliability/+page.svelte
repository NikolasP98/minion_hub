<script lang="ts">
	import Chart from '$lib/components/charts/Chart.svelte';
	import DateRangePicker from '$lib/components/reliability/DateRangePicker.svelte';
	import IncidentTable from '$lib/components/reliability/IncidentTable.svelte';
	import CredentialHealthPanel from '$lib/components/reliability/CredentialHealthPanel.svelte';
	import SkillStatsPanel from '$lib/components/reliability/SkillStatsPanel.svelte';
	import GatewayHealthPanel from '$lib/components/reliability/GatewayHealthPanel.svelte';
	import PluginHealthPanel from '$lib/components/reliability/PluginHealthPanel.svelte';
	import ConnectionEventsPanel from '$lib/components/reliability/ConnectionEventsPanel.svelte';
	import ScanLine from '$lib/components/decorations/ScanLine.svelte';
	import {
		reliability,
		loadReliabilitySummary,
		loadReliabilityEvents
	} from '$lib/state/reliability/reliability.svelte';
	import { hostsState } from '$lib/state/features/hosts.svelte';
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
		ChevronLeft,
		ChevronRight,
		Bot,
		Wrench,
	} from 'lucide-svelte';

	// ── Persistence ───────────────────────────────────────────────────────────
	const FILTER_STORAGE_KEY = 'minion-hub-reliability-filters';

	interface PersistedFilters {
		categories: string[];
		severities: string[];
		datePreset: string | null;
		customFrom?: number;
		customTo?: number;
	}

	const PRESET_MS: Record<string, number> = {
		'1h': 3_600_000,
		'24h': 86_400_000,
		'7d': 7 * 86_400_000,
		'30d': 30 * 86_400_000,
	};

	function loadFilters(): PersistedFilters {
		if (typeof localStorage === 'undefined') return { categories: [], severities: [], datePreset: '24h' };
		try {
			const raw = localStorage.getItem(FILTER_STORAGE_KEY);
			if (raw) return JSON.parse(raw);
		} catch {}
		return { categories: [], severities: [], datePreset: '24h' };
	}

	function saveFilters(f: PersistedFilters) {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(f));
	}

	function getActivePreset(): string | null {
		const now = Date.now();
		const { from, to } = reliability.dateRange;
		for (const [label, ms] of Object.entries(PRESET_MS)) {
			if (Math.abs(from - (now - ms)) < 5000 && Math.abs(to - now) < 5000) return label;
		}
		return null;
	}

	function persistFilters() {
		const preset = getActivePreset();
		saveFilters({
			categories: [...selectedCategories],
			severities: [...selectedSeverities],
			datePreset: preset,
			customFrom: preset ? undefined : reliability.dateRange.from,
			customTo: preset ? undefined : reliability.dateRange.to,
		});
	}

	function getCSSVar(name: string, fallback: string): string {
		return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
	}

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
		low:      '#64748b',
		ok:       '#22c55e'
	};

	const CATEGORIES = ['cron', 'browser', 'timezone', 'general', 'auth', 'skill', 'agent', 'gateway'] as const;

	let summary = $derived(reliability.summary);
	let loading = $derived(reliability.loading);
	let serverId = $derived(hostsState.activeHostId);

	// ── Filter scroll indicators ──────────────────────────────────────────────
	let filterScrollEl = $state<HTMLDivElement | null>(null);
	let canScrollLeft = $state(false);
	let canScrollRight = $state(false);

	function updateScrollIndicators() {
		if (!filterScrollEl) return;
		const { scrollLeft, scrollWidth, clientWidth } = filterScrollEl;
		canScrollLeft = scrollLeft > 2;
		canScrollRight = scrollLeft + clientWidth < scrollWidth - 2;
	}

	function scrollFilters(direction: 'left' | 'right') {
		if (!filterScrollEl) return;
		const amount = filterScrollEl.clientWidth * 0.6;
		filterScrollEl.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' });
	}

	$effect(() => {
		const el = filterScrollEl;
		if (!el) return;
		updateScrollIndicators();
		el.addEventListener('scroll', updateScrollIndicators, { passive: true });
		const ro = new ResizeObserver(updateScrollIndicators);
		ro.observe(el);
		return () => {
			el.removeEventListener('scroll', updateScrollIndicators);
			ro.disconnect();
		};
	});

	// ── Filter state (restored from localStorage) ────────────────────────────
	const _saved = loadFilters();
	let selectedCategories = $state<Set<string>>(new Set(_saved.categories));
	let selectedSeverities = $state<Set<string>>(new Set(_saved.severities));

	function toggleCategory(cat: string) {
		const next = new Set(selectedCategories);
		if (next.has(cat)) next.delete(cat); else next.add(cat);
		selectedCategories = next;
		persistFilters();
	}

	function toggleSeverity(sev: string) {
		const next = new Set(selectedSeverities);
		if (next.has(sev)) next.delete(sev); else next.add(sev);
		selectedSeverities = next;
		persistFilters();
	}

	const SEVERITIES = ['critical', 'high', 'medium', 'low', 'ok'] as const;

	let filteredEvents = $derived.by(() => {
		let evts = reliability.events;
		if (selectedCategories.size > 0) evts = evts.filter(e => selectedCategories.has(e.category));
		if (selectedSeverities.size > 0) evts = evts.filter(e => selectedSeverities.has(e.severity));
		return evts;
	});

	// Overview stat cells
	const statItems = $derived([
		{ key: 'total',    Icon: Activity,      color: 'var(--color-accent)',       label: m.reliability_totalEvents(),    value: summary?.total ?? 0 },
		{ key: 'critical', Icon: AlertCircle,   color: 'var(--color-destructive)',  label: m.reliability_criticalEvents(), value: summary?.bySeverity?.critical ?? 0 },
		{ key: 'cron',     Icon: Clock,         color: 'var(--color-warning)',      label: m.reliability_cronIssues(),     value: summary?.byCategory?.cron ?? 0 },
		{ key: 'browser',  Icon: Globe,         color: 'var(--color-purple)',       label: m.reliability_browserIssues(), value: summary?.byCategory?.browser ?? 0 },
		{ key: 'auth',     Icon: KeyRound,      color: 'var(--color-success)',      label: m.reliability_authIssues(),     value: summary?.byCategory?.auth ?? 0 },
		{ key: 'gateway',  Icon: Radio,         color: 'var(--color-cyan)',         label: m.reliability_gatewayIssues(), value: summary?.byCategory?.gateway ?? 0 },
		{ key: 'agent',    Icon: Bot,           color: '#ec4899',                   label: m.reliability_agentIssues(),   value: summary?.byCategory?.agent ?? 0 },
		{ key: 'skill',    Icon: Wrench,        color: '#06b6d4',                   label: m.reliability_skillIssues(),   value: summary?.byCategory?.skill ?? 0 },
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
		persistFilters();
	}

	onMount(() => {
		const now = Date.now();
		if (_saved.datePreset && PRESET_MS[_saved.datePreset]) {
			reliability.dateRange.from = now - PRESET_MS[_saved.datePreset];
			reliability.dateRange.to = now;
		} else if (_saved.customFrom && _saved.customTo) {
			reliability.dateRange.from = _saved.customFrom;
			reliability.dateRange.to = _saved.customTo;
		} else {
			reliability.dateRange.from = now - 86_400_000;
			reliability.dateRange.to = now;
		}
		// The $effect watching dateRange will trigger loadData()
	});

	$effect(() => {
		const _from = reliability.dateRange.from;
		const _to = reliability.dateRange.to;
		const _sid = serverId;
		if (_sid) {
			untrack(() => loadData());
		}
	});

	// ── Timeline bar chart (adaptive bucketing) ──────────────────────────────
	function getBucketMs(rangeMs: number): number {
		if (rangeMs <= 3_600_000)          return 5 * 60_000;      // 1h  → 5min buckets
		if (rangeMs <= 24 * 3_600_000)     return 3_600_000;       // 24h → 1h buckets
		if (rangeMs <= 7 * 24 * 3_600_000) return 6 * 3_600_000;   // 7d  → 6h buckets
		return 24 * 3_600_000;                                      // 30d → 1d buckets
	}

	let timelineOptions: EChartsOption = $derived.by(() => {
		const ts = summary?.timeseries ?? [];
		const bucketMs = summary?.bucketMs ?? 3_600_000;

		// Apply category + severity filters to the server-side timeseries
		let filtered = ts;
		if (selectedCategories.size > 0) filtered = filtered.filter(p => selectedCategories.has(p.category));
		if (selectedSeverities.size > 0) filtered = filtered.filter(p => selectedSeverities.has(p.severity));

		if (filtered.length === 0) {
			return {
				backgroundColor: 'transparent',
				grid: { left: 48, right: 24, top: 32, bottom: 32 },
				xAxis: { type: 'time', data: [] },
				yAxis: { type: 'value' },
				series: []
			};
		}

		// Aggregate by bucket + category (sum across severities after filtering)
		const counts = new Map<string, Map<number, number>>();
		const allBuckets = new Set<number>();
		for (const p of filtered) {
			const cat = p.category;
			const bucket = Number(p.bucket);
			allBuckets.add(bucket);
			if (!counts.has(cat)) counts.set(cat, new Map());
			const catMap = counts.get(cat)!;
			catMap.set(bucket, (catMap.get(bucket) ?? 0) + Number(p.count));
		}

		const buckets = [...allBuckets].sort((a, b) => a - b);

		const visibleCategories = selectedCategories.size > 0
			? CATEGORIES.filter(c => selectedCategories.has(c))
			: CATEGORIES;

		const series = visibleCategories
			.filter(c => counts.has(c))
			.map(cat => ({
				name: cat,
				type: 'bar' as const,
				stack: 'events',
				data: buckets.map(b => [b, counts.get(cat)?.get(b) ?? 0]),
				itemStyle: { color: CATEGORY_COLORS[cat] },
				emphasis: { itemStyle: { opacity: 1 } },
				barMaxWidth: 24,
			}));

		return {
			backgroundColor: 'transparent',
			tooltip: {
				trigger: 'axis',
				axisPointer: { type: 'shadow' },
				formatter: (params: any) => {
					if (!Array.isArray(params)) return '';
					const ps = params as Array<{ value: [number, number]; marker: string; seriesName: string }>;
					const nonZero = ps.filter(p => p.value[1] > 0);
					if (nonZero.length === 0) return '';
					const d = new Date(ps[0].value[0]);
					const timeStr = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
					const total = nonZero.reduce((s, p) => s + p.value[1], 0);
					const rows = nonZero.map(p => `<tr><td style="padding-right:12px">${p.marker}${p.seriesName}</td><td style="text-align:right;font-weight:600">${p.value[1]}</td></tr>`).join('');
					return `<div style="font-size:11px"><div style="margin-bottom:4px;color:var(--color-muted-foreground)">${timeStr}</div><table>${rows}<tr><td style="padding-right:12px;border-top:1px solid var(--color-border);padding-top:3px">total</td><td style="text-align:right;font-weight:600;border-top:1px solid var(--color-border);padding-top:3px">${total}</td></tr></table></div>`;
				}
			},
			legend: {
				data: visibleCategories.filter(c => counts.has(c)),
				top: 4, right: 8,
				textStyle: { fontSize: 10 }
			},
			grid: { left: 48, right: 24, top: 32, bottom: 32 },
			xAxis: {
				type: 'time',
				axisLabel: {
					fontSize: 10,
					formatter: (value: number) => {
						const d = new Date(value);
						return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
					}
				}
			},
			yAxis: {
				type: 'value',
				minInterval: 1,
				axisLabel: { fontSize: 10 },
				splitLine: { lineStyle: { type: 'dashed' } }
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
				axisLabel: { fontSize: 10 }
			},
			yAxis: {
				type: 'category',
				data: reversed.map((e) => e.event),
				axisLabel: { fontSize: 10, width: 100, overflow: 'truncate' }
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
		const data = Object.entries(bySeverity)
			.filter(([name, count]) => count > 0 && (selectedSeverities.size === 0 || selectedSeverities.has(name)))
			.map(([name, value]) => ({
				name,
				value,
				itemStyle: { color: SEVERITY_COLORS[name] ?? '#64748b' },
				label: { color: SEVERITY_COLORS[name] ?? '#64748b' }
			}));

		const filteredTotal = data.reduce((sum, d) => sum + d.value, 0);

		return {
			backgroundColor: 'transparent',
			tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
			series: [{
				type: 'pie',
				radius: ['40%', '65%'],
				center: ['50%', '52%'],
				avoidLabelOverlap: true,
				label: { show: true, fontSize: 11 },
				emphasis: { label: { show: true, fontWeight: 'bold' } },
				data,
				itemStyle: { borderColor: 'transparent', borderWidth: 2 }
			}],
			graphic: [{
				type: 'text',
				left: 'center',
				top: '46%',
				style: {
					text: String(filteredTotal),
					fontSize: 20,
					fontWeight: 'bold',
					fill: getCSSVar('--color-muted', '#a1a1aa'),
					textAlign: 'center',
					textVerticalAlign: 'middle'
				}
			}]
		};
	});
</script>

<!-- Toolbar -->
	<header class="shrink-0 relative z-20 flex flex-col border-b border-border bg-bg2/80 backdrop-blur-sm">
		<div class="flex items-center gap-2 sm:gap-3 px-4 py-2.5 flex-wrap gap-y-2">
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
		</div>
		{#if summary}
		<div class="relative">
			<!-- Left scroll arrow + gradient -->
			{#if canScrollLeft}
				<button
					type="button"
					class="absolute left-0 top-0 bottom-2 z-10 flex items-center pl-1 pr-2 cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
					style="background: linear-gradient(to right, var(--color-bg2) 40%, transparent)"
					onclick={() => scrollFilters('left')}
				>
					<ChevronLeft size={12} />
				</button>
			{/if}

			<!-- Right scroll arrow + gradient -->
			{#if canScrollRight}
				<button
					type="button"
					class="absolute right-0 top-0 bottom-2 z-10 flex items-center pr-1 pl-2 cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
					style="background: linear-gradient(to left, var(--color-bg2) 40%, transparent)"
					onclick={() => scrollFilters('right')}
				>
					<ChevronRight size={12} />
				</button>
			{/if}

			<div
				bind:this={filterScrollEl}
				class="flex items-center gap-1.5 px-4 pb-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden flex-nowrap sm:flex-wrap"
			>
				<span class="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60 mr-0.5 shrink-0">Category</span>
				{#each CATEGORIES as cat (cat)}
					<button
						type="button"
						class="text-[10px] font-semibold py-0.5 px-2 rounded-md cursor-pointer transition-all duration-150 leading-snug whitespace-nowrap border shrink-0"
						style={selectedCategories.has(cat) ? `background:${CATEGORY_COLORS[cat]}22;color:${CATEGORY_COLORS[cat]};border-color:${CATEGORY_COLORS[cat]}44` : ''}
						class:bg-bg3={!selectedCategories.has(cat)}
						class:text-muted-foreground={!selectedCategories.has(cat)}
						class:border-border={!selectedCategories.has(cat)}
						onclick={() => toggleCategory(cat)}
					>
						{cat}
					</button>
				{/each}
				<span class="w-px h-4 bg-border mx-0.5 shrink-0"></span>
				<span class="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60 mr-0.5 shrink-0">Severity</span>
				{#each SEVERITIES as sev (sev)}
					<button
						type="button"
						class="text-[10px] font-semibold py-0.5 px-2 rounded-md cursor-pointer transition-all duration-150 leading-snug whitespace-nowrap border shrink-0"
						style={selectedSeverities.has(sev) ? `background:${SEVERITY_COLORS[sev]}22;color:${SEVERITY_COLORS[sev]};border-color:${SEVERITY_COLORS[sev]}44` : ''}
						class:bg-bg3={!selectedSeverities.has(sev)}
						class:text-muted-foreground={!selectedSeverities.has(sev)}
						class:border-border={!selectedSeverities.has(sev)}
						onclick={() => toggleSeverity(sev)}
					>
						{sev}
					</button>
				{/each}
				{#if selectedCategories.size > 0 || selectedSeverities.size > 0}
					<button
						type="button"
						class="text-[10px] py-0.5 px-2 rounded-md cursor-pointer text-muted-foreground hover:text-foreground transition-colors shrink-0"
						onclick={() => { selectedCategories = new Set(); selectedSeverities = new Set(); persistFilters(); }}
					>
						clear
					</button>
				{/if}
			</div>
		</div>
		{/if}
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
				<div class="grid grid-cols-8 divide-x divide-border/60 max-[1100px]:grid-cols-4 max-[700px]:grid-cols-2">
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

			<!-- ── Plugin Health (full-width) ──────────────────────────────────── -->
			<PluginHealthPanel {serverId} />

			<!-- ── Connection Events (full-width) ─────────────────────────────── -->
			<ConnectionEventsPanel {serverId} />

			<!-- ── Incident Table ───────────────────────────────────────────────── -->
			<IncidentTable events={filteredEvents} title={m.reliability_recentIncidents()} />
		</div>
		{/if}
	</main>
