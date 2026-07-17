<script lang="ts">
	import type { PageData } from './$types';
	import { PageHeader } from '$lib/components/ui';
	import MarkdownMessage from '$lib/components/chat/MarkdownMessage.svelte';
	import { Layers, Bot, AlertTriangle } from 'lucide-svelte';
	import * as m from '$lib/paraglide/messages';

	let { data }: { data: PageData } = $props();

	const statusLabel: Record<string, string> = {
		active: m.workforce_portfolios_status_active(),
		archived: m.workforce_portfolios_status_archived(),
	};

	const rollup = $derived(data.metrics?.rollup ?? null);
	const openTotal = $derived(
		rollup ? Object.values(rollup.openByStatus).reduce((a, b) => a + b, 0) : 0,
	);
	const kpis = $derived(
		rollup
			? [
					{ label: m.workforce_portfolios_kpi_open(), value: String(openTotal) },
					{ label: m.workforce_portfolios_kpi_created30d(), value: String(rollup.createdLast30d) },
					{ label: m.workforce_portfolios_kpi_completed30d(), value: String(rollup.completedLast30d) },
					{ label: m.workforce_portfolios_kpi_cycleH(), value: rollup.avgCycleTimeHours == null ? '—' : rollup.avgCycleTimeHours.toFixed(1) },
					{ label: m.workforce_portfolios_kpi_changesPct(), value: rollup.changesRequestedRate == null ? '—' : `${Math.round(rollup.changesRequestedRate * 100)}%` },
					{ label: m.workforce_portfolios_kpi_evalScore(), value: rollup.avgEvalScore == null ? '—' : rollup.avgEvalScore.toFixed(1) },
					{ label: m.workforce_portfolios_kpi_workspaces(), value: String(rollup.activeWorkspaces) },
				]
			: [],
	);

	// Per-project metrics buckets, matched by paperclip project id.
	const projectMetrics = $derived(
		new Map((data.metrics?.projects ?? []).map((p) => [p.projectId, p])),
	);
</script>

<svelte:head><title>{data.portfolio.name}</title></svelte:head>

<div class="flex flex-col h-full min-h-0 flex-1 min-w-0">
	<PageHeader title={data.portfolio.name} subtitle={m.workforce_portfolios()} />

	<div class="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4">
		<!-- Charter panel -->
		<section class="card charter">
			<div class="head">
				<span class="name"><Layers size={15} /> {data.portfolio.name}</span>
				<span class="status s-{data.portfolio.status}">{statusLabel[data.portfolio.status] ?? data.portfolio.status}</span>
				{#if data.portfolio.leadAgentId}
					<span class="lead t-caption"><Bot size={13} /> {data.agentNames[data.portfolio.leadAgentId] ?? data.portfolio.leadAgentId}</span>
				{/if}
			</div>
			{#if data.portfolio.objective}
				<div class="block">
					<h3>{m.workforce_portfolios_objective()}</h3>
					<p class="pre">{data.portfolio.objective}</p>
				</div>
			{/if}
			{#if data.portfolio.guardrails}
				<div class="block">
					<h3>{m.workforce_portfolios_guardrails()}</h3>
					<MarkdownMessage value={data.portfolio.guardrails} />
				</div>
			{/if}
			{#if data.portfolio.charter}
				<div class="block">
					<h3>{m.workforce_portfolios_charter()}</h3>
					<MarkdownMessage value={data.portfolio.charter} />
				</div>
			{/if}
		</section>

		<!-- KPI row -->
		{#if rollup}
			<div class="kpis">
				{#each kpis as k (k.label)}
					<div class="kpi"><span class="n">{k.value}</span><span class="l">{k.label}</span></div>
				{/each}
			</div>
		{:else}
			<p class="t-caption">{m.workforce_portfolios_metricsUnavailable()}</p>
		{/if}

		<!-- Projects grid -->
		<section>
			<h2 class="sec">{m.workforce_portfolios_projects_title()}</h2>
			<div class="grid-list">
				{#each data.projects as p (p.id)}
					{@const pm = projectMetrics.get(p.id)}
					<!-- Paperclip project ids ≠ native hub project ids, so no per-project deep link (v1). -->
					<a class="card pcard" href="/workforce/projects" title={m.workforce_portfolios_projectHint()}>
						<div class="head">
							<span class="name">{#if p.color}<span class="dot" style="background:{p.color}"></span>{/if}{p.name}</span>
							<span class="status">{p.status}</span>
						</div>
						{#if pm}
							<div class="dist">
								{#each Object.entries(pm.openByStatus) as [status, count] (status)}
									<span class="chip">{status} <b>{count}</b></span>
								{/each}
							</div>
						{/if}
					</a>
				{:else}
					<p class="t-caption empty">{m.workforce_portfolios_noProjects()}</p>
				{/each}
			</div>
		</section>

		<!-- Stuck issues -->
		{#if rollup}
			<section class="card stuck">
				<header class="stuck-head"><AlertTriangle size={14} /> {m.workforce_portfolios_stuck()}</header>
				{#each rollup.stuckIssues as issue (issue.id)}
					<a class="row" href={`/workforce/issues/${issue.id}`}>
						<span class="name">{#if issue.identifier}<span class="hid">{issue.identifier}</span> {/if}{issue.title}</span>
						<span class="status">{issue.status}</span>
						<span class="target t-caption">{new Date(issue.updatedAt).toLocaleDateString()}</span>
					</a>
				{:else}
					<p class="t-caption empty">{m.workforce_portfolios_noStuck()}</p>
				{/each}
			</section>
		{/if}
	</div>
</div>

<style>
	.card { border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); }
	.charter { padding: var(--space-3) var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
	.head { display: flex; align-items: center; gap: var(--space-2); }
	.name { display: flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-page-title); font-weight: 600; min-width: 0; }
	.status { font-size: var(--font-size-caption); padding: var(--space-0-5) var(--space-2); border-radius: var(--radius-full); border: 1px solid var(--hairline); color: var(--color-muted-foreground); flex: 0 0 auto; }
	.s-active { color: var(--color-success, var(--color-success-border)); }
	.lead { display: inline-flex; align-items: center; gap: var(--space-2); margin-left: auto; }
	.block h3 { font-size: var(--font-size-caption); text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-muted-foreground); margin: 0 0 var(--space-1); }
	.pre { white-space: pre-wrap; font-size: var(--font-size-body); margin: 0; }
	.kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr)); gap: var(--space-3); }
	.kpi { display: flex; align-items: center; gap: var(--space-2); border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); padding: var(--space-3) var(--space-4); color: var(--color-muted-foreground); }
	.kpi .n { font-size: var(--font-size-display); font-weight: 700; color: var(--color-foreground); font-variant-numeric: tabular-nums; }
	.kpi .l { font-size: var(--font-size-caption); margin-left: auto; text-align: right; }
	.sec { font-size: var(--font-size-body); text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-muted-foreground); margin: 0 0 var(--space-2); }
	.grid-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr)); gap: var(--space-3); }
	.pcard { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3) var(--space-4); text-decoration: none; color: var(--color-foreground); }
	.pcard:hover { background: var(--color-bg3); }
	.dot { width: 0.6rem; height: 0.6rem; border-radius: var(--radius-full); flex: 0 0 auto; }
	.dist { display: flex; flex-wrap: wrap; gap: var(--space-2); }
	.chip { font-size: var(--font-size-caption); padding: var(--space-0-5) var(--space-2); border-radius: var(--radius-full); border: 1px solid var(--hairline); background: var(--color-bg3); color: var(--color-muted-foreground); }
	.chip b { color: var(--color-foreground); font-variant-numeric: tabular-nums; }
	.stuck { padding: var(--space-1) 0; }
	.stuck-head { display: flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-body); color: var(--color-muted-foreground); padding: var(--space-2) var(--space-4) var(--space-2); }
	.row { display: grid; grid-template-columns: 1fr 8rem 7rem; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-4); font-size: var(--font-size-body); color: var(--color-foreground); text-decoration: none; }
	.row + .row { border-top: 1px solid var(--hairline); }
	.row:hover { background: var(--color-bg3); }
	.hid { font-variant-numeric: tabular-nums; color: var(--color-muted-foreground); font-size: var(--font-size-body); }
	.target { justify-self: end; font-variant-numeric: tabular-nums; }
	.empty { padding: var(--space-2) var(--space-4); }
</style>
