<script lang="ts">
  import { Button } from '$lib/components/ui';
	import { Cpu, DollarSign, X, Radio, Zap } from 'lucide-svelte';
	import * as m from '$lib/paraglide/messages';
	import PanelHeader from './PanelHeader.svelte';
	import MetricCard from './MetricCard.svelte';
	import ActivityLogTable from './ActivityLogTable.svelte';
	import AgentActivityPanel from './AgentActivityPanel.svelte';
	import Chart from '$lib/components/charts/Chart.svelte';
	import type { EChartsOption } from 'echarts';
	import type {
		ReliabilityEvent,
		UsageAggregate,
		ActivityAggregate,
	} from '$lib/state/reliability/reliability.svelte';
	import {
		estimateCostUsd,
		isModelPriced,
		formatUsd,
		formatMoney,
		pickMoneyUnit,
	} from '$lib/utils/model-pricing';
	import { deriveOrigin } from '$lib/utils/event-origin';
	import { chartColors } from '$lib/utils/chart-colors';

	let {
		events = [],
		aggregate = null,
		activity = null,
	}: {
		events: ReliabilityEvent[];
		aggregate?: UsageAggregate | null;
		activity?: ActivityAggregate | null;
	} = $props();

	// Prefer the server-side aggregate (full coverage, no 2,000-event cap) when the
	// gateway provides it; otherwise derive from the loaded (capped) events.
	let usingAggregate = $derived(!!(aggregate && aggregate.buckets.length));

	// Cost (USD) vs raw token-count view for every breakdown.
	let metric = $state<'cost' | 'tokens'>('cost');

	// ── Parsing ──────────────────────────────────────────────────────────────
	function parseMetadata(raw: unknown): Record<string, unknown> | null {
		if (raw == null) return null;
		if (typeof raw === 'string') {
			try {
				return JSON.parse(raw);
			} catch {
				return null;
			}
		}
		if (typeof raw === 'object') return raw as Record<string, unknown>;
		return null;
	}

	function num(v: unknown): number {
		return typeof v === 'number' && Number.isFinite(v) ? v : 0;
	}

	function str(v: unknown): string | undefined {
		return typeof v === 'string' && v.trim() ? v : undefined;
	}

	function fmt(n: number): string {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`;
		return n.toLocaleString('en-US');
	}

	interface UsageRow {
		ts: number;
		agentId: string;
		provider: string;
		model: string;
		channel: string;
		source: string;
		input: number;
		output: number;
		cacheRead: number;
		total: number;
		cost: number;
		calls: number;
		priced: boolean;
	}

	let rows = $derived.by((): UsageRow[] => {
		// Aggregate mode: one pre-summed row per origin/model combo (full coverage).
		if (aggregate && aggregate.buckets.length) {
			return aggregate.buckets.map((b) => ({
				ts: 0,
				agentId: b.agentId,
				provider: b.provider,
				model: b.model,
				channel: b.channel,
				source: b.source,
				input: b.input,
				output: b.output,
				cacheRead: b.cacheRead,
				total: b.total,
				cost: b.costMicroUsd / 1_000_000,
				calls: b.calls,
				priced: b.costMicroUsd > 0,
			}));
		}
		// Event mode: derive one row per agent.llm.usage event (capped at ~2k).
		const out: UsageRow[] = [];
		for (const evt of events) {
			if (evt.event !== 'agent.llm.usage') continue;
			const meta = parseMetadata(evt.metadata);
			if (!meta) continue;
			const tokens = (meta.tokens as Record<string, unknown> | undefined) ?? {};
			const input = num(tokens.input);
			const output = num(tokens.output);
			const cacheRead = num(tokens.cacheRead);
			const total = num(tokens.total) || input + output + cacheRead;
			const model = str(meta.model) ?? 'unknown';
			// Prefer gateway-stamped origin; else derive from the session key.
			const origin = deriveOrigin(evt.correlationId, str(meta.channel), str(meta.source));
			out.push({
				ts: evt.timestamp,
				agentId: evt.agentId ?? str(meta.agentId) ?? 'unknown',
				provider: str(meta.provider) ?? 'unknown',
				model,
				channel: origin.channel,
				source: origin.source,
				input,
				output,
				cacheRead,
				total,
				cost: estimateCostUsd(model, input, output, cacheRead),
				calls: 1,
				priced: isModelPriced(model),
			});
		}
		return out;
	});

	// ── Cross-filter state ─────────────────────────────────────────────────────
	type Dim = 'provider' | 'model' | 'channel' | 'source' | 'agent';
	let filters = $state<Partial<Record<Dim, string>>>({});

	function toggleFilter(dim: Dim, value: string | undefined) {
		if (!value) return;
		const next = { ...filters };
		if (next[dim] === value) delete next[dim];
		else next[dim] = value;
		filters = next;
	}
	function clearFilter(dim: Dim) {
		const next = { ...filters };
		delete next[dim];
		filters = next;
	}
	function clearAll() {
		filters = {};
	}
	let activeFilters = $derived(Object.entries(filters) as [Dim, string][]);

	function rowMatches(r: UsageRow): boolean {
		if (filters.provider && r.provider !== filters.provider) return false;
		if (filters.model && r.model !== filters.model) return false;
		if (filters.channel && r.channel !== filters.channel) return false;
		if (filters.source && r.source !== filters.source) return false;
		if (filters.agent && r.agentId !== filters.agent) return false;
		return true;
	}

	let filteredRows = $derived(rows.filter(rowMatches));

	// ── Aggregations ────────────────────────────────────────────────────────────
	interface Agg {
		key: string;
		cost: number;
		total: number;
		input: number;
		output: number;
		cacheRead: number;
		calls: number;
	}

	function metricValue(a: Agg): number {
		return metric === 'cost' ? a.cost : a.total;
	}

	function aggregateBy(by: (r: UsageRow) => string): Agg[] {
		const map = new Map<string, Agg>();
		for (const r of filteredRows) {
			const k = by(r);
			let e = map.get(k);
			if (!e) {
				e = { key: k, cost: 0, total: 0, input: 0, output: 0, cacheRead: 0, calls: 0 };
				map.set(k, e);
			}
			e.cost += r.cost;
			e.total += r.total;
			e.input += r.input;
			e.output += r.output;
			e.cacheRead += r.cacheRead;
			e.calls += r.calls;
		}
		return [...map.values()].sort((a, b) => metricValue(b) - metricValue(a));
	}

	let summary = $derived.by(() => {
		let input = 0,
			output = 0,
			cacheRead = 0,
			total = 0,
			cost = 0,
			unpriced = 0,
			calls = 0;
		const models = new Set<string>();
		for (const r of filteredRows) {
			input += r.input;
			output += r.output;
			cacheRead += r.cacheRead;
			total += r.total;
			cost += r.cost;
			calls += r.calls;
			models.add(r.model);
			if (!r.priced) unpriced += r.calls;
		}
		return {
			input,
			output,
			cacheRead,
			total,
			cost,
			callCount: calls,
			uniqueModels: models.size,
			unpriced,
			avgCost: calls ? cost / calls : 0,
		};
	});

	let byModel = $derived(aggregateBy((r) => r.model).slice(0, 12));
	let byProvider = $derived(aggregateBy((r) => r.provider));
	let byChannel = $derived(aggregateBy((r) => r.channel).slice(0, 12));
	let bySource = $derived(aggregateBy((r) => r.source));
	let byAgent = $derived(aggregateBy((r) => r.agentId).slice(0, 12));

	// ── Over time (adaptive bucketing into ~32 buckets) ──────────────────────────
	let overTime = $derived.by(() => {
		// Aggregate mode: use the server-side timeline (full coverage). It is global
		// (un-cross-filtered); hide it when a filter is active to avoid implying it
		// reflects the filter.
		if (aggregate && aggregate.timeline.length) {
			if (activeFilters.length > 0) return { points: [] as [number, number][] };
			return {
				points: aggregate.timeline.map(
					(p) => [p.t, metric === 'cost' ? p.costMicroUsd / 1_000_000 : p.total] as [number, number],
				),
			};
		}
		if (usingAggregate) return { points: [] as [number, number][] };
		if (filteredRows.length === 0) return { points: [] as [number, number][] };
		let min = Infinity,
			max = -Infinity;
		for (const r of filteredRows) {
			if (r.ts < min) min = r.ts;
			if (r.ts > max) max = r.ts;
		}
		const span = Math.max(max - min, 60_000);
		const bucketMs = Math.max(Math.ceil(span / 32), 60_000);
		const map = new Map<number, number>();
		for (const r of filteredRows) {
			const b = Math.floor(r.ts / bucketMs) * bucketMs;
			map.set(b, (map.get(b) ?? 0) + (metric === 'cost' ? r.cost : r.total));
		}
		const points = [...map.entries()].sort((a, b) => a[0] - b[0]) as [number, number][];
		return { points };
	});

	// ── Value formatting (consistent unit per chart; never mixes $ and ¢) ────────
	function valueFormatter(maxValue: number): (v: number) => string {
		if (metric === 'tokens') return (v: number) => fmt(v);
		const unit = pickMoneyUnit(maxValue);
		return (v: number) => formatMoney(v, unit);
	}

	// Resolved from theme tokens at build time so charts recolor with the active
	// theme instead of freezing to one hardcoded palette.
	let palette = $derived(chartColors());
	let ACCENT = $derived(palette.accent);
	let sourceColors = $derived<Record<string, string>>({
		channel: palette.cyan,
		system: palette.pink,
		agent: palette.purple,
		unknown: palette.neutral,
	});

	function hBar(data: Agg[], color: string): EChartsOption {
		const values = data.map(metricValue);
		const max = values.length ? Math.max(...values) : 0;
		const f = valueFormatter(max);
		return {
			backgroundColor: 'transparent',
			tooltip: {
				trigger: 'axis',
				axisPointer: { type: 'shadow' },
				valueFormatter: (v: unknown) => f(num(v)),
			},
			grid: { left: 110, right: 52, top: 8, bottom: 24 },
			xAxis: { type: 'value', axisLabel: { fontSize: 10, formatter: (v: number) => f(v) } },
			yAxis: {
				type: 'category',
				data: data.map((d) => d.key),
				inverse: true,
				axisLabel: { fontSize: 10, width: 92, overflow: 'truncate' },
			},
			series: [
				{
					type: 'bar',
					barMaxWidth: 16,
					itemStyle: { color },
					data: values,
					label: {
						show: true,
						position: 'right',
						fontSize: 9,
						color: 'var(--color-muted-foreground)',
						formatter: (p: { value?: unknown }) => f(num(p.value)),
					},
				},
			],
		};
	}

	let modelChart = $derived(hBar(byModel, ACCENT));
	let channelChart = $derived(hBar(byChannel, palette.cyan));
	let agentChart = $derived(hBar(byAgent, palette.pink));

	// Provider chart stays a token-type breakdown (input/output/cache) regardless of
	// the cost/tokens toggle — that distinction only exists for tokens.
	let providerTokenChart: EChartsOption = $derived.by(() => ({
		backgroundColor: 'transparent',
		tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
		legend: { top: 0, textStyle: { fontSize: 10 } },
		grid: { left: 100, right: 24, top: 32, bottom: 24 },
		xAxis: { type: 'value', axisLabel: { fontSize: 10, formatter: (v: number) => fmt(v) } },
		yAxis: {
			type: 'category',
			data: byProvider.map((p) => p.key),
			inverse: true,
			axisLabel: { fontSize: 10, width: 80, overflow: 'truncate' },
		},
		series: [
			{
				name: m.reliability_inputTokens(),
				type: 'bar',
				stack: 'tokens',
				barMaxWidth: 16,
				itemStyle: { color: palette.info },
				data: byProvider.map((p) => p.input),
			},
			{
				name: m.reliability_outputTokens(),
				type: 'bar',
				stack: 'tokens',
				barMaxWidth: 16,
				itemStyle: { color: palette.warning },
				data: byProvider.map((p) => p.output),
			},
			{
				name: m.reliability_cacheRead(),
				type: 'bar',
				stack: 'tokens',
				barMaxWidth: 16,
				itemStyle: { color: palette.emerald },
				data: byProvider.map((p) => p.cacheRead),
			},
		],
	}));

	let sourceChart: EChartsOption = $derived.by(() => {
		const f = valueFormatter(bySource.length ? Math.max(...bySource.map(metricValue)) : 0);
		return {
			backgroundColor: 'transparent',
			tooltip: { trigger: 'item', valueFormatter: (v: unknown) => f(num(v)) },
			legend: { bottom: 0, left: 'center', textStyle: { fontSize: 10 } },
			series: [
				{
					type: 'pie',
					radius: ['45%', '70%'],
					center: ['50%', '44%'],
					avoidLabelOverlap: true,
					itemStyle: { borderColor: 'var(--color-bg2)', borderWidth: 2 },
					label: { show: false },
					data: bySource.map((s) => ({
						name: s.key,
						value: metricValue(s),
						itemStyle: { color: sourceColors[s.key] ?? palette.neutral },
					})),
				},
			],
		};
	});

	let overTimeChart: EChartsOption = $derived.by(() => {
		const f = valueFormatter(overTime.points.length ? Math.max(...overTime.points.map((p) => p[1])) : 0);
		return {
			backgroundColor: 'transparent',
			tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => f(num(v)) },
			grid: { left: 56, right: 20, top: 16, bottom: 28 },
			xAxis: {
				type: 'time',
				axisLabel: {
					fontSize: 9,
					formatter: (value: number) => {
						const d = new Date(value);
						return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:00`;
					},
				},
				axisTick: { show: false },
				splitLine: { show: false },
			},
			yAxis: {
				type: 'value',
				axisLabel: { fontSize: 9, formatter: (v: number) => f(v) },
				splitLine: { lineStyle: { opacity: 0.08 } },
			},
			series: [
				{
					type: 'line',
					smooth: true,
					symbol: 'none',
					lineStyle: { color: ACCENT, width: 2 },
					areaStyle: { color: ACCENT, opacity: 0.15 },
					data: overTime.points,
				},
			],
		};
	});

	function onBarClick(dim: Dim) {
		return (params: unknown) => {
			const name = (params as { name?: string })?.name;
			if (name) toggleFilter(dim, name);
		};
	}

	// ── Agent-activity log (memory / heartbeat / tool / agent / skill) ──────────
	const ACTIVITY_CATEGORIES = ['all', 'agent', 'memory', 'heartbeat', 'tool', 'skill'];
	let agentActivityEvents = $derived.by(() => {
		const cats = new Set(ACTIVITY_CATEGORIES.slice(1));
		return events.filter((e) => {
			if (!cats.has(e.category)) return false;
			if (filters.agent && e.agentId !== filters.agent) return false;
			return true;
		});
	});
</script>

<div class="flex flex-col gap-3">
	<!-- ── COST + ORIGIN ANALYTICS ───────────────────────────────────────────── -->
	<div class="surface-2 rounded-lg overflow-hidden">
		<PanelHeader label={m.reliability_llmMetrics()} labelClass="flex-1">
			{#snippet icon()}
				<Cpu size={11} class="text-accent shrink-0" />
			{/snippet}
			{#snippet actions()}
				<!-- Cost ⟷ Tokens toggle -->
				<div class="flex items-center rounded-md border border-border overflow-hidden h-6">
					<Button
						type="button"
						onclick={() => (metric = 'cost')}
						variant={metric === 'cost' ? 'primary' : 'secondary'}
						size="sm"
						class="!h-full"
						aria-pressed={metric === 'cost'}
					>
						Cost
					</Button>
					<Button
						type="button"
						onclick={() => (metric = 'tokens')}
						variant={metric === 'tokens' ? 'primary' : 'secondary'}
						size="sm"
						class="!h-full"
						aria-pressed={metric === 'tokens'}
					>
						Tokens
					</Button>
				</div>
				<span class="text-xs text-muted-strong tabular-nums ml-2">
					{summary.callCount}
					{summary.callCount !== 1 ? m.reliability_llmCallsPlural() : m.reliability_llmCall()}
				</span>
			{/snippet}
		</PanelHeader>

		{#if rows.length === 0}
			<div class="flex items-center justify-center py-8 text-muted-foreground text-sm">
				{m.reliability_noLlmData()}
			</div>
		{:else}
			{#if activeFilters.length > 0}
				<div class="flex items-center gap-1.5 flex-wrap px-4 py-2 border-b border-border bg-bg3/20">
					<span class="text-xs uppercase tracking-widest text-muted-strong">Filtered</span>
					{#each activeFilters as [dim, val] (dim)}
						<Button variant="outline" size="sm"
							type="button"
							onclick={() => clearFilter(dim)}
							class="rounded-full"
							aria-label={`Clear ${dim} filter ${val}`}
						>
							<span class="opacity-70">{dim}:</span>
							<span class="font-semibold">{val}</span>
							<X size={10} class="opacity-70" />
						</Button>
					{/each}
					<Button variant="ghost" size="sm"
						type="button"
						onclick={clearAll}
						class="underline-offset-2 hover:underline ml-1"
					>
						Clear all
					</Button>
				</div>
			{/if}

			<!-- Summary cards (always show cost in USD + token totals) -->
			<div class="grid grid-cols-2 md:grid-cols-5 gap-px bg-border border-b border-border">
				<MetricCard label="Est. cost (USD)" value={formatUsd(summary.cost)} valueClass="text-success tabular-nums" />
				<MetricCard label={m.reliability_totalTokens()} value={fmt(summary.total)} valueClass="text-foreground tabular-nums" />
				<MetricCard label={m.reliability_inputTokens()} value={fmt(summary.input)} valueClass="text-foreground tabular-nums" />
				<MetricCard label={m.reliability_outputTokens()} value={fmt(summary.output)} valueClass="text-foreground tabular-nums" />
				<MetricCard label="Avg cost / call (USD)" value={formatUsd(summary.avgCost)} valueClass="text-foreground tabular-nums" />
			</div>

			<p class="px-4 pt-1.5 text-xs text-muted-strong">
				{#if usingAggregate}
					Full coverage · {fmt(aggregate?.eventCount ?? 0)} usage events aggregated server-side · costs in USD.
				{:else}
					Recent events only (gateway predates usage aggregation) — totals may undercount older traffic.
				{/if}
			</p>

			{#if summary.unpriced > 0}
				<p class="px-4 pt-1 text-xs text-muted-strong">
					{summary.unpriced} call{summary.unpriced !== 1 ? 's' : ''} on unpriced/local models — excluded from cost (tokens still counted).
				</p>
			{/if}

			<!-- Breakdown charts. Click any bar / slice to cross-filter every chart + the log. -->
			<div class="grid grid-cols-1 lg:grid-cols-2 gap-px bg-border border-b border-border">
				<div class="bg-bg2 p-1">
					<div class="flex items-center gap-1.5 px-3 pt-2 pb-1">
						<DollarSign size={11} class="text-accent" />
						<span class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{metric === 'cost' ? 'Cost' : 'Tokens'} by model</span>
					</div>
					{#if byModel.length > 0}
						<Chart options={modelChart} height="200px" onItemClick={onBarClick('model')} />
					{:else}
						<div class="flex items-center justify-center h-[200px] text-muted-strong text-xs">No data</div>
					{/if}
				</div>

				<div class="bg-bg2 p-1">
					<div class="flex items-center gap-1.5 px-3 pt-2 pb-1">
						<Radio size={11} class="text-[var(--color-cyan)]" />
						<span class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{metric === 'cost' ? 'Cost' : 'Tokens'} by channel / origin</span>
					</div>
					{#if byChannel.length > 0}
						<Chart options={channelChart} height="200px" onItemClick={onBarClick('channel')} />
					{:else}
						<div class="flex items-center justify-center h-[200px] text-muted-strong text-xs">No data</div>
					{/if}
				</div>

				<div class="bg-bg2 p-1">
					<div class="flex items-center gap-1.5 px-3 pt-2 pb-1">
						<Cpu size={11} class="text-accent" />
						<span class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Tokens by provider</span>
					</div>
					{#if byProvider.length > 0}
						<Chart options={providerTokenChart} height="200px" onItemClick={onBarClick('provider')} />
					{:else}
						<div class="flex items-center justify-center h-[200px] text-muted-strong text-xs">No data</div>
					{/if}
				</div>

				<div class="bg-bg2 p-1">
					<div class="flex items-center gap-1.5 px-3 pt-2 pb-1">
						<Zap size={11} class="text-destructive" />
						<span class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{metric === 'cost' ? 'Cost' : 'Tokens'} by trigger (proactive vs reactive)</span>
					</div>
					{#if bySource.length > 0}
						<Chart options={sourceChart} height="200px" onItemClick={onBarClick('source')} />
					{:else}
						<div class="flex items-center justify-center h-[200px] text-muted-strong text-xs">No data</div>
					{/if}
				</div>

				<div class="bg-bg2 p-1">
					<div class="flex items-center gap-1.5 px-3 pt-2 pb-1">
						<DollarSign size={11} class="text-[var(--color-pink)]" />
						<span class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{metric === 'cost' ? 'Cost' : 'Tokens'} by agent</span>
					</div>
					{#if byAgent.length > 0}
						<Chart options={agentChart} height="200px" onItemClick={onBarClick('agent')} />
					{:else}
						<div class="flex items-center justify-center h-[200px] text-muted-strong text-xs">No data</div>
					{/if}
				</div>

				<div class="bg-bg2 p-1">
					<div class="flex items-center gap-1.5 px-3 pt-2 pb-1">
						<DollarSign size={11} class="text-accent" />
						<span class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{metric === 'cost' ? 'Cost' : 'Tokens'} over time</span>
					</div>
					{#if overTime.points.length > 0}
						<Chart options={overTimeChart} height="200px" />
					{:else}
						<div class="flex items-center justify-center h-[200px] text-muted-strong text-xs">No data</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>

	<!-- ── AGENT ACTIVITY (memory / heartbeat / proactivity / tools) ──────────── -->
	<AgentActivityPanel {events} {activity} agentFilter={filters.agent} />

	<!-- ── AGENT ACTIVITY LOG ─────────────────────────────────────────────────── -->
	<ActivityLogTable
		events={agentActivityEvents}
		categories={ACTIVITY_CATEGORIES}
		title="Agent Activity"
		icon={Zap}
		emptyMessage="No agent activity recorded yet — memory writes, heartbeats and tool calls will appear here."
	/>
</div>
