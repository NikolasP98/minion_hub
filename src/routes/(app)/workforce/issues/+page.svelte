<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import type { IssueStatus } from '@minion-stack/paperclip-client';
	import { startPolling } from '$lib/utils/live-polling';
	import LiveIndicator from '$lib/components/LiveIndicator.svelte';
	import { PageHeader } from '$lib/components/ui';
	import { ListTodo } from 'lucide-svelte';

	let { data }: { data: PageData } = $props();

	const { items, status } = $derived(data);

	onMount(() => startPolling('app:issues', 5000));

	const STATUS_ORDER: IssueStatus[] = ['in_progress', 'blocked', 'todo', 'backlog', 'in_review', 'done', 'cancelled'];

	const STATUS_LABELS: Record<IssueStatus, string> = {
		in_progress: 'In Progress',
		blocked: 'Blocked',
		todo: 'To Do',
		backlog: 'Backlog',
		in_review: 'In Review',
		done: 'Done',
		cancelled: 'Cancelled',
	};

	const STATUS_BADGE: Record<IssueStatus, string> = {
		in_progress: 'bg-blue-500/10 text-blue-600',
		blocked: 'bg-amber-500/10 text-amber-600',
		todo: 'bg-muted text-muted-foreground',
		backlog: 'bg-muted text-muted-foreground',
		in_review: 'bg-purple-500/10 text-purple-600',
		done: 'bg-green-500/10 text-green-600',
		cancelled: 'bg-muted text-muted-strong',
	};

	const PRIORITY_BADGE: Record<string, string> = {
		critical: 'text-red-500',
		high: 'text-orange-500',
		medium: 'text-yellow-600',
		low: 'text-muted-foreground',
	};

	// Group issues by status in display order; skip empty groups
	const grouped = $derived(() => {
		const map = new Map<IssueStatus, typeof items>();
		for (const s of STATUS_ORDER) map.set(s, []);
		for (const issue of items) {
			const bucket = map.get(issue.status);
			if (bucket) bucket.push(issue);
		}
		return STATUS_ORDER
			.map((s) => ({ status: s, issues: map.get(s) ?? [] }))
			.filter((g) => g.issues.length > 0);
	});

	function formatDate(d: Date | string): string {
		return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
	}
</script>

<PageHeader title="Issues">
	{#snippet leading()}
		<ListTodo size={16} class="text-accent shrink-0" />
	{/snippet}
	{#snippet actions()}
		<LiveIndicator intervalMs={5000} />
		{#if status}
			<a
				href="/workforce/issues"
				class="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium hover:bg-primary/15"
				title="Clear filter"
			>
				status: {STATUS_LABELS[status as IssueStatus] ?? status}
				<span aria-hidden="true">×</span>
			</a>
		{/if}
		<span class="text-sm text-muted-foreground">{items.length} issue{items.length !== 1 ? 's' : ''}</span>
	{/snippet}
</PageHeader>
<main class="flex-1 min-h-0 overflow-y-auto p-6 space-y-6">
	{#if items.length === 0}
		<div class="rounded-lg border border-border bg-card p-12 flex flex-col items-center justify-center text-center">
			<p class="text-muted-foreground text-sm">No issues found.</p>
		</div>
	{:else}
		{#each grouped() as group (group.status)}
			<section aria-label={STATUS_LABELS[group.status]}>
				<h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
					{STATUS_LABELS[group.status]}
					<span class="text-xs font-medium text-muted-foreground/60 normal-case tracking-normal">
						{group.issues.length}
					</span>
				</h2>
				<ul class="divide-y divide-border rounded-lg border border-border bg-card">
					{#each group.issues as issue (issue.id)}
						<li>
							<a href="/workforce/issues/{issue.id}" class="px-4 py-2.5 flex items-center gap-3 text-sm hover:bg-muted transition-colors">
								<!-- Status badge -->
								<span
									class="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium {STATUS_BADGE[issue.status]}"
								>
									{STATUS_LABELS[issue.status]}
								</span>

								<!-- Identifier -->
								{#if issue.identifier}
									<span class="shrink-0 text-xs font-mono text-muted-foreground">
										{issue.identifier}
									</span>
								{/if}

								<!-- Title -->
								<span class="flex-1 min-w-0 truncate font-medium">{issue.title}</span>

							<!-- Priority -->
							{#if issue.priority}
								<span class="shrink-0 text-xs font-medium {PRIORITY_BADGE[issue.priority] ?? 'text-muted-foreground'}">
									{issue.priority}
								</span>
							{/if}

							<!-- Assignee -->
							{#if issue.assigneeAgentId}
								<span class="shrink-0 text-xs text-muted-foreground truncate max-w-[8rem]" title={issue.assigneeAgentId}>
									{issue.assigneeAgentId.slice(0, 8)}…
								</span>
							{/if}

								<!-- Created at -->
								<time
									class="shrink-0 text-xs text-muted-foreground whitespace-nowrap"
									datetime={new Date(issue.createdAt).toISOString()}
								>
									{formatDate(issue.createdAt)}
								</time>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	{/if}
</main>
