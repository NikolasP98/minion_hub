<script lang="ts">
	import Chart from '$lib/components/charts/Chart.svelte';
	import { PageHeader, Tabs, MultiSelectFilter } from '$lib/components/ui';
	import type { MultiSelectOption } from '$lib/components/ui';
	import DateRangePicker from '$lib/components/reliability/DateRangePicker.svelte';
	import CredentialHealthPanel from '$lib/components/reliability/CredentialHealthPanel.svelte';
	import SkillStatsPanel from '$lib/components/reliability/SkillStatsPanel.svelte';
	import GatewayHealthPanel from '$lib/components/reliability/GatewayHealthPanel.svelte';
	import PluginHealthPanel from '$lib/components/reliability/PluginHealthPanel.svelte';
	import ConnectionEventsPanel from '$lib/components/reliability/ConnectionEventsPanel.svelte';
	import AgentLlmMetricsPanel from '$lib/components/reliability/AgentLlmMetricsPanel.svelte';
	import ScanLine from '$lib/components/decorations/ScanLine.svelte';
	import {
		reliability,
		loadReliabilitySummary,
		loadReliabilityEvents,
		loadReliabilityTimeline
	} from '$lib/state/reliability/reliability.svelte';
	import { hostsState } from '$lib/state/features/hosts.svelte';
	import { conn } from '$lib/state/gateway';
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
		Bot,
		Wrench,
		Puzzle,
	} from 'lucide-svelte';

	// ── Persistence ───────────────────────────────────────────────────────────
	const FILTER_STORAGE_KEY = 'minion-hub-reliability-filters';

	interface PersistedFilters {
		categories: string[];
		severities: string[];
		failureModes?: string[];
		datePreset: string | null;
		customFrom?: number;
		customTo?: number;
		tab?: string;
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
			failureModes: [...selectedFailureModes],
			datePreset: preset,
			customFrom: preset ? undefined : reliability.dateRange.from,
			customTo: preset ? undefined : reliability.dateRange.to,
			tab: activeTab,
		});
	}

	function getCSSVar(name: string, fallback: string): string {
		return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
	}

	// Category = qualitative labels (distinct hue set, kept clear of the severity
	// ramp so a bar/donut never confuses category with urgency). Council 2026-05-29.
	// Full raw event taxonomy (matches the gateway-emitted categories + the
	// Activity Log tabs), so chips and the Event Timeline cover EVERY category —
	// previously `channel` (~5.8k events) was invisible because it wasn't curated.
	// Council 2026-05-29 (taxonomy-unification). crash kept off the critical-red
	// ramp (#fb7185 rose) so category never reads as severity.
	const CATEGORY_COLORS: Record<string, string> = {
		gateway:       '#4ade80',
		agent:         '#f472b6',
		channel:       '#f59e0b',
		message:       '#06b6d4',
		tool:          '#a855f7',
		orchestration: '#ec4899',
		skill:         '#22d3ee',
		connection:    '#14b8a6',
		auth:          '#34d399',
		cron:          '#60a5fa',
		crash:         '#fb7185',
		browser:       '#c084fc',
		timezone:      '#818cf8',
		general:       '#94a3b8'
	};

	// Severity = ordinal alarm ramp. info (blue) + low (slate) are the non-alarm
	// cool/neutral steps; medium→critical is the warm danger ramp. low was lime
	// (#a3e635) but collided with high (#f59e0b amber) under deuteranopia and
	// wasn't perceptually monotonic — slate restores a colourblind-safe ramp while
	// staying distinct from info. `ok` is a separate resolved state. Council 2026-05-29.
	const SEVERITY_COLORS: Record<string, string> = {
		info:     '#38bdf8',
		low:      '#64748b',
		medium:   '#fb923c',
		high:     '#f59e0b',
		critical: '#ef4444',
		ok:       '#22c55e'
	};

	const CATEGORIES = ['gateway', 'agent', 'channel', 'message', 'tool', 'orchestration', 'skill', 'connection', 'auth', 'cron', 'crash', 'browser', 'timezone', 'general'] as const;

	let summary = $derived(reliability.summary);
	let loading = $derived(reliability.loading);
	let serverId = $derived(hostsState.activeHostId);

	// ── Filter state (restored from localStorage) ────────────────────────────
	const _saved = loadFilters();
	let selectedCategories = $state<Set<string>>(new Set(_saved.categories));
	let selectedSeverities = $state<Set<string>>(new Set(_saved.severities));
	// Failure mode = the part of an event name after its `<type>.` prefix
	// (e.g. `gateway.ws_slow_response` → type `gateway`, mode `ws_slow_response`).
	let selectedFailureModes = $state<Set<string>>(new Set(_saved.failureModes ?? []));

	// Split an event name into its type prefix + failure-mode suffix. Events are
	// dotted (`<type>.<mode...>`); a dotless event is its own type with no mode.
	function parseEventName(event: string): { type: string; failureMode: string } {
		const dot = event.indexOf('.');
		if (dot === -1) return { type: event, failureMode: event };
		return { type: event.slice(0, dot), failureMode: event.slice(dot + 1) };
	}

	// ── Tabs (separate concerns: overview / agents+llm / plugins) ─────────────
	let activeTab = $state<string>(_saved.tab ?? 'overview');
	const tabItems = $derived([
		{ value: 'overview', label: m.reliability_tabOverview(), icon: Activity },
		{ value: 'agents', label: m.reliability_tabAgents(), icon: Bot },
		{ value: 'plugins', label: m.reliability_tabPlugins(), icon: Puzzle },
	]);

	function handleTabChange(v: string) {
		activeTab = v;
		persistFilters();
	}

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

	function toggleFailureMode(mode: string) {
		const next = new Set(selectedFailureModes);
		if (next.has(mode)) next.delete(mode); else next.add(mode);
		selectedFailureModes = next;
		persistFilters();
	}

	const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info', 'ok'] as const;

	// Dropdown option lists — counts come from the unfiltered server summary so
	// each row shows how many of that category/severity exist in the range.
	const categoryFilterOptions = $derived<MultiSelectOption[]>(
		CATEGORIES.map((c) => ({
			value: c,
			label: c,
			color: CATEGORY_COLORS[c],
			count: summary?.byCategory[c] ?? 0,
		})),
	);
	const severityFilterOptions = $derived<MultiSelectOption[]>(
		SEVERITIES.map((s) => ({
			value: s,
			label: s,
			color: SEVERITY_COLORS[s],
			count: summary?.bySeverity[s] ?? 0,
		})),
	);

	function clearAllFilters() {
		selectedCategories = new Set();
		selectedSeverities = new Set();
		selectedFailureModes = new Set();
		persistFilters();
	}

	const hasActiveFilters = $derived(
		selectedCategories.size > 0 || selectedSeverities.size > 0 || selectedFailureModes.size > 0,
	);

	// Events filtered by category + severity only — the failure-mode dropdown
	// derives its option list from this set so picking a mode never collapses
	// the list of available modes.
	let categorySeverityFiltered = $derived.by(() => {
		let evts = reliability.events;
		if (selectedCategories.size > 0) evts = evts.filter(e => selectedCategories.has(e.category));
		if (selectedSeverities.size > 0) evts = evts.filter(e => selectedSeverities.has(e.severity));
		return evts;
	});

	let filteredEvents = $derived.by(() => {
		if (selectedFailureModes.size === 0) return categorySeverityFiltered;
		return categorySeverityFiltered.filter(e =>
			selectedFailureModes.has(parseEventName(e.event).failureMode),
		);
	});

	// Failure-mode dropdown options — distinct modes in the current cat/sev scope,
	// sorted by frequency, coloured by their event type.
	const failureModeFilterOptions = $derived.by((): MultiSelectOption[] => {
		const counts = new Map<string, { count: number; type: string }>();
		for (const e of categorySeverityFiltered) {
			const { type, failureMode } = parseEventName(e.event);
			const cur = counts.get(failureMode);
			if (cur) cur.count++;
			else counts.set(failureMode, { count: 1, type });
		}
		return [...counts.entries()]
			.sort((a, b) => b[1].count - a[1].count)
			.map(([mode, { count, type }]) => ({
				value: mode,
				label: mode,
				color: CATEGORY_COLORS[type] ?? '#3b82f6',
				count,
			}));
	});

	// Overview stat cells — use server-side summary (SQL aggregation) for accurate totals,
	// fall back to client-side counting from the paginated events list.
	let overviewStats = $derived.by(() => {
		if (summary && !hasActiveFilters) {
			// No filters active — use the server-side summary (covers ALL events, not just the page)
			return { total: summary.total, byCategory: summary.byCategory, bySeverity: summary.bySeverity };
		}
		// Filters active — compute from the (possibly paginated) event list
		const evts = filteredEvents;
		const byCategory: Record<string, number> = {};
		const bySeverity: Record<string, number> = {};
		for (const e of evts) {
			byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
			bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
		}
		return { total: evts.length, byCategory, bySeverity };
	});

	const statItems = $derived([
		{ key: 'total',    Icon: Activity,      color: 'var(--color-accent)',       label: m.reliability_totalEvents(),    value: overviewStats.total },
		{ key: 'critical', Icon: AlertCircle,   color: 'var(--color-destructive)',  label: m.reliability_criticalEvents(), value: overviewStats.bySeverity.critical ?? 0 },
		{ key: 'cron',     Icon: Clock,         color: 'var(--color-warning)',      label: m.reliability_cronIssues(),     value: overviewStats.byCategory.cron ?? 0 },
		{ key: 'browser',  Icon: Globe,         color: 'var(--color-purple)',       label: m.reliability_browserIssues(), value: overviewStats.byCategory.browser ?? 0 },
		{ key: 'auth',     Icon: KeyRound,      color: 'var(--color-success)',      label: m.reliability_authIssues(),     value: overviewStats.byCategory.auth ?? 0 },
		{ key: 'gateway',  Icon: Radio,         color: 'var(--color-cyan)',         label: m.reliability_gatewayIssues(), value: overviewStats.byCategory.gateway ?? 0 },
		{ key: 'agent',    Icon: Bot,           color: '#ec4899',                   label: m.reliability_agentIssues(),   value: overviewStats.byCategory.agent ?? 0 },
		{ key: 'skill',    Icon: Wrench,        color: '#06b6d4',                   label: m.reliability_skillIssues(),   value: overviewStats.byCategory.skill ?? 0 },
	]);

	async function loadData() {
		if (!serverId) return;
		const { from, to } = reliability.dateRange;
		await Promise.all([
			loadReliabilitySummary(serverId, from, to),
			loadReliabilityEvents(serverId, { from, to, limit: 10_000 }),
			loadReliabilityTimeline(from, to)
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
		// Explicit initial load — the $effect handles subsequent reactive updates
		if (serverId && conn.connected) loadData();
	});

	$effect(() => {
		const _from = reliability.dateRange.from;
		const _to = reliability.dateRange.to;
		const _sid = serverId;
		const _connected = conn.connected;
		if (_sid && _connected) {
			untrack(() => loadData());
		}
	});

	// ── Timeline bar chart (derived from events) ─────────────────────────────
	function getBucketMs(rangeMs: number): number {
		// Target ~30 bars regardless of range; snap to a clean interval
		const TARGET_BARS = 30;
		const snaps = [
			60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000, 30 * 60_000,
			3_600_000, 2 * 3_600_000, 4 * 3_600_000, 6 * 3_600_000, 12 * 3_600_000,
			86_400_000,
		];
		return snaps.reduce((best, s) => {
			const bars = rangeMs / s;
			const bestBars = rangeMs / best;
			return Math.abs(bars - TARGET_BARS) < Math.abs(bestBars - TARGET_BARS) ? s : best;
		});
	}

	let timelineOptions: EChartsOption = $derived.by(() => {
		// Prefer the server-aggregated timeline (full range, cheap GROUP BY); fall
		// back to client-side bucketing of the (capped) events when the gateway
		// predates reliability.timeline.
		const rpc = reliability.timeline;
		const counts = new Map<string, Map<number, number>>();
		let bucketMs: number;

		if (rpc) {
			bucketMs = rpc.bucketMs;
			for (const b of rpc.buckets) {
				if (!counts.has(b.category)) counts.set(b.category, new Map());
				const catMap = counts.get(b.category)!;
				catMap.set(b.bucket, (catMap.get(b.bucket) ?? 0) + b.count);
			}
		} else {
			const evts = filteredEvents;
			if (evts.length === 0) {
				return {
					backgroundColor: 'transparent',
					grid: { left: 48, right: 24, top: 32, bottom: 32 },
					xAxis: { type: 'time', data: [] },
					yAxis: { type: 'value' },
					series: []
				};
			}
			bucketMs = getBucketMs(reliability.dateRange.to - reliability.dateRange.from);
			for (const evt of evts) {
				const cat = evt.category;
				const bucket = Math.floor(evt.timestamp / bucketMs) * bucketMs;
				if (!counts.has(cat)) counts.set(cat, new Map());
				const catMap = counts.get(cat)!;
				catMap.set(bucket, (catMap.get(bucket) ?? 0) + 1);
			}
		}

		// Pre-fill ALL buckets across the full date range (empty periods → zero bars)
		const rangeFrom = Math.floor(reliability.dateRange.from / bucketMs) * bucketMs;
		const rangeTo = reliability.dateRange.to;
		const buckets: number[] = [];
		for (let t = rangeFrom; t <= rangeTo; t += bucketMs) {
			buckets.push(t);
		}

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
	// Bars are the top failure modes (the suffix of each `<type>.<mode>` event),
	// labelled by mode and coloured by their type so the same chart shows BOTH
	// dimensions. Counting keys on the full event name (unique); the y-axis label
	// + tooltip surface the type/mode split. Click a bar to filter by that mode.
	const TOP_EVENT_FALLBACK_COLOR = '#3b82f6';

	let topEvents = $derived.by(() => {
		const eventCounts = new Map<string, number>();
		for (const evt of filteredEvents) {
			eventCounts.set(evt.event, (eventCounts.get(evt.event) ?? 0) + 1);
		}
		return [...eventCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
	});

	// Distinct types present in the top events → custom HTML legend (ECharts can't
	// legend per-item on a single bar series).
	const topEventTypes = $derived.by(() => {
		const types = new Set(topEvents.map(([name]) => parseEventName(name).type));
		return [...types].map((type) => ({ type, color: CATEGORY_COLORS[type] ?? TOP_EVENT_FALLBACK_COLOR }));
	});

	let topEventsOptions: EChartsOption = $derived.by(() => {
		const top = [...topEvents].reverse(); // ECharts category axis renders bottom→top
		return {
			backgroundColor: 'transparent',
			tooltip: {
				trigger: 'item',
				axisPointer: { type: 'shadow' },
				formatter: (params: any) => {
					const full = String(params.name ?? '');
					const { type, failureMode } = parseEventName(full);
					const color = CATEGORY_COLORS[type] ?? TOP_EVENT_FALLBACK_COLOR;
					const count = params.value as number;
					return `<div style="font-size:11px">
						<div style="font-weight:600">${failureMode}</div>
						<div style="display:flex;align-items:center;gap:5px;margin:2px 0;color:var(--color-muted-foreground);font-size:10px">
							<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${color}"></span>${type}
						</div>
						<div style="font-weight:600">${count} ${count === 1 ? m.reliability_llmCall() : m.reliability_llmCallsPlural()}</div>
					</div>`;
				}
			},
			grid: { left: 130, right: 32, top: 8, bottom: 24 },
			xAxis: {
				type: 'value',
				minInterval: 1,
				axisLabel: { fontSize: 10 }
			},
			yAxis: {
				type: 'category',
				data: top.map(([name]) => name),
				axisLabel: {
					fontSize: 10,
					width: 110,
					overflow: 'truncate',
					formatter: (name: string) => parseEventName(name).failureMode
				}
			},
			series: [{
				type: 'bar',
				data: top.map(([name, count]) => ({
					value: count,
					itemStyle: {
						color: CATEGORY_COLORS[parseEventName(name).type] ?? TOP_EVENT_FALLBACK_COLOR,
						borderRadius: [0, 4, 4, 0]
					}
				})),
				barMaxWidth: 20
			}]
		};
	});

	function handleTopEventClick(params: unknown) {
		const name = (params as { name?: string })?.name;
		if (name) toggleFailureMode(parseEventName(name).failureMode);
	}

	// ── Severity pie ──────────────────────────────────────────────────────────
	let severityOptions: EChartsOption = $derived.by(() => {
		const bySeverity = overviewStats.bySeverity;
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
	<PageHeader title={m.reliability_title()}>
		{#snippet leading()}
			<ShieldCheck size={16} class="text-accent shrink-0" />
		{/snippet}
		{#snippet actions()}
			<DateRangePicker
				from={reliability.dateRange.from}
				to={reliability.dateRange.to}
				onchange={handleDateChange}
			/>
			<button
				type="button"
				class="flex items-center justify-center w-7 h-7 rounded border border-border bg-bg3 text-muted-foreground hover:text-foreground hover:bg-border cursor-pointer transition-colors"
				onclick={loadData}
				title={m.reliability_refreshData()}
			>
				<RefreshCw size={12} class={loading ? 'animate-spin' : ''} />
			</button>
		{/snippet}
	</PageHeader>
	<!-- Filter + tab bar -->
	<div class="shrink-0 relative z-30 border-b border-border bg-bg2/80 backdrop-blur-sm">
		{#if summary}
			<div class="flex items-center gap-2 flex-wrap px-4 pt-2 pb-2.5">
				<MultiSelectFilter
					label={m.reliability_category()}
					options={categoryFilterOptions}
					selected={selectedCategories}
					onToggle={toggleCategory}
					onClear={() => { selectedCategories = new Set(); persistFilters(); }}
					allLabel={m.reliability_filterAll()}
				/>
				<MultiSelectFilter
					label={m.reliability_severity()}
					options={severityFilterOptions}
					selected={selectedSeverities}
					onToggle={toggleSeverity}
					onClear={() => { selectedSeverities = new Set(); persistFilters(); }}
					allLabel={m.reliability_filterAll()}
				/>
				<MultiSelectFilter
					label={m.reliability_failureMode()}
					options={failureModeFilterOptions}
					selected={selectedFailureModes}
					onToggle={toggleFailureMode}
					onClear={() => { selectedFailureModes = new Set(); persistFilters(); }}
					allLabel={m.reliability_filterAll()}
				/>
				{#if hasActiveFilters}
					<button
						type="button"
						class="text-[10px] py-0.5 px-2 rounded-md cursor-pointer text-muted-foreground hover:text-foreground transition-colors shrink-0"
						onclick={clearAllFilters}
					>
						{m.marketplace_agentsListClearFilters()}
					</button>
				{/if}
			</div>
		{/if}
		<Tabs
			tabs={tabItems}
			value={activeTab}
			size="sm"
			class="px-4 border-b-0"
			aria-label={m.reliability_title()}
			onValueChange={handleTabChange}
		/>
	</div>

	<main class="flex-1 min-h-0 overflow-y-auto p-4">
		{#if !serverId}
			<div class="h-full flex items-center justify-center">
				<div class="text-center">
					<Server size={32} class="text-muted-strong mx-auto mb-3" />
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
			{#if activeTab === 'overview'}
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
					<span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{m.reliability_eventTimeline()}</span>
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
						<span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{m.reliability_topEvents()}</span>
						<!-- Type legend: bar colours decode to event types -->
						<div class="ml-auto flex items-center gap-2 flex-wrap justify-end">
							{#each topEventTypes as t (t.type)}
								<button
									type="button"
									class="flex items-center gap-1 cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
									title={m.reliability_filterCategoryTitle({ category: t.type })}
									onclick={() => toggleCategory(t.type)}
								>
									<span class="w-2 h-2 rounded-sm shrink-0" style:background={t.color}></span>
									<span class="text-[9px] font-medium {selectedCategories.has(t.type) ? 'text-foreground' : ''}">{t.type}</span>
								</button>
							{/each}
						</div>
					</div>
					<div class="relative overflow-hidden">
						<ScanLine speed={14} opacity={0.018} />
						<Chart options={topEventsOptions} height="300px" onItemClick={handleTopEventClick} />
					</div>
				</div>

				<div class="bg-card border border-border rounded-lg overflow-hidden">
					<div class="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg3/20">
						<PieChart size={11} class="text-accent shrink-0" />
						<span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{m.reliability_severityDistribution()}</span>
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

			<!-- ── Activity Log (consolidated: scatter + tabs + sortable/searchable/paginated table) ── -->
			<ConnectionEventsPanel
				events={filteredEvents}
				total={overviewStats.total}
				byCategory={overviewStats.byCategory}
			/>
			{:else if activeTab === 'agents'}
			<!-- ── Agents & LLM ─────────────────────────────────────────────────── -->
			<AgentLlmMetricsPanel events={filteredEvents} />
			{:else if activeTab === 'plugins'}
			<!-- ── Plugin Health ────────────────────────────────────────────────── -->
			<PluginHealthPanel {serverId} />
			{/if}
		</div>
		{/if}
	</main>
