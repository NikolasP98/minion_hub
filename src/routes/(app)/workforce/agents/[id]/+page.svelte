<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import { startPolling } from '$lib/utils/live-polling';
	import LiveIndicator from '$lib/components/LiveIndicator.svelte';
	import Sparkline from '$lib/components/Sparkline.svelte';
	import * as m from '$lib/paraglide/messages';

	let { data }: { data: PageData } = $props();
	const { agent, costTrend, runs, issues, harness, harnessSignals, harnessProposals } = $derived(data);

	const trendValues = $derived(costTrend.map((p) => p.cents));
	const totalCostCents = $derived(trendValues.reduce((s, n) => s + n, 0));

	const STATUS_DOT: Record<string, string> = {
		active: '#10b981',
		running: '#3b82f6',
		paused: '#f59e0b',
		error: '#ef4444',
		idle: '#6b7280',
		pending_approval: '#a855f7',
		terminated: '#525252',
	};

	const STATUS_BADGE: Record<string, string> = {
		active: 'bg-green-500/10 text-green-600',
		running: 'bg-blue-500/10 text-blue-600',
		paused: 'bg-amber-500/10 text-amber-600',
		error: 'bg-destructive/10 text-destructive',
		idle: 'bg-muted text-muted-foreground',
		pending_approval: 'bg-purple-500/10 text-purple-600',
		terminated: 'bg-muted text-muted-strong',
	};

	const RUN_STATUS_BADGE: Record<string, string> = {
		succeeded: 'bg-green-500/10 text-green-600',
		failed: 'bg-destructive/10 text-destructive',
		running: 'bg-blue-500/10 text-blue-600',
		cancelled: 'bg-muted text-muted-foreground',
	};

	const ISSUE_STATUS_BADGE: Record<string, string> = {
		in_progress: 'bg-blue-500/10 text-blue-600',
		blocked: 'bg-amber-500/10 text-amber-600',
		todo: 'bg-muted text-muted-foreground',
		backlog: 'bg-muted text-muted-foreground',
		in_review: 'bg-purple-500/10 text-purple-600',
		done: 'bg-green-500/10 text-green-600',
		cancelled: 'bg-muted text-muted-strong',
	};

	function formatCents(cents: number): string {
		return `$${(cents / 100).toFixed(2)}`;
	}

	function formatDuration(ms: number | null): string {
		if (ms === null) return '—';
		if (ms < 1000) return `${ms}ms`;
		if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
		return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
	}

	function relativeTime(iso: string | Date): string {
		const diff = Date.now() - new Date(iso).getTime();
		if (diff < 60_000) return 'just now';
		if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
		if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
		return `${Math.floor(diff / 86_400_000)}d ago`;
	}

	function initials(name: string): string {
		return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
	}

	onMount(() => startPolling('app:agent', 6000));
</script>

<div class="p-6 space-y-6 max-w-5xl">
	<!-- Breadcrumb -->
	<nav class="text-sm text-muted-foreground flex items-center gap-1">
		<a href="/workforce/org" class="hover:text-foreground">Org</a>
		<span>/</span>
		<span class="text-foreground">{agent.name}</span>
	</nav>

	<!-- Header card -->
	<header class="rounded-lg border border-border bg-card p-5 flex items-start gap-4">
		<div class="relative shrink-0">
			<div class="w-16 h-16 rounded-full bg-muted flex items-center justify-center text-xl font-semibold text-foreground/70">
				{initials(agent.name)}
			</div>
			<span
				class="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-card"
				style="background:{STATUS_DOT[agent.status] ?? STATUS_DOT.idle}"
				title={agent.status}
			></span>
		</div>
		<div class="flex-1 min-w-0 space-y-1.5">
			<div class="flex items-center gap-3 flex-wrap">
				<h1 class="text-2xl font-semibold">{agent.name}</h1>
				<span class="rounded px-1.5 py-0.5 text-xs font-medium {STATUS_BADGE[agent.status] ?? STATUS_BADGE.idle}">
					{agent.status}
				</span>
				<LiveIndicator intervalMs={6000} />
			</div>
			<div class="text-sm text-muted-foreground">
				{agent.title ?? agent.role}
				· <span class="font-mono text-xs">{agent.adapterType}</span>
				{#if agent.capabilities}
					<div class="mt-1 text-foreground/80">{agent.capabilities}</div>
				{/if}
			</div>
		</div>
	</header>

	<!-- Living Harness: active execution truth is deliberately separate from recommendations. -->
	<section class="rounded-lg border border-border bg-card p-4 space-y-4">
		<div class="flex items-start justify-between gap-3">
			<div>
				<h2 class="text-sm font-semibold">{m.workforce_harness_title()}</h2>
				<p class="text-xs text-muted-foreground">{m.workforce_harness_subtitle()}</p>
			</div>
			{#if harness}
				<span class="rounded bg-muted px-2 py-1 font-mono text-xs" title={harness.hash ?? undefined}>
					r{harness.revision ?? '?'} · {harness.hash?.slice(0, 8) ?? m.workforce_harness_unpinned()}
				</span>
			{/if}
		</div>
		{#if harness}
			<div class="grid gap-3 md:grid-cols-2">
				<div class="rounded-md border border-border bg-background p-3 space-y-2">
					<div class="text-[11px] font-semibold uppercase tracking-wider text-green-600">{m.workforce_harness_active()}</div>
					<div class="text-sm font-medium font-mono">{harness.activePrimary?.model ?? '—'}</div>
					<div class="text-xs text-muted-foreground">{harness.activePrimary?.provider ?? agent.adapterType} · {harness.runtimeClass ?? '—'} · {harness.roleClass ?? agent.role}</div>
					{#if harness.activeFallbacks.length}<div class="text-xs text-muted-foreground">{m.workforce_harness_fallbacks()}: {harness.activeFallbacks.map((item) => item.model).join(' → ')}</div>{/if}
				</div>
				<div class="rounded-md border border-dashed border-border bg-muted/30 p-3 space-y-2" class:opacity-60={harness.recommendedPrimary?.executable === false}>
					<div class="text-[11px] font-semibold uppercase tracking-wider text-amber-600">{m.workforce_harness_recommended()}</div>
					<div class="text-sm font-medium font-mono">{harness.recommendedPrimary?.model ?? m.workforce_harness_noRecommendation()}</div>
					{#if harness.recommendedPrimary}
						<div class="text-xs text-muted-foreground">{harness.recommendedPrimary.runtimeKind ?? harness.recommendedPrimary.adapterType ?? '—'} · {harness.recommendedPrimary.provider ?? '—'}</div>
					{/if}
					{#if harness.recommendedPrimary?.bridgePending}
						<span class="inline-flex rounded bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700">{m.workforce_harness_bridgePending()}</span>
					{/if}
					{#if harness.recommendedFallbacks.length}<div class="text-xs text-muted-foreground">{m.workforce_harness_fallbacks()}: {harness.recommendedFallbacks.map((item) => item.model).join(' → ')}</div>{/if}
					<p class="text-xs text-muted-foreground">{m.workforce_harness_recommendationHint()}</p>
				</div>
			</div>
			<div class="grid gap-3 sm:grid-cols-3 text-xs">
				<div><span class="text-muted-foreground">{m.workforce_harness_skills()}</span><div class="mt-1">{harness.skills.join(', ') || '—'}</div></div>
				<div><span class="text-muted-foreground">{m.workforce_harness_tools()}</span><div class="mt-1">{harness.tools.join(', ') || '—'}</div></div>
				<div><span class="text-muted-foreground">{m.workforce_harness_learningPolicy()}</span><div class="mt-1">{harness.learningPolicy ?? '—'}</div></div>
			</div>
			<div class="flex flex-wrap gap-2 text-xs">
				<span class="rounded bg-muted px-2 py-1">{m.workforce_harness_runs()}: {harness.performance.runCount ?? '—'}</span>
				<span class="rounded bg-muted px-2 py-1">{m.workforce_harness_success()}: {harness.performance.successRate == null ? '—' : `${Math.round(harness.performance.successRate * 100)}%`}</span>
				<span class="rounded bg-muted px-2 py-1">{m.workforce_harness_score()}: {harness.performance.avgScore?.toFixed(1) ?? '—'}</span>
				<span class="rounded bg-muted px-2 py-1">{m.workforce_harness_revisions()}: {data.harnessRevisionCount}</span>
			</div>
			{#if harnessSignals.length || harnessProposals.length}
				<div class="grid gap-3 md:grid-cols-2 text-xs">
					<div><h3 class="font-medium mb-1">{m.workforce_harness_recentSignals()}</h3>{#each harnessSignals as signal (signal.id)}<p class="text-muted-foreground">{signal.kind} · {signal.summary}</p>{/each}</div>
					<div><h3 class="font-medium mb-1">{m.workforce_harness_recentProposals()}</h3>{#each harnessProposals as proposal (proposal.id)}<p class="text-muted-foreground"><span class="text-amber-600">{proposal.status}</span> · {proposal.summary}</p>{/each}</div>
				</div>
			{/if}
		{:else}
			<p class="text-sm text-muted-foreground">{m.workforce_harness_unavailable()}</p>
		{/if}
	</section>

	<!-- 3-column KPI row: cost / runs / issues -->
	<section class="grid grid-cols-1 sm:grid-cols-3 gap-4">
		<div class="rounded-lg border border-border bg-card p-4 space-y-2">
			<div class="flex items-start justify-between gap-2">
				<div class="space-y-1">
					<h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Cost (14d)</h2>
					<div class="text-2xl font-semibold tabular-nums">{formatCents(totalCostCents)}</div>
				</div>
				{#if trendValues.length > 1}
					<div class="text-primary shrink-0 mt-1">
						<Sparkline values={trendValues} width={100} height={32} />
					</div>
				{/if}
			</div>
			<div class="text-xs text-muted-foreground">
				of {formatCents(agent.budgetMonthlyCents)} monthly budget
			</div>
		</div>

		<div class="rounded-lg border border-border bg-card p-4 space-y-1">
			<h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Recent runs</h2>
			<div class="text-2xl font-semibold tabular-nums">{runs.length}</div>
			<div class="text-xs text-muted-foreground">
				{runs.filter((r) => r.status === 'succeeded').length} succeeded · {runs.filter((r) => r.status === 'failed').length} failed
			</div>
		</div>

		<div class="rounded-lg border border-border bg-card p-4 space-y-1">
			<h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Assigned issues</h2>
			<div class="text-2xl font-semibold tabular-nums">{issues.length}</div>
			<div class="text-xs text-muted-foreground">
				{#if agent.lastHeartbeatAt}
					Last heartbeat {relativeTime(agent.lastHeartbeatAt)}
				{:else}
					No heartbeat yet
				{/if}
			</div>
		</div>
	</section>

	<!-- Two-column main: runs + issues -->
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
		<!-- Recent runs timeline -->
		<section>
			<h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
				Recent runs
			</h2>
			{#if runs.length === 0}
				<div class="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
					No recent runs.
				</div>
			{:else}
				<ul class="rounded-lg border border-border bg-card divide-y divide-border">
					{#each runs as run (run.id)}
						<li class="px-4 py-3 text-sm flex items-center gap-3">
							<span class="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium {RUN_STATUS_BADGE[run.status] ?? 'bg-muted'}">
								{run.status}
							</span>
							<div class="flex-1 min-w-0">
								<div class="font-mono text-xs text-muted-foreground truncate">{run.id}</div>
								<div class="text-xs text-muted-foreground/80 mt-0.5">
									{run.source} · {formatDuration(run.durationMs)} · {formatCents(run.costCents)}
								</div>
							</div>
							{#if run.issueId}
								<a href="/workforce/issues/{run.issueId}" class="shrink-0 font-mono text-xs text-primary hover:underline">
									{run.issueId}
								</a>
							{/if}
							<time
								class="shrink-0 text-xs text-muted-foreground"
								datetime={run.startedAt}
							>
								{relativeTime(run.startedAt)}
							</time>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<!-- Assigned issues -->
		<section>
			<h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
				Assigned issues
			</h2>
			{#if issues.length === 0}
				<div class="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
					No issues currently assigned.
				</div>
			{:else}
				<ul class="rounded-lg border border-border bg-card divide-y divide-border">
					{#each issues as issue (issue.id)}
						<li>
							<a
								href="/workforce/issues/{issue.id}"
								class="px-4 py-3 flex items-center gap-3 text-sm hover:bg-muted transition-colors"
							>
								<span class="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium {ISSUE_STATUS_BADGE[issue.status] ?? 'bg-muted'}">
									{issue.status}
								</span>
								{#if issue.identifier}
									<span class="shrink-0 text-xs font-mono text-muted-foreground">{issue.identifier}</span>
								{/if}
								<span class="flex-1 min-w-0 truncate font-medium">{issue.title}</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>

	<!-- Pause reason banner -->
	{#if agent.pauseReason}
		<div class="rounded-lg border border-amber-300/30 bg-amber-500/5 px-4 py-3 text-sm">
			<span class="font-medium text-amber-600">Paused</span>
			<span class="text-muted-foreground ml-1">— reason: {agent.pauseReason}</span>
			{#if agent.pausedAt}
				<span class="text-muted-foreground ml-1">· {relativeTime(agent.pausedAt)}</span>
			{/if}
		</div>
	{/if}

	<!-- Metadata footer -->
	<footer class="text-xs text-muted-foreground font-mono">
		{agent.id}
	</footer>
</div>
