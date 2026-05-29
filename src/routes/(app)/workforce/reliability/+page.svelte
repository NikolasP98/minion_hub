<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import { startPolling } from '$lib/utils/live-polling';
	import LiveIndicator from '$lib/components/LiveIndicator.svelte';
	import { PageHeader } from '$lib/components/ui';
	import { Gauge } from 'lucide-svelte';

	let { data }: { data: PageData } = $props();
	const { heatmap, recentRuns, agents } = $derived(data);

	// Max cell value drives intensity scaling
	const maxCell = $derived.by(() => {
		let m = 0;
		for (const row of Object.values(heatmap.cells)) {
			for (const v of row) if (v > m) m = v;
		}
		return Math.max(1, m);
	});

	function intensity(cell: number): number {
		return cell / maxCell;
	}

	// Map intensity to background color (transparent to oklch primary)
	function cellStyle(cell: number): string {
		if (cell === 0) return 'background-color: rgba(255,255,255,0.02)';
		const op = 0.12 + intensity(cell) * 0.78;
		return `background-color: rgba(59,130,246,${op.toFixed(3)})`;
	}

	function cellTextColor(cell: number): string {
		if (cell === 0) return 'text-muted-foreground/30';
		if (intensity(cell) > 0.55) return 'text-white';
		return 'text-foreground/80';
	}

	const STATUS_DOT: Record<string, string> = {
		active: '#10b981',
		running: '#3b82f6',
		paused: '#f59e0b',
		error: '#ef4444',
		idle: '#6b7280',
		pending_approval: '#a855f7',
		terminated: '#525252',
	};

	const RUN_STATUS_BADGE: Record<string, string> = {
		succeeded: 'bg-green-500/10 text-green-600',
		failed: 'bg-destructive/10 text-destructive',
		running: 'bg-blue-500/10 text-blue-600',
		cancelled: 'bg-muted text-muted-foreground',
	};

	// Per-agent totals (right column)
	const agentTotals = $derived.by(() => {
		const out: Record<string, number> = {};
		for (const [aid, row] of Object.entries(heatmap.cells)) {
			out[aid] = row.reduce((s: number, v: number) => s + v, 0);
		}
		return out;
	});

	// Per-hour totals (bottom row)
	const hourTotals = $derived.by(() => {
		const out: number[] = new Array(24).fill(0);
		for (const row of Object.values(heatmap.cells)) {
			for (let h = 0; h < 24; h++) out[h] += row[h];
		}
		return out;
	});

	const grandTotal = $derived(Object.values(agentTotals).reduce((s: number, v: number) => s + v, 0));

	// Failures from recent runs (across queried agents)
	const failedRuns = $derived(recentRuns.filter((r: any) => r.status === 'failed'));
	const runningRuns = $derived(recentRuns.filter((r: any) => r.status === 'running'));

	function formatDuration(ms: number | null): string {
		if (ms === null) return '—';
		if (ms < 1000) return `${ms}ms`;
		if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
		return `${Math.floor(ms / 60_000)}m`;
	}

	function relativeTime(iso: string | Date): string {
		const diff = Date.now() - new Date(iso).getTime();
		if (diff < 60_000) return 'just now';
		if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
		if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
		return `${Math.floor(diff / 86_400_000)}d ago`;
	}

	function agentName(id: string): string {
		return agents.find((a) => a.id === id)?.name ?? id.slice(0, 8);
	}

	onMount(() => startPolling('app:reliability', 8000));
</script>

<PageHeader title="Reliability">
	{#snippet leading()}
		<Gauge size={16} class="text-accent shrink-0" />
	{/snippet}
	{#snippet actions()}
		<LiveIndicator intervalMs={8000} />
		<div class="hidden sm:block text-xs text-muted-foreground">
			{grandTotal} events across {heatmap.agents.length} agents · last 24 hours
		</div>
	{/snippet}
</PageHeader>
<main class="flex-1 min-h-0 overflow-y-auto p-6 space-y-6 max-w-6xl">
	<!-- Heatmap -->
	<section>
		<h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
			Activity heatmap <span class="font-normal normal-case tracking-normal text-xs text-muted-foreground/60">(agent × hour-of-day)</span>
		</h2>
		<div class="rounded-lg border border-border bg-card p-4 overflow-x-auto">
			<table class="w-full text-xs border-separate" style="border-spacing: 2px">
				<thead>
					<tr>
						<th class="text-left text-muted-foreground font-medium pr-3 sticky left-0 bg-card">Agent</th>
						{#each heatmap.hourLabels as h (h)}
							<th class="text-center text-muted-foreground/60 font-mono font-normal w-7">
								{#if h % 3 === 0}{h.toString().padStart(2, '0')}{/if}
							</th>
						{/each}
						<th class="text-right text-muted-foreground font-medium pl-3">Σ</th>
					</tr>
				</thead>
				<tbody>
					{#each heatmap.agents as agent (agent.id)}
						<tr>
							<td class="pr-3 sticky left-0 bg-card whitespace-nowrap">
								<a href="/workforce/agents/{agent.id}" class="inline-flex items-center gap-1.5 hover:underline">
									<span
										class="h-2 w-2 rounded-full shrink-0"
										style="background:{STATUS_DOT[agent.status] ?? '#6b7280'}"
									></span>
									<span class="font-medium">{agent.name}</span>
								</a>
							</td>
							{#each heatmap.cells[agent.id] as cell, h (h)}
								<td
									class="h-7 w-7 rounded text-center align-middle font-mono tabular-nums text-[10px] {cellTextColor(cell)}"
									style={cellStyle(cell)}
									title="{agent.name} · {h.toString().padStart(2, '0')}:00 · {cell} event{cell !== 1 ? 's' : ''}"
								>
									{#if cell > 0}{cell}{/if}
								</td>
							{/each}
							<td class="pl-3 text-right font-mono tabular-nums font-medium">{agentTotals[agent.id]}</td>
						</tr>
					{/each}
					<tr>
						<td class="pr-3 sticky left-0 bg-card text-muted-foreground font-medium">Σ</td>
						{#each hourTotals as t, h (h)}
							<td class="text-center text-muted-foreground/70 font-mono tabular-nums text-[10px] pt-1">
								{t > 0 ? t : ''}
							</td>
						{/each}
						<td class="pl-3 text-right font-mono tabular-nums font-semibold">{grandTotal}</td>
					</tr>
				</tbody>
			</table>
		</div>

		<!-- Color scale legend -->
		<div class="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
			<span>Less</span>
			<div class="flex gap-1">
				{#each [0, 0.2, 0.4, 0.6, 0.8, 1] as t (t)}
					<span
						class="h-3 w-6 rounded"
						style="background-color: rgba(59,130,246,{t === 0 ? 0.02 : (0.12 + t * 0.78).toFixed(3)})"
					></span>
				{/each}
			</div>
			<span>More</span>
			<span class="ml-auto">Peak hour: {hourTotals.indexOf(Math.max(...hourTotals)).toString().padStart(2, '0')}:00</span>
		</div>
	</section>

	<!-- Recent failures + running -->
	<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
		<section>
			<h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
				Recent failures <span class="font-medium normal-case tracking-normal text-xs">({failedRuns.length})</span>
			</h2>
			{#if failedRuns.length === 0}
				<div class="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
					No recent failures.
				</div>
			{:else}
				<ul class="rounded-lg border border-border bg-card divide-y divide-border">
					{#each failedRuns as run (run.id)}
						<li class="px-4 py-3 text-sm flex items-center gap-3">
							<span class="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium {RUN_STATUS_BADGE.failed}">
								failed
							</span>
							<div class="flex-1 min-w-0">
								<a href="/workforce/agents/{run.agentId}" class="font-medium hover:underline truncate block">
									{agentName(run.agentId)}
								</a>
								<div class="text-xs text-muted-foreground font-mono">{run.id} · {formatDuration(run.durationMs)}</div>
							</div>
							<time class="shrink-0 text-xs text-muted-foreground" datetime={run.startedAt}>
								{relativeTime(run.startedAt)}
							</time>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section>
			<h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
				In flight <span class="font-medium normal-case tracking-normal text-xs">({runningRuns.length})</span>
			</h2>
			{#if runningRuns.length === 0}
				<div class="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
					No runs currently in flight.
				</div>
			{:else}
				<ul class="rounded-lg border border-border bg-card divide-y divide-border">
					{#each runningRuns as run (run.id)}
						<li class="px-4 py-3 text-sm flex items-center gap-3">
							<span class="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium {RUN_STATUS_BADGE.running}">
								running
							</span>
							<div class="flex-1 min-w-0">
								<a href="/workforce/agents/{run.agentId}" class="font-medium hover:underline truncate block">
									{agentName(run.agentId)}
								</a>
								<div class="text-xs text-muted-foreground font-mono">{run.id} · {run.source}</div>
							</div>
							<time class="shrink-0 text-xs text-muted-foreground" datetime={run.startedAt}>
								started {relativeTime(run.startedAt)}
							</time>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>
</main>
