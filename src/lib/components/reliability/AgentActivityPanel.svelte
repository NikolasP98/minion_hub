<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { Brain, HeartPulse, Sparkles, Wrench } from 'lucide-svelte';
	import PanelHeader from './PanelHeader.svelte';
	import MetricCard from './MetricCard.svelte';
	import Chart from '$lib/components/charts/Chart.svelte';
	import type { EChartsOption } from 'echarts';
	import type { ReliabilityEvent, ActivityAggregate } from '$lib/state/reliability/reliability.svelte';
	import { deriveOrigin } from '$lib/utils/event-origin';
	import { chartColors } from '$lib/utils/chart-colors';

	// "What are the agents actually DOING?" — derived purely from the unified event
	// stream the Hub already loads. Surfaces: memory/KG curation, heartbeat liveness,
	// proactive-vs-reactive balance, and tool activity. Heartbeat events carry no
	// agentId (keyed by account), so they're shown fleet-wide even when an agent
	// filter is active; memory / tool / LLM KPIs respect the agent filter.
	let {
		events = [],
		activity = null,
		agentFilter,
	}: { events: ReliabilityEvent[]; activity?: ActivityAggregate | null; agentFilter?: string } =
		$props();

	// Prefer the server-side activity aggregate (full coverage, fleet-wide) when
	// the gateway provides it; else derive from the loaded (capped) events. In
	// aggregate mode the agent filter doesn't apply (memory/heartbeat carry no
	// agentId), so the panel is fleet-wide — which matches its intent.
	let usingActivity = $derived(!!activity);

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

	function str(v: unknown): string | undefined {
		return typeof v === 'string' && v.trim() ? v : undefined;
	}

	function fmt(n: number): string {
		return n.toLocaleString('en-US');
	}

	function pct(n: number): string {
		return `${Math.round(n * 100)}%`;
	}

	function relTime(ts: number): string {
		const diff = Date.now() - ts;
		const s = Math.floor(diff / 1000);
		const mn = Math.floor(s / 60);
		const h = Math.floor(mn / 60);
		const d = Math.floor(h / 24);
		if (s < 60) return `${s}s ago`;
		if (mn < 60) return `${mn}m ago`;
		if (h < 24) return `${h}h ago`;
		return `${d}d ago`;
	}

	// Agent-scoped subset for agentId-bearing events (memory / tool / llm).
	function scoped(e: ReliabilityEvent): boolean {
		return !agentFilter || e.agentId === agentFilter;
	}

	// ── Memory / KG ──────────────────────────────────────────────────────────────
	let memory = $derived.by(() => {
		if (activity) return activity.memory;
		let created = 0,
			updated = 0,
			deleted = 0,
			reads = 0;
		const byType = new Map<string, number>();
		let lastTs = 0;
		for (const e of events) {
			if (e.category !== 'memory' || !scoped(e)) continue;
			if (e.timestamp > lastTs) lastTs = e.timestamp;
			if (e.event === 'memory.recall') {
				reads += 1;
				continue;
			}
			if (e.event === 'memory.node_created') created += 1;
			else if (e.event === 'memory.node_updated') updated += 1;
			else if (e.event === 'memory.node_deleted') deleted += 1;
			const t = str(parseMetadata(e.metadata)?.objectType) ?? 'other';
			byType.set(t, (byType.get(t) ?? 0) + 1);
		}
		return {
			created,
			updated,
			deleted,
			reads,
			total: created + updated + deleted,
			byType: [...byType.entries()].map(([key, value]) => ({ key, value })),
			lastTs,
		};
	});

	// ── Heartbeats ────────────────────────────────────────────────────────────────
	let heartbeat = $derived.by(() => {
		if (activity) {
			const h = activity.heartbeat;
			const graded = h.ok + h.failed;
			return { ...h, successRate: graded ? h.ok / graded : 1 };
		}
		let ok = 0,
			failed = 0,
			skipped = 0,
			sent = 0;
		let lastTs = 0;
		let lastStatus = '';
		for (const e of events) {
			if (e.category !== 'heartbeat') continue;
			const status = str(parseMetadata(e.metadata)?.status) ?? e.event.replace('heartbeat.', '');
			if (status === 'failed') failed += 1;
			else if (status === 'skipped') skipped += 1;
			else if (status === 'sent') {
				sent += 1;
				ok += 1;
			} else ok += 1; // ok-empty / ok-token
			if (e.timestamp > lastTs) {
				lastTs = e.timestamp;
				lastStatus = status;
			}
		}
		const graded = ok + failed;
		return {
			ok,
			failed,
			skipped,
			sent,
			total: ok + failed + skipped,
			successRate: graded ? ok / graded : 1,
			lastTs,
			lastStatus,
		};
	});

	// ── Proactivity (from agent.llm.usage source) ──────────────────────────────────
	let proactivity = $derived.by(() => {
		if (activity) {
			const p = activity.proactivity;
			return { ...p, ratio: p.total ? p.proactive / p.total : 0 };
		}
		let proactive = 0,
			reactive = 0,
			interAgent = 0,
			other = 0;
		for (const e of events) {
			if (e.event !== 'agent.llm.usage' || !scoped(e)) continue;
			const meta = parseMetadata(e.metadata);
			// Prefer gateway-stamped source; else derive from the session key.
			const source = deriveOrigin(e.correlationId, str(meta?.channel), str(meta?.source)).source;
			if (source === 'system') proactive += 1;
			else if (source === 'channel') reactive += 1;
			else if (source === 'agent') interAgent += 1;
			else other += 1;
		}
		const total = proactive + reactive + interAgent + other;
		return { proactive, reactive, interAgent, other, total, ratio: total ? proactive / total : 0 };
	});

	// ── Tools ───────────────────────────────────────────────────────────────────────
	let tools = $derived.by(() => {
		if (activity) {
			const t = activity.tools;
			return { ...t, errorRate: t.total ? t.err / t.total : 0 };
		}
		let ok = 0,
			err = 0;
		const byTool = new Map<string, number>();
		for (const e of events) {
			// Tool activity is emitted under category "tool" (tool.completed/failed) and
			// also category "agent" (tool.exec.ok/error) — match on the event prefix.
			if (!e.event.startsWith('tool.') || !scoped(e)) continue;
			const isErr = e.event.endsWith('.error') || e.event.endsWith('.failed');
			if (isErr) err += 1;
			else ok += 1;
			const name = str(parseMetadata(e.metadata)?.toolName) ?? 'tool';
			byTool.set(name, (byTool.get(name) ?? 0) + 1);
		}
		const total = ok + err;
		return {
			ok,
			err,
			total,
			errorRate: total ? err / total : 0,
			top: [...byTool.entries()]
				.map(([key, value]) => ({ key, value }))
				.sort((a, b) => b.value - a.value)
				.slice(0, 8),
		};
	});

	// ── Tool outcomes by classified status (skill.* — ok/error/timeout/auth_error) ──
	type Outcome = { ok: number; error: number; timeout: number; authError: number };
	let toolOutcomes = $derived.by(() => {
		if (activity?.toolOutcomes) return activity.toolOutcomes;
		// Fallback: derive from the capped event slice (skill.<status> + skillName meta).
		let ok = 0,
			error = 0,
			timeout = 0,
			authError = 0;
		const by = new Map<string, Outcome>();
		for (const e of events) {
			if (!e.event.startsWith('skill.') || !scoped(e)) continue;
			const status = e.event.slice('skill.'.length);
			const tool = str(parseMetadata(e.metadata)?.skillName) ?? 'tool';
			let row = by.get(tool);
			if (!row) {
				row = { ok: 0, error: 0, timeout: 0, authError: 0 };
				by.set(tool, row);
			}
			if (status === 'ok') (row.ok += 1), (ok += 1);
			else if (status === 'timeout') (row.timeout += 1), (timeout += 1);
			else if (status === 'auth_error') (row.authError += 1), (authError += 1);
			else (row.error += 1), (error += 1);
		}
		const tot = (o: Outcome) => o.ok + o.error + o.timeout + o.authError;
		return {
			ok,
			error,
			timeout,
			authError,
			total: ok + error + timeout + authError,
			byTool: [...by.entries()]
				.map(([tool, c]) => ({ tool, ...c }))
				.sort((a, b) => tot(b) - tot(a))
				.slice(0, 10),
		};
	});

	const hasAny = $derived(
		memory.total > 0 ||
			heartbeat.total > 0 ||
			proactivity.total > 0 ||
			tools.total > 0 ||
			toolOutcomes.total > 0,
	);

	// ── Charts ──────────────────────────────────────────────────────────────────────
	let proactivityChart: EChartsOption = $derived.by(() => {
		const c = chartColors();
		return {
			backgroundColor: 'transparent',
			tooltip: { trigger: 'item' },
			legend: { bottom: 0, left: 'center', textStyle: { fontSize: 10 } },
			series: [
				{
					type: 'pie',
					radius: ['45%', '70%'],
					center: ['50%', '44%'],
					itemStyle: { borderColor: 'var(--color-bg2)', borderWidth: 2 },
					label: { show: false },
					data: [
						{ name: 'reactive', value: proactivity.reactive, itemStyle: { color: c.cyan } },
						{ name: 'proactive', value: proactivity.proactive, itemStyle: { color: c.pink } },
						{ name: 'inter-agent', value: proactivity.interAgent, itemStyle: { color: c.purple } },
						{ name: 'other', value: proactivity.other, itemStyle: { color: c.neutral } },
					].filter((d) => d.value > 0),
				},
			],
		};
	});

	let toolChart: EChartsOption = $derived.by(() => {
		const c = chartColors();
		return {
			backgroundColor: 'transparent',
			tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
			grid: { left: 100, right: 24, top: 8, bottom: 24 },
			xAxis: { type: 'value', axisLabel: { fontSize: 10 } },
			yAxis: {
				type: 'category',
				data: tools.top.map((t) => t.key),
				inverse: true,
				axisLabel: { fontSize: 10, width: 84, overflow: 'truncate' },
			},
			series: [
				{
					type: 'bar',
					barMaxWidth: 14,
					itemStyle: { color: c.purple },
					data: tools.top.map((t) => t.value),
				},
			],
		};
	});
</script>

<div class="surface-2 rounded-lg overflow-hidden">
	<PanelHeader label={m.reliability_agentActivity()} labelClass="flex-1">
		{#snippet icon()}
			<Sparkles size={11} class="text-accent shrink-0" />
		{/snippet}
		{#snippet actions()}
			{#if usingActivity}
				<span class="text-[length:var(--font-size-telemetry)] text-muted-strong">{m.reliability_fleetWideFullCoverage()}</span>
			{/if}
		{/snippet}
	</PanelHeader>

	{#if !hasAny}
		<div class="flex flex-col items-center justify-center gap-1 py-8 px-4 text-center">
			<span class="text-muted-foreground text-[length:var(--font-size-body)]">{m.reliability_noActivitySignals()}</span>
			<span class="text-muted-strong text-[length:var(--font-size-label)] max-w-md">
				{#if usingActivity}
					{m.reliability_noActivityYetHint()}
				{:else}
					{m.reliability_activityTelemetryRequired()}
				{/if}
			</span>
		</div>
	{:else}
		<!-- KPI strip -->
		<div class="grid grid-cols-2 md:grid-cols-4 gap-px bg-border border-b border-border">
			<MetricCard label={m.reliability_memoriesSaved()} value={fmt(memory.created)} valueClass="text-[var(--color-purple)] tabular-nums" />
			<MetricCard
				label={m.reliability_heartbeatHealth()}
				value={heartbeat.total > 0 ? pct(heartbeat.successRate) : '—'}
				valueClass="{heartbeat.failed > 0 ? 'text-warning' : 'text-success'} tabular-nums"
			/>
			<MetricCard label={m.reliability_proactiveRuns()} value={pct(proactivity.ratio)} valueClass="text-[var(--color-brand)] tabular-nums" />
			<MetricCard
				label={m.reliability_toolErrorRate()}
				value={tools.total > 0 ? pct(tools.errorRate) : '—'}
				valueClass="{tools.err > 0 ? 'text-warning' : 'text-success'} tabular-nums"
			/>
		</div>

		<div class="grid grid-cols-1 lg:grid-cols-2 gap-px bg-border">
			<!-- Memory / KG detail -->
			<div class="bg-bg2 p-3">
				<div class="flex items-center gap-1.5 pb-2">
					<Brain size={12} class="text-[var(--color-purple)]" />
					<span class="text-[length:var(--font-size-telemetry)] font-semibold uppercase tracking-widest text-muted-foreground">{m.reliability_memoryKnowledgeGraph()}</span>
				</div>
				<div class="grid grid-cols-4 gap-2 text-center">
					<div class="rounded bg-bg3/40 py-2">
						<div class="text-base font-bold text-success tabular-nums">{fmt(memory.created)}</div>
						<div class="text-[length:var(--font-size-telemetry)] uppercase tracking-wide text-muted-strong">{m.reliability_created()}</div>
					</div>
					<div class="rounded bg-bg3/40 py-2">
						<div class="text-base font-bold text-accent tabular-nums">{fmt(memory.updated)}</div>
						<div class="text-[length:var(--font-size-telemetry)] uppercase tracking-wide text-muted-strong">{m.reliability_updated()}</div>
					</div>
					<div class="rounded bg-bg3/40 py-2">
						<div class="text-base font-bold text-muted-foreground tabular-nums">{fmt(memory.deleted)}</div>
						<div class="text-[length:var(--font-size-telemetry)] uppercase tracking-wide text-muted-strong">{m.reliability_deleted()}</div>
					</div>
					<div class="rounded bg-bg3/40 py-2">
						<div class="text-base font-bold text-[var(--color-cyan)] tabular-nums">{fmt(memory.reads ?? 0)}</div>
						<div class="text-[length:var(--font-size-telemetry)] uppercase tracking-wide text-muted-strong">{m.reliability_reads()}</div>
					</div>
				</div>
				{#if memory.byType.length > 0}
					<div class="flex flex-wrap gap-1.5 mt-2.5">
						{#each memory.byType as t (t.key)}
							<span class="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--color-purple)_15%,transparent)] text-[var(--color-purple)] border border-[color-mix(in_srgb,var(--color-purple)_30%,transparent)] px-2 py-0.5 text-[length:var(--font-size-telemetry)]">
								<span class="opacity-70">{t.key}</span>
								<span class="font-semibold tabular-nums">{fmt(t.value)}</span>
							</span>
						{/each}
					</div>
				{/if}
				{#if memory.total > 0}
					<p class="text-[length:var(--font-size-telemetry)] text-muted-strong mt-2">
						{m.reliability_lastActivity({ time: relTime(memory.lastTs), reads: (memory.reads ?? 0) > 0 ? ` · ${fmt(memory.reads ?? 0)} ${m.reliability_readCount()}` : '' })}
					</p>
				{:else if (memory.reads ?? 0) > 0}
					<p class="text-[length:var(--font-size-telemetry)] text-muted-strong mt-2">
						{m.reliability_readsNoWrites({ count: fmt(memory.reads ?? 0) })}
					</p>
				{:else}
					<p class="text-[length:var(--font-size-telemetry)] text-warning mt-2">{m.reliability_noMemoryActivity()}</p>
				{/if}
			</div>

			<!-- Heartbeat detail -->
			<div class="bg-bg2 p-3">
				<div class="flex items-center gap-1.5 pb-2">
					<HeartPulse size={12} class="text-[var(--color-brand)]" />
					<span class="text-[length:var(--font-size-telemetry)] font-semibold uppercase tracking-widest text-muted-foreground">{m.reliability_heartbeatsLiveness()}</span>
				</div>
				{#if heartbeat.total > 0}
					<div class="grid grid-cols-3 gap-2 text-center">
						<div class="rounded bg-bg3/40 py-2">
							<div class="text-base font-bold text-success tabular-nums">{fmt(heartbeat.ok)}</div>
							<div class="text-[length:var(--font-size-telemetry)] uppercase tracking-wide text-muted-strong">{m.reliability_ok()}</div>
						</div>
						<div class="rounded bg-bg3/40 py-2">
							<div class="text-base font-bold {heartbeat.failed > 0 ? 'text-destructive' : 'text-muted-foreground'} tabular-nums">{fmt(heartbeat.failed)}</div>
							<div class="text-[length:var(--font-size-telemetry)] uppercase tracking-wide text-muted-strong">{m.reliability_failed()}</div>
						</div>
						<div class="rounded bg-bg3/40 py-2">
							<div class="text-base font-bold text-muted-foreground tabular-nums">{fmt(heartbeat.skipped)}</div>
							<div class="text-[length:var(--font-size-telemetry)] uppercase tracking-wide text-muted-strong">{m.reliability_skipped()}</div>
						</div>
					</div>
					<p class="text-[length:var(--font-size-telemetry)] text-muted-strong mt-2">
						{m.reliability_lastBeat({ time: relTime(heartbeat.lastTs), status: heartbeat.lastStatus ? ` · ${heartbeat.lastStatus}` : '' })}
					</p>
				{:else}
					<div class="flex items-center justify-center h-[96px] text-center">
						<span class="text-[length:var(--font-size-label)] text-warning">{m.reliability_noHeartbeats()}</span>
					</div>
				{/if}
			</div>

			<!-- Proactivity donut -->
			<div class="bg-bg2 p-1">
				<div class="flex items-center gap-1.5 px-2 pt-2 pb-1">
					<Sparkles size={12} class="text-[var(--color-brand)]" />
					<span class="text-[length:var(--font-size-telemetry)] font-semibold uppercase tracking-widest text-muted-foreground">{m.reliability_proactiveVsReactiveRuns()}</span>
				</div>
				{#if proactivity.total > 0}
					<Chart options={proactivityChart} height="180px" />
				{:else}
					<div class="flex items-center justify-center h-[180px] text-muted-strong text-[length:var(--font-size-label)]">{m.reliability_noRunData()}</div>
				{/if}
			</div>

			<!-- Tools -->
			<div class="bg-bg2 p-1">
				<div class="flex items-center gap-1.5 px-2 pt-2 pb-1">
					<Wrench size={12} class="text-[var(--color-purple)]" />
					<span class="text-[length:var(--font-size-telemetry)] font-semibold uppercase tracking-widest text-muted-foreground">{m.reliability_toolUsage({ count: fmt(tools.total) })}</span>
				</div>
				{#if tools.top.length > 0}
					<Chart options={toolChart} height="180px" />
				{:else}
					<div class="flex items-center justify-center h-[180px] text-muted-strong text-[length:var(--font-size-label)]">{m.reliability_noToolCalls()}</div>
				{/if}
			</div>
		</div>

		<!-- Tool outcomes by status — why tools fail, not just that they do -->
		{#if toolOutcomes.total > 0}
			<div class="bg-bg2 p-3 border-t border-border">
				<div class="flex items-center gap-1.5 pb-2">
					<Wrench size={12} class="text-[var(--color-purple)]" />
					<span class="text-[length:var(--font-size-telemetry)] font-semibold uppercase tracking-widest text-muted-foreground">{m.reliability_toolOutcomes()}</span>
					<span class="ml-auto flex items-center gap-2 text-[length:var(--font-size-telemetry)] tabular-nums">
						<span class="text-success">{fmt(toolOutcomes.ok)} {m.reliability_ok()}</span>
						{#if toolOutcomes.error > 0}<span class="text-warning">{fmt(toolOutcomes.error)} {m.reliability_outcomeError()}</span>{/if}
						{#if toolOutcomes.timeout > 0}<span class="text-warning">{fmt(toolOutcomes.timeout)} {m.reliability_outcomeTimeout()}</span>{/if}
						{#if toolOutcomes.authError > 0}<span class="text-destructive">{fmt(toolOutcomes.authError)} {m.reliability_outcomeAuth()}</span>{/if}
					</span>
				</div>
				<div class="overflow-x-auto">
					<table class="w-full min-w-[360px] text-[length:var(--font-size-label)]">
						<thead>
							<tr class="text-[length:var(--font-size-telemetry)] uppercase tracking-wide text-muted-strong">
								<th class="text-left font-medium pb-1">{m.reliability_tool()}</th>
								<th class="text-right font-medium pb-1 px-2 text-success">{m.reliability_ok()}</th>
								<th class="text-right font-medium pb-1 px-2">{m.reliability_outcomeError()}</th>
								<th class="text-right font-medium pb-1 px-2">{m.reliability_outcomeTimeout()}</th>
								<th class="text-right font-medium pb-1 px-2">{m.reliability_outcomeAuth()}</th>
							</tr>
						</thead>
						<tbody>
							{#each toolOutcomes.byTool as t (t.tool)}
								<tr class="border-t border-border/40">
									<td class="text-left py-1 pr-2 truncate max-w-[160px] text-foreground">{t.tool}</td>
									<td class="text-right py-1 px-2 tabular-nums text-success">{fmt(t.ok)}</td>
									<td class="text-right py-1 px-2 tabular-nums {t.error > 0 ? 'text-warning' : 'text-muted-strong'}">{fmt(t.error)}</td>
									<td class="text-right py-1 px-2 tabular-nums {t.timeout > 0 ? 'text-warning' : 'text-muted-strong'}">{fmt(t.timeout)}</td>
									<td class="text-right py-1 px-2 tabular-nums {t.authError > 0 ? 'text-destructive' : 'text-muted-strong'}">{fmt(t.authError)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}
	{/if}
</div>
