<script lang="ts">
	import Chart from '$lib/components/charts/Chart.svelte';
	import { PageHeader, Tabs, MultiSelectFilter, MathFormula } from '$lib/components/ui';
	import type { MultiSelectOption } from '$lib/components/ui';
	import DateRangePicker from '$lib/components/reliability/DateRangePicker.svelte';
	import CredentialHealthPanel from '$lib/components/reliability/CredentialHealthPanel.svelte';
	import SkillStatsPanel from '$lib/components/reliability/SkillStatsPanel.svelte';
	import GatewayHealthPanel from '$lib/components/reliability/GatewayHealthPanel.svelte';
	import PluginHealthPanel from '$lib/components/reliability/PluginHealthPanel.svelte';
	import ConnectionEventsPanel from '$lib/components/reliability/ConnectionEventsPanel.svelte';
	import AgentLlmAnalytics from '$lib/components/reliability/AgentLlmAnalytics.svelte';
	import ScanLine from '$lib/components/decorations/ScanLine.svelte';
	import {
		reliability,
		loadReliabilitySummary,
		loadReliabilityEvents,
		loadReliabilityTimeline,
		loadReliabilityUsage,
		loadReliabilityActivity
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
		Radio,
		TrendingUp,
		BarChart2,
		PieChart,
		RefreshCw,
		Server,
		Bot,
		Wrench,
		Puzzle,
		Gauge,
		HeartPulse,
		Layers,
		Zap,
		TrendingDown,
		GitMerge,
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

	// ── KPI row (revised: rates & ratios, not raw counts) ─────────────────────
	// Council 2026-06-13: the old row was eight raw category/severity counts that
	// answered "how many X" but never "is the fleet healthy". The new row is rate-
	// based (health / error / critical / noise / heartbeat / tool-success) plus two
	// concentration reads (top category, throughput). Every cell recomputes from
	// `overviewStats` (summary when unfiltered, filteredEvents under active filters)
	// so the whole row is reactive to the category/severity/mode filters.
	const C = {
		success: 'var(--color-success)',
		warning: 'var(--color-warning)',
		destructive: 'var(--color-destructive)',
		accent: 'var(--color-accent)',
		cyan: 'var(--color-cyan)',
		muted: 'var(--color-muted)',
	};

	// Percent as a rounded string, or null when there is no denominator (callers
	// render an em-dash). Keeps "no data" honest vs a misleading 0%.
	function pct(num: number, den: number, decimals = 0): string | null {
		if (den <= 0) return null;
		return ((num / den) * 100).toFixed(decimals);
	}

	// Compact count for subtexts (34003 → 34k).
	function compact(n: number): string {
		if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
		return String(n);
	}

	// Exact, thousands-grouped count for the LaTeX breakdown (34003 → 34{,}003).
	// The `{,}` keeps KaTeX from typesetting the comma as a math punctuation gap.
	function fmt(n: number): string {
		return n.toLocaleString('en-US').replace(/,/g, '{,}');
	}

	// ── KPI hover breakdown (LaTeX) ───────────────────────────────────────────
	// Each calculated cell carries a `detail`: the symbolic formula and the same
	// formula with the live numbers substituted, both as LaTeX, plus an optional
	// note (data source / sample-floor caveat). Rendered on hover so the user can
	// see exactly how the headline number was reached and which values fed it.
	interface KpiDetail {
		label: string;
		texFormula: string;
		texValues: string;
		note?: string;
	}

	// Health / tool / heartbeat thresholds → sentiment colour. high% = healthy.
	function rampGood(p: string | null): string {
		if (p === null) return C.muted;
		const v = Number(p);
		return v >= 90 ? C.success : v >= 75 ? C.warning : C.destructive;
	}
	// error-style ramp: low% = healthy.
	function rampBad(p: string | null, warn = 5, bad = 15): string {
		if (p === null) return C.muted;
		const v = Number(p);
		return v <= warn ? C.success : v <= bad ? C.warning : C.destructive;
	}

	// Heartbeat / tool success need event-name granularity (absent from the server
	// summary). Unfiltered → prefer the fleet-accurate `activity` aggregate (it
	// bypasses the 2k raw-event cap); filtered → derive from the filtered set so the
	// cell tracks the current view.
	let heartbeatStat = $derived.by(() => {
		if (!hasActiveFilters && reliability.activity) {
			const h = reliability.activity.heartbeat;
			return { ok: h.ok, total: h.ok + h.failed };
		}
		let ok = 0, total = 0;
		for (const e of filteredEvents) {
			if (parseEventName(e.event).type !== 'heartbeat') continue;
			const mode = parseEventName(e.event).failureMode;
			if (mode === 'ok' || mode === 'failed') { total++; if (mode === 'ok') ok++; }
		}
		return { ok, total };
	});

	let toolStat = $derived.by(() => {
		if (!hasActiveFilters && reliability.activity) {
			const t = reliability.activity.tools;
			return { ok: t.ok, total: t.ok + t.err };
		}
		let ok = 0, total = 0;
		for (const e of filteredEvents) {
			if (e.event === 'exec.ok') { ok++; total++; }
			else if (e.event === 'exec.error') { total++; }
		}
		return { ok, total };
	});

	const statItems = $derived.by(() => {
		const sev = overviewStats.bySeverity;
		const cat = overviewStats.byCategory;
		const total = overviewStats.total;
		const crit = sev.critical ?? 0;
		const high = sev.high ?? 0;
		const med = sev.medium ?? 0;
		const info = sev.info ?? 0;
		const low = sev.low ?? 0;
		const fail = crit + high;
		const noise = info + low;

		// Dominant category within the current view.
		let topCatName = ''; let topCatCount = 0;
		for (const [k, v] of Object.entries(cat)) if (v > topCatCount) { topCatCount = v; topCatName = k; }

		// When a single category is pinned the "top category" cell is redundant
		// (always 100% that one) — swap it for the dominant failure-mode in view.
		const singleCategory = selectedCategories.size === 1;
		let topModeName = ''; let topModeCount = 0;
		if (singleCategory) {
			const counts = new Map<string, number>();
			for (const e of filteredEvents) {
				const md = parseEventName(e.event).failureMode;
				counts.set(md, (counts.get(md) ?? 0) + 1);
			}
			for (const [k, v] of counts) if (v > topModeCount) { topModeCount = v; topModeName = k; }
		}

		// Throughput — events per hour across the active range.
		const rangeHours = Math.max((reliability.dateRange.to - reliability.dateRange.from) / 3_600_000, 1 / 60);
		const rate = total / rangeHours;
		const rateStr = rate >= 100 ? compact(Math.round(rate)) : rate >= 10 ? String(Math.round(rate)) : rate.toFixed(1);

		const hb = heartbeatStat;
		const tl = toolStat;

		// Health Score = a weighted-severity score over ALL events, not an ok/fail
		// ratio. The gateway rarely emits `ok`-severity events (successes land as
		// `info`/`low`), so the old `ok ÷ (ok+high+crit)` collapsed to 0% the moment
		// any failure existed ("0 ok / 214 fail"). Instead we penalise each event by
		// its severity weight (critical hits hardest), so a stream that's mostly
		// info/low telemetry reads healthy and only sustained high/critical volume
		// drags it down. Weights are heuristic — the hover tooltip shows them in full.
		const HEALTH_MIN_SAMPLE = 5;
		const W_CRIT = 1, W_HIGH = 0.6, W_MED = 0.3;
		const healthPenalty = total > 0 ? (W_CRIT * crit + W_HIGH * high + W_MED * med) / total : 0;
		const healthScore = Math.max(0, Math.min(100, (1 - healthPenalty) * 100));
		const healthPct = total >= HEALTH_MIN_SAMPLE ? String(Math.round(healthScore)) : null;
		const errorPct = pct(fail, total);
		const critPct = pct(crit, total, crit > 0 && crit / Math.max(total, 1) < 0.01 ? 1 : 0);
		const noisePct = pct(noise, total);
		const hbPct = pct(hb.ok, hb.total);
		const toolPct = pct(tl.ok, tl.total);

		// LaTeX result token (percent or em-dash) for the hover breakdown.
		const resPct = (p: string | null) => (p === null ? '\\text{\\textemdash}' : `${p}\\%`);
		// Heartbeat / tool numbers come from the fleet aggregate when unfiltered, else
		// from the filtered event set — surface which, so the values are unambiguous.
		const dataSrc = !hasActiveFilters && reliability.activity ? m.reliability_tipFleet() : m.reliability_tipFiltered();
		const hbFailed = Math.max(hb.total - hb.ok, 0);
		const toolErr = Math.max(tl.total - tl.ok, 0);

		const concentration = singleCategory
			? {
				key: 'topmode', Icon: Layers, color: C.accent, label: m.reliability_kpiTopMode(),
				value: pct(topModeCount, total) ?? '—', unit: total ? '%' : '',
				subtext: topModeName ? `${topModeName} · ${compact(topModeCount)}` : '',
				detail: {
					label: m.reliability_kpiTopMode(),
					texFormula: '\\dfrac{\\text{events in top mode}}{\\text{total}}',
					texValues: `\\dfrac{${fmt(topModeCount)}}{${fmt(total)}} = ${resPct(pct(topModeCount, total))}`,
					note: topModeName ? `${m.reliability_flowMode()}: ${topModeName}` : undefined,
				} as KpiDetail,
			}
			: {
				key: 'topcat', Icon: Layers, color: CATEGORY_COLORS[topCatName] ?? C.accent, label: m.reliability_kpiTopCategory(),
				value: pct(topCatCount, total) ?? '—', unit: total ? '%' : '',
				subtext: topCatName ? `${topCatName} · ${compact(topCatCount)}` : '',
				detail: {
					label: m.reliability_kpiTopCategory(),
					texFormula: '\\dfrac{\\text{events in top category}}{\\text{total}}',
					texValues: `\\dfrac{${fmt(topCatCount)}}{${fmt(total)}} = ${resPct(pct(topCatCount, total))}`,
					note: topCatName ? `${m.reliability_flowCategory()}: ${topCatName}` : undefined,
				} as KpiDetail,
			};

		return [
			{
				key: 'health', Icon: Gauge, color: rampGood(healthPct), label: m.reliability_kpiHealth(),
				value: healthPct ?? '—', unit: healthPct ? '%' : '',
				subtext: total ? m.reliability_kpiHealthSub({ crit: compact(crit), high: compact(high), med: compact(med) }) : '',
				detail: {
					label: m.reliability_kpiHealth(),
					texFormula: '100\\left(1-\\dfrac{c+0.6h+0.3m}{N}\\right)',
					texValues: `100\\left(1-\\dfrac{${fmt(crit)}+0.6(${fmt(high)})+0.3(${fmt(med)})}{${fmt(total)}}\\right) = ${resPct(healthPct)}`,
					note: total < HEALTH_MIN_SAMPLE
						? m.reliability_tipSampleFloor({ n: HEALTH_MIN_SAMPLE })
						: m.reliability_tipWeights(),
				} as KpiDetail,
			},
			{
				key: 'error', Icon: TrendingDown, color: rampBad(errorPct), label: m.reliability_kpiErrorRate(),
				value: errorPct ?? '—', unit: errorPct ? '%' : '',
				subtext: total ? `${compact(fail)} ${m.reliability_kpiOfTotal({ total: compact(total) })}` : '',
				detail: {
					label: m.reliability_kpiErrorRate(),
					texFormula: '\\dfrac{\\text{high}+\\text{critical}}{\\text{total}}',
					texValues: `\\dfrac{${fmt(high)}+${fmt(crit)}}{${fmt(total)}} = ${resPct(errorPct)}`,
				} as KpiDetail,
			},
			{
				key: 'critical', Icon: AlertCircle, color: crit > 0 ? C.destructive : C.success, label: m.reliability_kpiCriticalRate(),
				value: critPct ?? '—', unit: critPct ? '%' : '',
				subtext: total ? compact(crit) : '',
				detail: {
					label: m.reliability_kpiCriticalRate(),
					texFormula: '\\dfrac{\\text{critical}}{\\text{total}}',
					texValues: `\\dfrac{${fmt(crit)}}{${fmt(total)}} = ${resPct(critPct)}`,
				} as KpiDetail,
			},
			{
				key: 'noise', Icon: Radio, color: C.muted, label: m.reliability_kpiNoise(),
				value: noisePct ?? '—', unit: noisePct ? '%' : '',
				subtext: total ? compact(noise) : '',
				detail: {
					label: m.reliability_kpiNoise(),
					texFormula: '\\dfrac{\\text{info}+\\text{low}}{\\text{total}}',
					texValues: `\\dfrac{${fmt(info)}+${fmt(low)}}{${fmt(total)}} = ${resPct(noisePct)}`,
				} as KpiDetail,
			},
			{
				key: 'heartbeat', Icon: HeartPulse, color: rampGood(hbPct), label: m.reliability_kpiHeartbeat(),
				value: hbPct ?? '—', unit: hbPct ? '%' : '',
				subtext: hb.total ? `${compact(hb.ok)}/${compact(hb.total)}` : '',
				detail: {
					label: m.reliability_kpiHeartbeat(),
					texFormula: '\\dfrac{\\text{ok}}{\\text{ok}+\\text{failed}}',
					texValues: `\\dfrac{${fmt(hb.ok)}}{${fmt(hb.ok)}+${fmt(hbFailed)}} = ${resPct(hbPct)}`,
					note: `${m.reliability_tipSource()}: ${dataSrc}`,
				} as KpiDetail,
			},
			{
				key: 'tool', Icon: Wrench, color: rampGood(toolPct), label: m.reliability_kpiToolSuccess(),
				value: toolPct ?? '—', unit: toolPct ? '%' : '',
				subtext: tl.total ? `${compact(tl.ok)}/${compact(tl.total)}` : '',
				detail: {
					label: m.reliability_kpiToolSuccess(),
					texFormula: '\\dfrac{\\text{exec.ok}}{\\text{exec.ok}+\\text{exec.error}}',
					texValues: `\\dfrac{${fmt(tl.ok)}}{${fmt(tl.ok)}+${fmt(toolErr)}} = ${resPct(toolPct)}`,
					note: `${m.reliability_tipSource()}: ${dataSrc}`,
				} as KpiDetail,
			},
			concentration,
			{
				key: 'rate', Icon: Zap, color: C.cyan, label: m.reliability_kpiEventRate(),
				value: total ? rateStr : '—', unit: total ? m.reliability_kpiPerHour() : '',
				subtext: total ? `${compact(total)}` : '',
				detail: {
					label: m.reliability_kpiEventRate(),
					texFormula: '\\dfrac{\\text{total events}}{\\text{range (hours)}}',
					texValues: `\\dfrac{${fmt(total)}}{${fmt(Math.round(rangeHours))}} = \\text{${rateStr}/hr}`,
					note: `${m.reliability_tipRange()}: ${m.reliability_tipHours({ h: Math.round(rangeHours) })}`,
				} as KpiDetail,
			},
		];
	});

	// ── KPI hover tooltip (fixed-position so the card's overflow-hidden can't clip it)
	let hoveredKpi = $state<KpiDetail | null>(null);
	let kpiTipPos = $state<{ left: number; top: number } | null>(null);
	let tipEl = $state<HTMLDivElement>();

	function showKpiTip(e: MouseEvent | FocusEvent, detail: KpiDetail | undefined) {
		if (!detail) return;
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		// Anchor below-left of the cell; the post-render effect re-clamps using the
		// tooltip's real (content-sized) width so a right-edge cell never overflows.
		kpiTipPos = { left: r.left, top: r.bottom + 6 };
		hoveredKpi = detail;
	}
	function hideKpiTip() {
		hoveredKpi = null;
		kpiTipPos = null;
	}

	// Clamp the content-sized tooltip into the viewport once it has a measurable
	// width (no fixed width → can't pre-compute in showKpiTip).
	$effect(() => {
		const p = kpiTipPos;
		if (!p || !hoveredKpi || !tipEl) return;
		const w = tipEl.offsetWidth;
		const left = Math.max(8, Math.min(p.left, window.innerWidth - w - 8));
		tipEl.style.left = `${left}px`;
	});

	async function loadData() {
		if (!serverId) return;
		const { from, to } = reliability.dateRange;
		await Promise.all([
			loadReliabilitySummary(serverId, from, to),
			loadReliabilityEvents(serverId, { from, to, limit: 10_000 }),
			loadReliabilityTimeline(from, to),
			loadReliabilityUsage(from, to),
			loadReliabilityActivity(from, to)
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

	// ── Event Flow ribbon (Sankey: mode → category → severity) ────────────────
	// A three-stage funnel from the most specific signal (failure mode) up through
	// the event's category into its severity, so you can trace how a noisy mode
	// fans out across the danger ramp. Built straight from filteredEvents → fully
	// reactive to the active filters. Modes are capped to the top N by volume (the
	// rest fold into an `other` node) so the ribbon stays legible. Nodes are
	// coloured by their own dimension: mode→its type colour, category→CATEGORY_COLORS,
	// severity→SEVERITY_COLORS (matches the timeline + donut palettes). The natural
	// midpoint between mode and severity is exactly the category column the user
	// asked for; `type` would duplicate category, so it's intentionally omitted.
	const FLOW_MODE_CAP = 12;

	let sankeyOptions: EChartsOption = $derived.by(() => {
		const evts = filteredEvents;
		if (evts.length === 0) return { backgroundColor: 'transparent', series: [] };

		// Rank modes by volume → decide which keep their own node.
		const modeTotals = new Map<string, number>();
		for (const e of evts) {
			const mode = parseEventName(e.event).failureMode;
			modeTotals.set(mode, (modeTotals.get(mode) ?? 0) + 1);
		}
		const topModes = new Set(
			[...modeTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, FLOW_MODE_CAP).map(([md]) => md),
		);
		const OTHER = m.reliability_flowOther();

		const modeType = new Map<string, string>();
		const mc = new Map<string, number>(); // mode ∥ cat → count
		const cs = new Map<string, number>(); // cat ∥ sev → count
		const modesUsed = new Set<string>();
		const catsUsed = new Set<string>();
		const sevsUsed = new Set<string>();

		for (const e of evts) {
			const { type, failureMode } = parseEventName(e.event);
			const mode = topModes.has(failureMode) ? failureMode : OTHER;
			if (mode !== OTHER && !modeType.has(mode)) modeType.set(mode, type);
			const cat = e.category || 'general';
			const sevKey = e.severity || 'info';
			modesUsed.add(mode); catsUsed.add(cat); sevsUsed.add(sevKey);
			mc.set(`${mode} ${cat}`, (mc.get(`${mode} ${cat}`) ?? 0) + 1);
			cs.set(`${cat} ${sevKey}`, (cs.get(`${cat} ${sevKey}`) ?? 0) + 1);
		}

		// Prefix node ids per column so a label shared across columns never merges.
		const nodes: Array<{ name: string; itemStyle: { color: string }; label?: { position: 'left' | 'right' } }> = [];
		const seen = new Set<string>();
		const addNode = (id: string, color: string, position: 'left' | 'right') => {
			if (seen.has(id)) return; seen.add(id);
			nodes.push({ name: id, itemStyle: { color }, label: { position } });
		};
		// Mode labels sit to the LEFT of the first column (clear of the ribbons);
		// category + severity labels to the right of their bars.
		for (const mode of modesUsed) {
			const color = mode === OTHER ? '#52525b' : (CATEGORY_COLORS[modeType.get(mode) ?? ''] ?? '#3b82f6');
			addNode(`m:${mode}`, color, 'left');
		}
		for (const cat of catsUsed) addNode(`c:${cat}`, CATEGORY_COLORS[cat] ?? '#94a3b8', 'right');
		for (const sevKey of sevsUsed) addNode(`s:${sevKey}`, SEVERITY_COLORS[sevKey] ?? '#64748b', 'right');

		const links: Array<{ source: string; target: string; value: number }> = [];
		for (const [k, v] of mc) { const [mode, cat] = k.split(' '); links.push({ source: `m:${mode}`, target: `c:${cat}`, value: v }); }
		for (const [k, v] of cs) { const [cat, sevKey] = k.split(' '); links.push({ source: `c:${cat}`, target: `s:${sevKey}`, value: v }); }

		return {
			backgroundColor: 'transparent',
			tooltip: {
				trigger: 'item',
				formatter: (p: any) => {
					if (p.dataType === 'edge') {
						const s = String(p.data.source).slice(2);
						const t = String(p.data.target).slice(2);
						return `<div style="font-size:11px"><span style="color:var(--color-muted-foreground)">${s}</span> → <span style="font-weight:600">${t}</span><div style="font-weight:600;margin-top:2px">${p.data.value}</div></div>`;
					}
					return `<div style="font-size:11px;font-weight:600">${String(p.name).slice(2)}</div>`;
				},
			},
			series: [{
				type: 'sankey',
				left: 150, right: 70, top: 14, bottom: 14,
				nodeWidth: 13,
				nodeGap: 7,
				draggable: false,
				emphasis: { focus: 'adjacency' },
				layoutIterations: 32,
				nodeAlign: 'justify',
				data: nodes,
				links,
				label: {
					fontSize: 10,
					color: getCSSVar('--color-foreground', '#fafafa'),
					formatter: (p: any) => String(p.name).slice(2),
				},
				lineStyle: { color: 'gradient', opacity: 0.32, curveness: 0.5 },
			}],
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
	<!-- Tab bar + filter bar (tabs first, filters below — order: severity, category, mode) -->
	<div class="shrink-0 relative z-30 border-b border-border bg-bg2/80 backdrop-blur-sm">
		<Tabs
			tabs={tabItems}
			value={activeTab}
			size="sm"
			class="px-4 border-b-0"
			aria-label={m.reliability_title()}
			onValueChange={handleTabChange}
		/>
		{#if summary}
			<div class="flex items-center gap-2 flex-wrap px-4 pt-2 pb-2.5 border-t border-border/60">
				<MultiSelectFilter
					label={m.reliability_severity()}
					options={severityFilterOptions}
					selected={selectedSeverities}
					onToggle={toggleSeverity}
					onClear={() => { selectedSeverities = new Set(); persistFilters(); }}
					allLabel={m.reliability_filterAll()}
				/>
				<MultiSelectFilter
					label={m.reliability_category()}
					options={categoryFilterOptions}
					selected={selectedCategories}
					onToggle={toggleCategory}
					onClear={() => { selectedCategories = new Set(); persistFilters(); }}
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
						<div
							class="relative px-5 pt-4 pb-4 flex flex-col gap-1.5 cursor-help transition-colors hover:bg-bg3/30 focus-visible:bg-bg3/30 outline-none"
							role="button"
							tabindex="0"
							aria-label={item.detail ? `${item.label}: ${item.value}${item.unit}` : undefined}
							onmouseenter={(e) => showKpiTip(e, item.detail)}
							onmouseleave={hideKpiTip}
							onfocus={(e) => showKpiTip(e, item.detail)}
							onblur={hideKpiTip}
						>
							<!-- Colored top accent stripe -->
							<div class="absolute top-0 left-0 right-0 h-[2px]" style:background={item.color}></div>
							<div class="flex items-center gap-1.5 mt-0.5">
								<span style:color={item.color} class="shrink-0 flex"><Icon size={10} /></span>
								<span class="text-[9px] font-semibold text-muted-foreground uppercase tracking-widest truncate">{item.label}</span>
							</div>
							<div class="flex items-baseline gap-0.5">
								<span class="text-[2rem] font-bold font-mono tabular-nums leading-none tracking-tight" style:color={item.color}>
									{item.value}
								</span>
								{#if item.unit}
									<span class="text-sm font-semibold text-muted-foreground leading-none">{item.unit}</span>
								{/if}
							</div>
							<span class="text-[9px] text-muted-strong tabular-nums truncate min-h-[12px]">{item.subtext}</span>
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

			<!-- ── Event Flow ribbon (Sankey: mode → category → severity) ──────── -->
			<div class="bg-card border border-border rounded-lg overflow-hidden">
				<div class="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg3/20">
					<GitMerge size={11} class="text-accent shrink-0" />
					<span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{m.reliability_eventFlow()}</span>
					<!-- Column legend: the three stages the ribbon funnels through -->
					<div class="ml-auto flex items-center gap-3 text-[9px] font-medium text-muted-strong">
						<span>{m.reliability_flowMode()}</span>
						<span class="text-muted-foreground">→</span>
						<span>{m.reliability_flowCategory()}</span>
						<span class="text-muted-foreground">→</span>
						<span>{m.reliability_flowSeverity()}</span>
					</div>
				</div>
				<div class="relative overflow-hidden">
					<ScanLine speed={12} opacity={0.018} />
					<Chart options={sankeyOptions} height="380px" />
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
			<!-- ── Agents & LLM: token cost + origin analytics + agent-activity log ── -->
			<AgentLlmAnalytics
				events={filteredEvents}
				aggregate={reliability.usage}
				activity={reliability.activity}
			/>
			{:else if activeTab === 'plugins'}
			<!-- ── Plugin Health (one section + KPI widgets per installed plugin) ── -->
			<PluginHealthPanel {serverId} from={reliability.dateRange.from} to={reliability.dateRange.to} />
			{/if}
		</div>
		{/if}
	</main>

	<!-- ── KPI hover breakdown tooltip (fixed → escapes card overflow clipping) ── -->
	{#if hoveredKpi && kpiTipPos}
		<div
			bind:this={tipEl}
			class="fixed z-[100] pointer-events-none w-max max-w-[90vw] rounded-lg border border-border bg-bg2 shadow-[0_8px_28px_rgba(0,0,0,0.55)] px-3 py-2.5"
			style="left:{kpiTipPos.left}px; top:{kpiTipPos.top}px"
		>
			<div class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">{hoveredKpi.label}</div>
			<div class="text-[10px] text-muted-strong uppercase tracking-wide mb-0.5">{m.reliability_tipFormula()}</div>
			<div class="text-foreground text-[13px] mb-2"><MathFormula tex={hoveredKpi.texFormula} /></div>
			<div class="text-[10px] text-muted-strong uppercase tracking-wide mb-0.5">{m.reliability_tipResult()}</div>
			<div class="text-foreground text-[13px]"><MathFormula tex={hoveredKpi.texValues} /></div>
			{#if hoveredKpi.note}
				<div class="mt-2 pt-1.5 border-t border-border/60 text-[9px] text-muted-strong leading-snug whitespace-normal max-w-[240px]">{hoveredKpi.note}</div>
			{/if}
		</div>
	{/if}
