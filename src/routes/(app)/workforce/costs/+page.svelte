<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import { startPolling } from '$lib/util/live-polling';
	import LiveIndicator from '$lib/components/LiveIndicator.svelte';
	import Sparkline from '$lib/components/Sparkline.svelte';

	let { data }: { data: PageData } = $props();
	const { kpis, byAgent, byProvider, trend } = $derived(data);

	const trendValues = $derived(trend.map((p) => p.cents));
	const utilization = $derived(
		kpis.budgetCents > 0 ? Math.min(100, (kpis.monthCents / kpis.budgetCents) * 100) : 0,
	);

	const projectedUtilization = $derived(
		kpis.budgetCents > 0 ? Math.min(100, (kpis.projectedMonthEndCents / kpis.budgetCents) * 100) : 0,
	);

	const maxAgentCents = $derived(Math.max(1, ...byAgent.map((r) => r.cents)));
	const maxProviderCents = $derived(Math.max(1, ...byProvider.map((r) => r.cents)));

	const PROVIDER_TINT: Record<string, string> = {
		anthropic: 'bg-orange-500',
		openai: 'bg-emerald-500',
		google: 'bg-blue-500',
	};

	const STATUS_DOT: Record<string, string> = {
		active: '#10b981',
		running: '#3b82f6',
		paused: '#f59e0b',
		error: '#ef4444',
		idle: '#6b7280',
	};

	function formatCents(cents: number): string {
		return `$${(cents / 100).toFixed(2)}`;
	}

	function formatBig(cents: number): string {
		const v = cents / 100;
		if (v >= 100) return `$${v.toFixed(0)}`;
		return `$${v.toFixed(2)}`;
	}

	onMount(() => startPolling('app:costs', 8000));
</script>

<div class="p-6 space-y-6 max-w-6xl">
	<header class="flex items-center justify-between flex-wrap gap-3">
		<div class="flex items-center gap-3">
			<h1 class="text-2xl font-semibold">Costs</h1>
			<LiveIndicator intervalMs={8000} />
		</div>
		<div class="text-xs text-muted-foreground">
			Trailing 14 days · projected month-end {formatBig(kpis.projectedMonthEndCents)}
		</div>
	</header>

	<!-- KPI row: today / last 7 / month / projected -->
	<section class="grid grid-cols-2 sm:grid-cols-4 gap-4">
		<div class="rounded-lg border border-border bg-card p-4 space-y-1">
			<h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Today</h2>
			<div class="text-2xl font-semibold tabular-nums">{formatCents(kpis.todayCents)}</div>
		</div>
		<div class="rounded-lg border border-border bg-card p-4 space-y-1">
			<h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Last 7 days</h2>
			<div class="text-2xl font-semibold tabular-nums">{formatBig(kpis.last7Cents)}</div>
		</div>
		<div class="rounded-lg border border-border bg-card p-4 space-y-1">
			<h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider">This period</h2>
			<div class="text-2xl font-semibold tabular-nums">{formatBig(kpis.monthCents)}</div>
			<div class="text-xs text-muted-foreground">of {formatBig(kpis.budgetCents)} budget</div>
		</div>
		<div class="rounded-lg border border-border bg-card p-4 space-y-1">
			<h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Projected EOM</h2>
			<div class="text-2xl font-semibold tabular-nums">{formatBig(kpis.projectedMonthEndCents)}</div>
			<div class="text-xs {projectedUtilization > 100 ? 'text-destructive' : 'text-muted-foreground'}">
				{projectedUtilization.toFixed(0)}% of budget
			</div>
		</div>
	</section>

	<!-- Trend chart (large sparkline) -->
	<section>
		<div class="flex items-center justify-between mb-2">
			<h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
				Daily spend
			</h2>
			<div class="text-xs text-muted-foreground tabular-nums">
				min {formatCents(Math.min(...trendValues))} · max {formatCents(Math.max(...trendValues))} · avg {formatCents(Math.round(trendValues.reduce((s, n) => s + n, 0) / trendValues.length))}
			</div>
		</div>
		<div class="rounded-lg border border-border bg-card p-4 space-y-3">
			<div class="text-primary">
				<Sparkline values={trendValues} width={1000} height={120} strokeWidth={2} />
			</div>
			<!-- Date labels (every other day to reduce noise) -->
			<div class="flex justify-between text-[10px] text-muted-foreground font-mono px-1">
				{#each trend as p, i (p.date)}
					{#if i === 0 || i === trend.length - 1 || i % 2 === 0}
						<span>{p.date.slice(5)}</span>
					{:else}
						<span class="opacity-0">·</span>
					{/if}
				{/each}
			</div>
		</div>
	</section>

	<!-- Budget bar (large) -->
	<section>
		<h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
			Budget pacing
		</h2>
		<div class="rounded-lg border border-border bg-card p-4 space-y-2">
			<div class="relative h-6 rounded-md bg-muted overflow-hidden">
				<!-- Current spend bar -->
				<div
					class="h-full bg-primary transition-all"
					style="width: {utilization}%"
					title="Current spend"
				></div>
				<!-- Projected overlay (lighter) -->
				{#if projectedUtilization > utilization}
					<div
						class="absolute top-0 h-full bg-primary/30"
						style="left: {utilization}%; width: {projectedUtilization - utilization}%"
						title="Projected end-of-month"
					></div>
				{/if}
			</div>
			<div class="flex justify-between text-xs text-muted-foreground tabular-nums">
				<span>{formatBig(kpis.monthCents)} <span class="text-muted-foreground/60">spent</span></span>
				<span>
					{formatBig(kpis.projectedMonthEndCents)} <span class="text-muted-foreground/60">projected</span>
				</span>
				<span>{formatBig(kpis.budgetCents)} <span class="text-muted-foreground/60">budget</span></span>
			</div>
		</div>
	</section>

	<!-- Two-column breakdowns -->
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
		<!-- By agent (horizontal bars) -->
		<section>
			<h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
				By agent <span class="font-medium normal-case tracking-normal text-xs">({byAgent.length})</span>
			</h2>
			<div class="rounded-lg border border-border bg-card divide-y divide-border">
				{#each byAgent as row (row.agentId)}
					<a
						href="/workforce/agents/{row.agentId}"
						class="block px-4 py-3 text-sm hover:bg-accent transition-colors"
					>
						<div class="flex items-center gap-2 mb-1.5">
							<span
								class="h-2 w-2 rounded-full shrink-0"
								style="background:{STATUS_DOT[row.status] ?? '#6b7280'}"
							></span>
							<span class="font-medium truncate flex-1 min-w-0">{row.agentName}</span>
							<span class="font-mono text-xs text-muted-foreground tabular-nums">{formatCents(row.cents)}</span>
						</div>
						<div class="relative h-1.5 rounded-full bg-muted overflow-hidden">
							<div
								class="absolute inset-y-0 left-0 bg-primary rounded-full transition-all"
								style="width: {(row.cents / maxAgentCents) * 100}%"
							></div>
						</div>
					</a>
				{/each}
			</div>
		</section>

		<!-- By provider/model (horizontal bars with tint per provider) -->
		<section>
			<h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
				By provider / model
			</h2>
			<div class="rounded-lg border border-border bg-card divide-y divide-border">
				{#each byProvider as row (row.model)}
					<div class="px-4 py-3 text-sm">
						<div class="flex items-center gap-2 mb-1.5 flex-wrap">
							<span class="font-medium truncate">{row.provider}</span>
							<span class="font-mono text-xs text-muted-foreground/80 truncate">{row.model}</span>
							<span class="ml-auto font-mono text-xs text-muted-foreground tabular-nums">
								{formatCents(row.cents)} <span class="text-muted-foreground/60">({(row.share * 100).toFixed(0)}%)</span>
							</span>
						</div>
						<div class="relative h-1.5 rounded-full bg-muted overflow-hidden">
							<div
								class="absolute inset-y-0 left-0 {PROVIDER_TINT[row.provider] ?? 'bg-primary'} rounded-full transition-all"
								style="width: {(row.cents / maxProviderCents) * 100}%"
							></div>
						</div>
						<div class="text-[10px] text-muted-foreground/70 mt-1 font-mono">
							{row.requests} requests
						</div>
					</div>
				{/each}
			</div>
			<!-- Provider legend -->
			<div class="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
				{#each Object.entries(PROVIDER_TINT) as [provider, cls] (provider)}
					<span class="inline-flex items-center gap-1.5">
						<span class="h-2 w-2 rounded-full {cls}"></span>
						{provider}
					</span>
				{/each}
			</div>
		</section>
	</div>
</div>
