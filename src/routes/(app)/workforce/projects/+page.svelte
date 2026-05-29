<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import type { ProjectStatus } from '@minion-stack/paperclip-client';
	import { startPolling } from '$lib/utils/live-polling';
	import LiveIndicator from '$lib/components/LiveIndicator.svelte';
	import { PageHeader } from '$lib/components/ui';
	import { FolderKanban } from 'lucide-svelte';

	let { data }: { data: PageData } = $props();
	const { projects, agentNames } = $derived(data);

	const STATUS_BADGE: Record<ProjectStatus, string> = {
		backlog: 'bg-muted text-muted-foreground',
		planned: 'bg-muted text-muted-foreground',
		in_progress: 'bg-accent/10 text-accent',
		completed: 'bg-success/10 text-success',
		cancelled: 'bg-muted text-muted-strong',
	};

	const STATUS_LABEL: Record<ProjectStatus, string> = {
		backlog: 'Backlog',
		planned: 'Planned',
		in_progress: 'In Progress',
		completed: 'Completed',
		cancelled: 'Cancelled',
	};

	function agentLabel(id: string | null): string {
		if (!id) return '—';
		return agentNames[id] ?? `${id.slice(0, 8)}…`;
	}

	function daysUntil(iso: string | null): string {
		if (!iso) return '';
		const diff = new Date(iso).getTime() - Date.now();
		const days = Math.round(diff / (1000 * 60 * 60 * 24));
		if (days < 0) return `${Math.abs(days)}d overdue`;
		if (days === 0) return 'today';
		if (days === 1) return 'tomorrow';
		return `${days}d`;
	}

	const counts = $derived.by(() => {
		const out: Record<ProjectStatus, number> = {
			backlog: 0, planned: 0, in_progress: 0, completed: 0, cancelled: 0,
		};
		for (const p of projects) out[p.status] = (out[p.status] ?? 0) + 1;
		return out;
	});

	onMount(() => startPolling('app:projects', 8000));
</script>

<PageHeader title="Projects">
	{#snippet leading()}
		<FolderKanban size={16} class="text-accent shrink-0" />
	{/snippet}
	{#snippet actions()}
		<LiveIndicator intervalMs={8000} />
		<div class="flex flex-wrap gap-2 text-xs">
			{#each (['in_progress', 'planned', 'completed', 'backlog', 'cancelled'] as ProjectStatus[]) as s (s)}
				{#if counts[s] > 0}
					<span class="rounded-full px-2 py-0.5 font-medium {STATUS_BADGE[s]}">
						{counts[s]} {STATUS_LABEL[s].toLowerCase()}
					</span>
				{/if}
			{/each}
		</div>
	{/snippet}
</PageHeader>
<main class="flex-1 min-h-0 overflow-y-auto p-6 space-y-6 max-w-5xl">
	{#if projects.length === 0}
		<div class="rounded-lg border border-border bg-card p-12 text-center">
			<p class="text-muted-foreground text-sm">No projects yet.</p>
		</div>
	{:else}
		<ul class="grid grid-cols-1 sm:grid-cols-2 gap-3">
			{#each projects as p (p.id)}
				<li>
					<a
						href="/workforce/projects/{p.id}"
						class="relative block rounded-lg border border-border bg-card p-4 text-foreground no-underline transition-colors hover:bg-muted overflow-hidden"
					>
						<!-- Color stripe -->
						{#if p.color}
							<span
								class="absolute left-0 top-0 bottom-0 w-1"
								style="background:{p.color}"
								aria-hidden="true"
							></span>
						{/if}

						<div class="pl-2 space-y-2">
							<div class="flex items-start justify-between gap-2 flex-wrap">
								<span class="rounded px-1.5 py-0.5 text-[10px] font-medium {STATUS_BADGE[p.status]}">
									{STATUS_LABEL[p.status]}
								</span>
								{#if p.targetDate}
									<span class="text-[10px] text-muted-foreground font-mono">
										target {p.targetDate} <span class="text-muted-strong">· {daysUntil(p.targetDate)}</span>
									</span>
								{/if}
							</div>

							<div class="space-y-1">
								<h2 class="text-base font-semibold leading-tight">{p.name}</h2>
								{#if p.description}
									<p class="text-xs text-muted-foreground line-clamp-2">{p.description}</p>
								{/if}
							</div>

							<div class="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground pt-1">
								<span title="Lead agent">
									<span class="text-muted-strong">lead</span> {agentLabel(p.leadAgentId)}
								</span>
								{#if p.goals.length > 0}
									<span>
										<span class="text-muted-strong">goal</span> {p.goals[0].title}
									</span>
								{/if}
								{#if p.workspaces.length > 0}
									<span class="font-mono">
										{p.workspaces.length} workspace{p.workspaces.length !== 1 ? 's' : ''}
									</span>
								{/if}
							</div>
						</div>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</main>
