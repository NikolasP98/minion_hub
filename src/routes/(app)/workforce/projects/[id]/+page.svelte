<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import type { ProjectStatus } from '@minion-stack/paperclip-client';
	import { startPolling } from '$lib/util/live-polling';
	import LiveIndicator from '$lib/components/LiveIndicator.svelte';

	let { data }: { data: PageData } = $props();
	const { project, issues, agentNames } = $derived(data);

	const STATUS_BADGE: Record<ProjectStatus, string> = {
		backlog: 'bg-muted text-muted-foreground',
		planned: 'bg-muted text-muted-foreground',
		in_progress: 'bg-blue-500/10 text-blue-600',
		completed: 'bg-green-500/10 text-green-600',
		cancelled: 'bg-muted text-muted-foreground/50',
	};

	const STATUS_LABEL: Record<ProjectStatus, string> = {
		backlog: 'Backlog',
		planned: 'Planned',
		in_progress: 'In Progress',
		completed: 'Completed',
		cancelled: 'Cancelled',
	};

	const ISSUE_STATUS_BADGE: Record<string, string> = {
		in_progress: 'bg-blue-500/10 text-blue-600',
		blocked: 'bg-amber-500/10 text-amber-600',
		todo: 'bg-muted text-muted-foreground',
		backlog: 'bg-muted text-muted-foreground',
		in_review: 'bg-purple-500/10 text-purple-600',
		done: 'bg-green-500/10 text-green-600',
		cancelled: 'bg-muted text-muted-foreground/50',
	};

	function agentLabel(id: string | null): string {
		if (!id) return '—';
		return agentNames[id] ?? `${id.slice(0, 8)}…`;
	}

	function formatDate(d: Date | string | null): string {
		if (!d) return '—';
		return new Date(d).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
	}

	function daysUntil(iso: string | null): string {
		if (!iso) return '';
		const diff = new Date(iso).getTime() - Date.now();
		const days = Math.round(diff / (1000 * 60 * 60 * 24));
		if (days < 0) return `${Math.abs(days)}d overdue`;
		if (days === 0) return 'today';
		return `in ${days}d`;
	}

	onMount(() => startPolling('app:project', 6000));
</script>

<div class="p-6 space-y-6 max-w-5xl">
	<!-- Breadcrumb -->
	<nav class="text-sm text-muted-foreground flex items-center gap-1">
		<a href="/workforce/projects" class="hover:text-foreground">Projects</a>
		<span>/</span>
		<span class="text-foreground truncate">{project.name}</span>
	</nav>

	<!-- Header -->
	<header class="rounded-lg border border-border bg-card p-5 relative overflow-hidden">
		{#if project.color}
			<span
				class="absolute left-0 top-0 bottom-0 w-1.5"
				style="background:{project.color}"
				aria-hidden="true"
			></span>
		{/if}
		<div class="pl-3 space-y-3">
			<div class="flex items-center gap-3 flex-wrap">
				<span class="rounded px-1.5 py-0.5 text-xs font-medium {STATUS_BADGE[project.status]}">
					{STATUS_LABEL[project.status]}
				</span>
				<span class="text-[10px] font-mono text-muted-foreground">{project.urlKey}</span>
				<LiveIndicator intervalMs={6000} />
			</div>
			<h1 class="text-2xl font-semibold">{project.name}</h1>
			{#if project.description}
				<p class="text-sm text-muted-foreground leading-relaxed">{project.description}</p>
			{/if}
		</div>
	</header>

	<!-- KPI row -->
	<section class="grid grid-cols-2 sm:grid-cols-4 gap-4">
		<div class="rounded-lg border border-border bg-card p-4 space-y-1">
			<h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Lead</h2>
			<div class="text-sm font-medium truncate">{agentLabel(project.leadAgentId)}</div>
		</div>
		<div class="rounded-lg border border-border bg-card p-4 space-y-1">
			<h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Target</h2>
			<div class="text-sm font-medium tabular-nums">{project.targetDate ?? '—'}</div>
			{#if project.targetDate}
				<div class="text-[10px] text-muted-foreground">{daysUntil(project.targetDate)}</div>
			{/if}
		</div>
		<div class="rounded-lg border border-border bg-card p-4 space-y-1">
			<h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Workspaces</h2>
			<div class="text-2xl font-semibold tabular-nums">{project.workspaces.length}</div>
		</div>
		<div class="rounded-lg border border-border bg-card p-4 space-y-1">
			<h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Issues</h2>
			<div class="text-2xl font-semibold tabular-nums">{issues.length}</div>
		</div>
	</section>

	<!-- Linked goals -->
	{#if project.goals.length > 0}
		<section>
			<h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
				Linked goals
			</h2>
			<ul class="rounded-lg border border-border bg-card divide-y divide-border">
				{#each project.goals as goal (goal.id)}
					<li>
						<a
							href="/workforce/goals"
							class="block px-4 py-3 text-sm text-foreground no-underline hover:bg-muted transition-colors"
						>
							{goal.title}
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<!-- Workspaces -->
	<section>
		<h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
			Workspaces ({project.workspaces.length})
		</h2>
		{#if project.workspaces.length === 0}
			<div class="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
				No workspaces configured.
			</div>
		{:else}
			<ul class="rounded-lg border border-border bg-card divide-y divide-border">
				{#each project.workspaces as ws (ws.id)}
					<li class="px-4 py-3 text-sm space-y-1">
						<div class="flex items-center gap-2 flex-wrap">
							<span class="font-medium">{ws.name}</span>
							{#if ws.isPrimary}
								<span class="rounded px-1.5 py-0.5 text-[10px] font-medium bg-primary/10 text-primary">primary</span>
							{/if}
							<span class="font-mono text-[10px] text-muted-foreground/70">{ws.sourceType}</span>
						</div>
						{#if ws.repoUrl}
							<div class="font-mono text-xs text-muted-foreground truncate">{ws.repoUrl} · {ws.repoRef ?? 'main'}</div>
						{:else if ws.cwd}
							<div class="font-mono text-xs text-muted-foreground truncate">{ws.cwd}</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- Linked issues -->
	<section>
		<h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
			Issues ({issues.length})
		</h2>
		{#if issues.length === 0}
			<div class="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
				No issues linked to this project.
			</div>
		{:else}
			<ul class="rounded-lg border border-border bg-card divide-y divide-border">
				{#each issues as issue (issue.id)}
					<li>
						<a
							href="/workforce/issues/{issue.id}"
							class="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground no-underline hover:bg-muted transition-colors"
						>
							<span class="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium {ISSUE_STATUS_BADGE[issue.status]}">
								{issue.status}
							</span>
							{#if issue.identifier}
								<span class="shrink-0 text-xs font-mono text-muted-foreground">{issue.identifier}</span>
							{/if}
							<span class="flex-1 min-w-0 truncate font-medium">{issue.title}</span>
							{#if issue.assigneeAgentId}
								<span class="shrink-0 text-xs text-muted-foreground truncate max-w-[10rem]">
									{agentLabel(issue.assigneeAgentId)}
								</span>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- Metadata footer -->
	<footer class="text-xs text-muted-foreground space-y-0.5 pt-2">
		<div><span class="font-mono">{project.id}</span></div>
		<div>created {formatDate(project.createdAt)} · updated {formatDate(project.updatedAt)}</div>
	</footer>
</div>
