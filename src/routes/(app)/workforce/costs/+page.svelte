<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import * as m from '$lib/paraglide/messages';
	import { startPolling } from '$lib/utils/live-polling';
	import LiveIndicator from '$lib/components/LiveIndicator.svelte';
	import Sparkline from '$lib/components/Sparkline.svelte';
	import { PageHeader } from '$lib/components/ui';
	import { Receipt } from 'lucide-svelte';

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
		anthropic: 'bg-[var(--color-warning-fg)]',
		openai: 'bg-[var(--color-success-fg)]',
		google: 'bg-[var(--color-accent)]',
	};

	const STATUS_DOT: Record<string, string> = {
		active: 'var(--color-emerald)',
		running: 'var(--color-accent)',
		paused: 'var(--color-warning-fg)',
		error: 'var(--color-danger-fg)',
		idle: 'var(--color-text-tertiary)',
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

<PageHeader title={m.workforce_costs()}>
	{#snippet leading()}
		<Receipt size={16} class="text-accent shrink-0" />
	{/snippet}
	{#snippet actions()}
		<LiveIndicator intervalMs={8000} />
		<div class="hidden sm:block text-xs text-muted-foreground">
			{m.costs_trailing14Days()} · {m.costs_projectedMonthEnd()} {formatBig(kpis.projectedMonthEndCents)}
		</div>
	{/snippet}
</PageHeader>
<main class="flex-1 min-h-0 overflow-y-auto p-6 space-y-6 max-w-6xl">
	<!-- KPI row: today / last 7 / month / projected -->
	<section class="grid grid-cols-2 sm:grid-cols-4 gap-4">
		<div class="rounded-lg border border-border bg-card p-4 space-y-1">
			<h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider">{m.common_today()}</h2>
			<div class="text-2xl font-semibold tabular-nums">{formatCents(kpis.todayCents)}</div>
		</div>
		<div class="rounded-lg border border-border bg-card p-4 space-y-1">
			<h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider">{m.costs_last7Days()}</h2>
			<div class="text-2xl font-semibold tabular-nums">{formatBig(kpis.last7Cents)}</div>
		</div>
		<div class="rounded-lg border border-border bg-card p-4 space-y-1">
			<h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider">{m.costs_thisPeriod()}</h2>
			<div class="text-2xl font-semibold tabular-nums">{formatBig(kpis.monthCents)}</div>
			<div class="text-xs text-muted-foreground">{m.costs_of()} {formatBig(kpis.budgetCents)} {m.costs_budget()}</div>
		</div>
		<div class="rounded-lg border border-border bg-card p-4 space-y-1">
			<h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider">{m.costs_projectedEOM()}</h2>
			<div class="text-2xl font-semibold tabular-nums">{formatBig(kpis.projectedMonthEndCents)}</div>
			<div class="text-xs {projectedUtilization > 100 ? 'text-destructive' : 'text-muted-foreground'}">
				{projectedUtilization.toFixed(0)}% {m.costs_ofBudget()}
			</div>
		</div>
	</section>

	<!-- Trend chart (large sparkline) -->
	<section>
		<div class="flex items-center justify-between mb-2">
			<h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
				{m.costs_dailySpend()}
			</h2>
			<div class="text-xs text-muted-foreground tabular-nums">
				{m.costs_min()} {formatCents(Math.min(...trendValues))} · {m.costs_max()} {formatCents(Math.max(...trendValues))} · {m.costs_avg()} {formatCents(Math.round(trendValues.reduce((s, n) => s + n, 0) / trendValues.length))}
			</div>
		</div>
		<div class="rounded-lg border border-border bg-card p-4 space-y-3">
			<div class="text-primary">
				<Sparkline values={trendValues} width={1000} height={120} strokeWidth={2} />
			</div>
			<!-- Date labels (every other day to reduce noise) -->
      <div class="flex justify-between t-telemetry text-muted-foreground px-1">
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
			{m.costs_budgetPacing()}
		</h2>
		<div class="rounded-lg border border-border bg-card p-4 space-y-2">
			<div class="relative h-6 rounded-md bg-muted overflow-hidden">
				<!-- Current spend bar -->
				<div
					class="h-full bg-primary transition-all"
					style="width: {utilization}%"
					title={m.costs_currentSpend()}
				></div>
				<!-- Projected overlay (lighter) -->
				{#if projectedUtilization > utilization}
					<div
						class="absolute top-0 h-full bg-primary/30"
						style="left: {utilization}%; width: {projectedUtilization - utilization}%"
						title={m.costs_projectedEndOfMonth()}
					></div>
				{/if}
			</div>
			<div class="flex justify-between text-xs text-muted-foreground tabular-nums">
				<span>{formatBig(kpis.monthCents)} <span class="text-muted-strong">{m.costs_spent()}</span></span>
				<span>
					{formatBig(kpis.projectedMonthEndCents)} <span class="text-muted-strong">{m.costs_projected()}</span>
				</span>
				<span>{formatBig(kpis.budgetCents)} <span class="text-muted-strong">{m.costs_budget()}</span></span>
			</div>
		</div>
	</section>

	<!-- Two-column breakdowns -->
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
		<!-- By agent (horizontal bars) -->
		<section>
			<h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
				{m.costs_byAgent()} <span class="font-medium normal-case tracking-normal text-xs">({byAgent.length})</span>
			</h2>
			<div class="rounded-lg border border-border bg-card divide-y divide-border">
				{#each byAgent as row (row.agentId)}
					<a
						href="/workforce/agents/{row.agentId}"
						class="block px-4 py-3 text-sm hover:bg-muted transition-colors"
					>
						<div class="flex items-center gap-2 mb-1.5">
							<span
								class="h-2 w-2 rounded-full shrink-0"
								style="background:{STATUS_DOT[row.status] ?? 'var(--color-text-tertiary)'}"
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
				{m.costs_byProviderModel()}
			</h2>
			<div class="rounded-lg border border-border bg-card divide-y divide-border">
				{#each byProvider as row (row.model)}
					<div class="px-4 py-3 text-sm">
						<div class="flex items-center gap-2 mb-1.5 flex-wrap">
							<span class="font-medium truncate">{row.provider}</span>
							<span class="font-mono text-xs text-muted-foreground/80 truncate">{row.model}</span>
							<span class="ml-auto font-mono text-xs text-muted-foreground tabular-nums">
								{formatCents(row.cents)} <span class="text-muted-strong">({(row.share * 100).toFixed(0)}%)</span>
							</span>
						</div>
						<div class="relative h-1.5 rounded-full bg-muted overflow-hidden">
							<div
								class="absolute inset-y-0 left-0 {PROVIDER_TINT[row.provider] ?? 'bg-primary'} rounded-full transition-all"
								style="width: {(row.cents / maxProviderCents) * 100}%"
							></div>
						</div>
            <div class="t-telemetry text-muted-strong mt-1">
							{row.requests} {m.costs_requests()}
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
</main>
