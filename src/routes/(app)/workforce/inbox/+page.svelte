<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import type { InboxItem, PipelineHitlInboxItem } from '$lib/workforce/pipeline-inbox';
	import * as m from '$lib/paraglide/messages';
	import { startPolling } from '$lib/utils/live-polling';
	import LiveIndicator from '$lib/components/LiveIndicator.svelte';

	let { data }: { data: PageData } = $props();
	const { items, agentNames } = $derived(data);

	let filter = $state<'all' | 'unread'>('all');

	const filtered = $derived.by(() => {
		if (filter === 'unread') return items.filter((i) => !i.readAt);
		return items;
	});

	const unreadCount = $derived(items.filter((i) => !i.readAt).length);

	// Type → icon glyph + accent color
	const TYPE_META: Record<InboxItem['type'], { icon: string; tint: string; label: string }> = {
		comment: { icon: '💬', tint: 'bg-blue-500/10 text-blue-600 border-blue-500/30', label: m.inbox_comment() },
		mention: { icon: '@', tint: 'bg-purple-500/10 text-purple-600 border-purple-500/30', label: m.inbox_mention() },
		approval: { icon: '✓', tint: 'bg-amber-500/10 text-amber-600 border-amber-500/30', label: m.inbox_approval() },
		run_failed: { icon: '!', tint: 'bg-destructive/10 text-destructive border-destructive/30', label: m.inbox_runFailed() },
		join_request: { icon: '+', tint: 'bg-blue-500/10 text-blue-600 border-blue-500/30', label: m.inbox_joinRequest() },
		goal_achieved: { icon: '★', tint: 'bg-green-500/10 text-green-600 border-green-500/30', label: m.inbox_goalAchieved() },
		paused: { icon: '⏸', tint: 'bg-muted text-muted-foreground border-border', label: m.inbox_paused() },
		pipeline_hitl: { icon: '◇', tint: 'bg-violet-500/10 text-violet-600 border-violet-500/30', label: m.inbox_pipelineHitl() },
	};

	const TASK_STATUS_LABEL: Record<PipelineHitlInboxItem['taskStatus'], string> = {
		todo: m.inbox_taskTodo(),
		in_progress: m.inbox_taskInProgress(),
		in_review: m.inbox_taskInReview(),
	};

	function bucketLabel(iso: string): string {
		const d = new Date(iso).getTime();
		const now = Date.now();
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const startOfToday = today.getTime();
		const startOfYesterday = startOfToday - 86_400_000;
		const startOfWeek = startOfToday - 6 * 86_400_000;
		if (d >= startOfToday) return m.common_today();
		if (d >= startOfYesterday) return m.common_yesterday();
		if (d >= startOfWeek) return m.inbox_thisWeek();
		return m.inbox_earlier();
	}

	const grouped = $derived.by(() => {
		const buckets: Array<{ label: string; items: InboxItem[] }> = [];
		const order = [m.common_today(), m.common_yesterday(), m.inbox_thisWeek(), m.inbox_earlier()];
		const map = new Map<string, InboxItem[]>();
		for (const item of filtered) {
			const b = bucketLabel(item.createdAt);
			if (!map.has(b)) map.set(b, []);
			map.get(b)!.push(item);
		}
		for (const label of order) {
			const list = map.get(label);
			if (list && list.length > 0) buckets.push({ label, items: list });
		}
		return buckets;
	});

	function relativeTime(iso: string): string {
		const diff = Date.now() - new Date(iso).getTime();
		if (diff < 60_000) return m.common_justNow();
		if (diff < 3_600_000) return m.common_minutesAgo({ count: Math.floor(diff / 60_000) });
		if (diff < 86_400_000) return m.common_hoursAgo({ count: Math.floor(diff / 3_600_000) });
		return m.common_daysAgo({ count: Math.floor(diff / 86_400_000) });
	}

	function actorLabel(agentId: string | null, userId: string | null): string {
		if (agentId) return agentNames[agentId] ?? `${agentId.slice(0, 8)}…`;
		if (userId) return `user:${userId.slice(0, 6)}…`;
		return 'system';
	}

	function assignmentLabel(item: PipelineHitlInboxItem): string {
		if (item.assignmentKind === 'user') return m.inbox_pipelineAssignedToYou();
		return m.inbox_pipelineAssignedRole({ role: item.assignmentRoleKeys.join(', ') });
	}

	onMount(() => startPolling('app:inbox', 6000));
</script>

<div class="p-6 space-y-6 max-w-4xl">
	<header class="flex items-center justify-between flex-wrap gap-3">
		<div class="flex items-center gap-3">
			<h1 class="text-2xl font-semibold">{m.workforce_inbox()}</h1>
			{#if data.liveInboxAvailable}
				<LiveIndicator intervalMs={6000} />
			{/if}
			{#if unreadCount > 0}
				<span class="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium">
					{unreadCount} {m.inbox_unread()}
				</span>
			{/if}
		</div>

		<!-- Filter tabs -->
		<div class="flex gap-1 rounded-lg border border-border bg-card p-1">
			<button
				type="button"
				class="px-3 py-1 rounded text-xs font-medium transition-colors {filter === 'all' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}"
				onclick={() => (filter = 'all')}
			>
				{m.inbox_all()} ({items.length})
			</button>
			<button
				type="button"
				class="px-3 py-1 rounded text-xs font-medium transition-colors {filter === 'unread' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}"
				onclick={() => (filter = 'unread')}
			>
				{m.inbox_unread()} ({unreadCount})
			</button>
		</div>
	</header>

	{#if !data.liveInboxAvailable}
		<div class="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3" role="status">
			<p class="text-sm font-medium text-amber-800 dark:text-amber-200">{m.inbox_liveUnavailableTitle()}</p>
			<p class="mt-0.5 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
				{m.inbox_liveUnavailableDescription()}
			</p>
		</div>
	{/if}

	{#if filtered.length === 0}
		<div class="rounded-lg border border-border bg-card p-12 flex flex-col items-center justify-center text-center">
			<div class="text-3xl mb-2">📬</div>
			<p class="text-muted-foreground text-sm">
				{filter === 'unread' ? m.inbox_allCaughtUp() : m.inbox_noNotifications()}
			</p>
		</div>
	{:else}
		{#each grouped as bucket (bucket.label)}
			<section class="space-y-2">
				<h2 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
					{bucket.label}
				</h2>
				<ul class="rounded-lg border border-border bg-card divide-y divide-border">
					{#each bucket.items as item (item.id)}
						{@const meta = TYPE_META[item.type]}
						{@const Tag = item.href ? 'a' : 'div'}
						<svelte:element
							this={Tag}
							href={item.href ?? undefined}
							class="relative flex items-start gap-3 px-4 py-3 text-sm text-foreground no-underline transition-colors {item.href ? 'hover:bg-muted' : ''} {!item.readAt ? 'border-l-2 border-l-primary -ml-px' : ''}"
						>
							<!-- Type icon badge -->
							<span
								class="shrink-0 mt-0.5 h-7 w-7 flex items-center justify-center rounded-md border text-sm font-medium {meta.tint}"
								title={meta.label}
								aria-label={meta.label}
							>
								{meta.icon}
							</span>

							<!-- Body -->
							<div class="flex-1 min-w-0 space-y-0.5">
								<div class="flex items-center gap-2 flex-wrap">
									<span class="font-medium text-foreground truncate">{item.title}</span>
									{#if !item.readAt}
										<span class="shrink-0 h-1.5 w-1.5 rounded-full bg-primary" title={m.inbox_unread()}></span>
									{/if}
								</div>
								{#if item.body}
									<p class="text-xs text-muted-foreground line-clamp-2">{item.body}</p>
								{/if}
								<div class="text-[10px] text-muted-strong flex items-center gap-1.5 pt-0.5">
									<span>{actorLabel(item.actorAgentId, item.actorUserId)}</span>
									{#if item.entityType}
										<span aria-hidden="true">·</span>
										<span class="font-mono">{item.entityType}</span>
									{/if}
									{#if item.type === 'pipeline_hitl'}
										<span aria-hidden="true">·</span>
										<span>{item.pipelineName}</span>
										<span aria-hidden="true">·</span>
										<span>{item.stageLabel}</span>
										<span aria-hidden="true">·</span>
										<span>{TASK_STATUS_LABEL[item.taskStatus]}</span>
										<span aria-hidden="true">·</span>
										<span>{assignmentLabel(item)}</span>
									{/if}
								</div>
								</div>

							<!-- Timestamp -->
							<time
								class="shrink-0 text-xs text-muted-foreground whitespace-nowrap"
								datetime={item.createdAt}
							>
								{relativeTime(item.createdAt)}
							</time>
						</svelte:element>
					{/each}
				</ul>
			</section>
		{/each}
	{/if}
</div>
