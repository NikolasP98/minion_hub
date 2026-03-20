<script lang="ts">
	import { Cpu } from 'lucide-svelte';
	import Chart from '$lib/components/charts/Chart.svelte';
	import type { EChartsOption } from 'echarts';
	import type { ReliabilityEvent } from '$lib/state/reliability/reliability.svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';

	let { events = [] }: { events: ReliabilityEvent[] } = $props();

	// ── Helpers ──────────────────────────────────────────────────────────────

	interface TokenData {
		input: number;
		output: number;
		cacheRead: number;
		total: number;
	}

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

	function parseTokens(meta: Record<string, unknown>): TokenData {
		const tokens = meta.tokens as Record<string, unknown> | undefined;
		if (!tokens || typeof tokens !== 'object') return { input: 0, output: 0, cacheRead: 0, total: 0 };
		return {
			input: typeof tokens.input === 'number' ? tokens.input : 0,
			output: typeof tokens.output === 'number' ? tokens.output : 0,
			cacheRead: typeof tokens.cacheRead === 'number' ? tokens.cacheRead : 0,
			total: typeof tokens.total === 'number' ? tokens.total : 0,
		};
	}

	function fmt(n: number): string {
		return n.toLocaleString('en-US');
	}

	// ── Filtered events ─────────────────────────────────────────────────────

	let llmEvents = $derived.by(() => {
		return events.filter((evt) => evt.event === 'agent.llm.usage');
	});

	// ── Summary stats ───────────────────────────────────────────────────────

	let summary = $derived.by(() => {
		let input = 0;
		let output = 0;
		let cacheRead = 0;
		let total = 0;
		const models = new SvelteSet<string>();

		for (const evt of llmEvents) {
			const meta = parseMetadata(evt.metadata);
			if (!meta) continue;
			const tokens = parseTokens(meta);
			input += tokens.input;
			output += tokens.output;
			cacheRead += tokens.cacheRead;
			total += tokens.total;
			if (typeof meta.model === 'string') models.add(meta.model);
		}

		return { input, output, cacheRead, total, callCount: llmEvents.length, uniqueModels: models.size };
	});

	// ── By provider (with per-token-type breakdown) ─────────────────────────

	interface ProviderAgg {
		provider: string;
		input: number;
		output: number;
		cacheRead: number;
		total: number;
	}

	let byProvider = $derived.by((): ProviderAgg[] => {
		const map = new SvelteMap<string, ProviderAgg>();

		for (const evt of llmEvents) {
			const meta = parseMetadata(evt.metadata);
			if (!meta) continue;
			const provider = typeof meta.provider === 'string' ? meta.provider : 'unknown';
			const tokens = parseTokens(meta);
			let entry = map.get(provider);
			if (!entry) {
				entry = { provider, input: 0, output: 0, cacheRead: 0, total: 0 };
				map.set(provider, entry);
			}
			entry.input += tokens.input;
			entry.output += tokens.output;
			entry.cacheRead += tokens.cacheRead;
			entry.total += tokens.total;
		}

		return [...map.values()].sort((a, b) => b.total - a.total);
	});

	// ── By agent ────────────────────────────────────────────────────────────

	interface AgentAgg {
		agentId: string;
		total: number;
	}

	let byAgent = $derived.by((): AgentAgg[] => {
		const map = new SvelteMap<string, number>();

		for (const evt of llmEvents) {
			const meta = parseMetadata(evt.metadata);
			if (!meta) continue;
			const agentId = evt.agentId ?? 'unknown';
			const tokens = parseTokens(meta);
			map.set(agentId, (map.get(agentId) ?? 0) + tokens.total);
		}

		return [...map.entries()]
			.map(([agentId, total]) => ({ agentId, total }))
			.sort((a, b) => b.total - a.total)
			.slice(0, 10);
	});

	// ── ECharts: Tokens by Provider (stacked horizontal bar) ────────────────

	let providerChartOptions: EChartsOption = $derived.by(() => {
		const providers = byProvider.map((p) => p.provider);

		return {
			backgroundColor: 'transparent',
			tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
			legend: {
				top: 0,
				textStyle: { fontSize: 10 },
			},
			grid: { left: 100, right: 24, top: 32, bottom: 24 },
			xAxis: { type: 'value', axisLabel: { fontSize: 10 } },
			yAxis: {
				type: 'category',
				data: providers,
				inverse: true,
				axisLabel: { fontSize: 10, width: 80, overflow: 'truncate' },
			},
			series: [
				{
					name: 'Input',
					type: 'bar',
					stack: 'tokens',
					barMaxWidth: 16,
					itemStyle: { color: '#3b82f6' },
					data: byProvider.map((p) => p.input),
				},
				{
					name: 'Output',
					type: 'bar',
					stack: 'tokens',
					barMaxWidth: 16,
					itemStyle: { color: '#f59e0b' },
					data: byProvider.map((p) => p.output),
				},
				{
					name: 'Cache Read',
					type: 'bar',
					stack: 'tokens',
					barMaxWidth: 16,
					itemStyle: { color: '#10b981' },
					data: byProvider.map((p) => p.cacheRead),
				},
			],
		};
	});

	// ── ECharts: Tokens by Agent (horizontal bar) ───────────────────────────

	let agentChartOptions: EChartsOption = $derived.by(() => {
		const agents = byAgent.map((a) => a.agentId);

		return {
			backgroundColor: 'transparent',
			tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
			grid: { left: 100, right: 24, top: 8, bottom: 24 },
			xAxis: { type: 'value', axisLabel: { fontSize: 10 } },
			yAxis: {
				type: 'category',
				data: agents,
				inverse: true,
				axisLabel: { fontSize: 10, width: 80, overflow: 'truncate' },
			},
			series: [
				{
					name: 'Total Tokens',
					type: 'bar',
					barMaxWidth: 16,
					itemStyle: { color: '#ec4899' },
					data: byAgent.map((a) => a.total),
				},
			],
		};
	});
</script>

<div class="bg-card border border-border rounded-lg overflow-hidden">
	<!-- HEADER -->
	<div class="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg3/20">
		<Cpu size={11} class="text-accent shrink-0" />
		<span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex-1"
			>Agent LLM Metrics</span
		>
		<span class="text-[10px] text-muted-foreground/60"
			>{summary.callCount} call{summary.callCount !== 1 ? 's' : ''}</span
		>
	</div>

	{#if llmEvents.length === 0}
		<div class="flex items-center justify-center py-8 text-muted-foreground text-[13px]">
			No LLM usage data in selected range
		</div>
	{:else}
		<!-- SUMMARY STATS -->
		<div class="grid grid-cols-4 gap-px bg-border border-b border-border">
			<div class="flex flex-col items-center gap-1 py-3 px-2 bg-card">
				<span class="text-[10px] text-muted-foreground uppercase tracking-wider font-medium"
					>LLM Calls</span
				>
				<span class="text-lg font-bold text-foreground tabular-nums">{fmt(summary.callCount)}</span>
			</div>
			<div class="flex flex-col items-center gap-1 py-3 px-2 bg-card">
				<span class="text-[10px] text-muted-foreground uppercase tracking-wider font-medium"
					>Total Tokens</span
				>
				<span class="text-lg font-bold text-foreground tabular-nums">{fmt(summary.total)}</span>
			</div>
			<div class="flex flex-col items-center gap-1 py-3 px-2 bg-card">
				<span class="text-[10px] text-muted-foreground uppercase tracking-wider font-medium"
					>Input Tokens</span
				>
				<span class="text-lg font-bold text-foreground tabular-nums">{fmt(summary.input)}</span>
			</div>
			<div class="flex flex-col items-center gap-1 py-3 px-2 bg-card">
				<span class="text-[10px] text-muted-foreground uppercase tracking-wider font-medium"
					>Output Tokens</span
				>
				<span class="text-lg font-bold text-foreground tabular-nums">{fmt(summary.output)}</span>
			</div>
		</div>

		<!-- CHARTS -->
		<div class="grid grid-cols-2 border-b border-border">
			<!-- Left: Tokens by Provider -->
			<div class="border-r border-border">
				<div
					class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-4 pt-3 pb-1"
				>
					By Provider
				</div>
				{#if byProvider.length > 0}
					<Chart options={providerChartOptions} height="220px" />
				{:else}
					<div
						class="flex items-center justify-center h-[220px] text-muted-foreground/50 text-[11px]"
					>
						No provider data
					</div>
				{/if}
			</div>

			<!-- Right: Tokens by Agent -->
			<div>
				<div
					class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-4 pt-3 pb-1"
				>
					By Agent
				</div>
				{#if byAgent.length > 0}
					<Chart options={agentChartOptions} height="220px" />
				{:else}
					<div
						class="flex items-center justify-center h-[220px] text-muted-foreground/50 text-[11px]"
					>
						No agent data
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
