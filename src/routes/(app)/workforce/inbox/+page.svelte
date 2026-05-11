<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import type { InboxItem } from './+page.server';
	import { startPolling } from '$lib/util/live-polling';
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
		comment: { icon: '💬', tint: 'bg-blue-500/10 text-blue-600 border-blue-500/30', label: 'Comment' },
		mention: { icon: '@', tint: 'bg-purple-500/10 text-purple-600 border-purple-500/30', label: 'Mention' },
		approval: { icon: '✓', tint: 'bg-amber-500/10 text-amber-600 border-amber-500/30', label: 'Approval' },
		run_failed: { icon: '!', tint: 'bg-destructive/10 text-destructive border-destructive/30', label: 'Run failed' },
		join_request: { icon: '+', tint: 'bg-blue-500/10 text-blue-600 border-blue-500/30', label: 'Join request' },
		goal_achieved: { icon: '★', tint: 'bg-green-500/10 text-green-600 border-green-500/30', label: 'Goal achieved' },
		paused: { icon: '⏸', tint: 'bg-muted text-muted-foreground border-border', label: 'Paused' },
	};

	function bucketLabel(iso: string): string {
		const d = new Date(iso).getTime();
		const now = Date.now();
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const startOfToday = today.getTime();
		const startOfYesterday = startOfToday - 86_400_000;
		const startOfWeek = startOfToday - 6 * 86_400_000;
		if (d >= startOfToday) return 'Today';
		if (d >= startOfYesterday) return 'Yesterday';
		if (d >= startOfWeek) return 'This week';
		return 'Earlier';
	}

	const grouped = $derived.by(() => {
		const buckets: Array<{ label: string; items: InboxItem[] }> = [];
		const order = ['Today', 'Yesterday', 'This week', 'Earlier'];
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
		if (diff < 60_000) return 'just now';
		if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
		if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
		return `${Math.floor(diff / 86_400_000)}d ago`;
	}

	function actorLabel(agentId: string | null, userId: string | null): string {
		if (agentId) return agentNames[agentId] ?? `${agentId.slice(0, 8)}…`;
		if (userId) return `user:${userId.slice(0, 6)}…`;
		return 'system';
	}

	onMount(() => startPolling('app:inbox', 6000));
</script>

<div class="p-6 space-y-6 max-w-4xl">
	<header class="flex items-center justify-between flex-wrap gap-3">
		<div class="flex items-center gap-3">
			<h1 class="text-2xl font-semibold">Inbox</h1>
			<LiveIndicator intervalMs={6000} />
			{#if unreadCount > 0}
				<span class="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium">
					{unreadCount} unread
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
				All ({items.length})
			</button>
			<button
				type="button"
				class="px-3 py-1 rounded text-xs font-medium transition-colors {filter === 'unread' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}"
				onclick={() => (filter = 'unread')}
			>
				Unread ({unreadCount})
			</button>
		</div>
	</header>

	{#if filtered.length === 0}
		<div class="rounded-lg border border-border bg-card p-12 flex flex-col items-center justify-center text-center">
			<div class="text-3xl mb-2">📬</div>
			<p class="text-muted-foreground text-sm">
				{filter === 'unread' ? 'All caught up.' : 'No notifications.'}
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
							class="flex items-start gap-3 px-4 py-3 text-sm transition-colors {item.href ? 'hover:bg-accent' : ''} {!item.readAt ? 'bg-primary/5' : ''}"
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
									<span class="font-medium truncate">{item.title}</span>
									{#if !item.readAt}
										<span class="shrink-0 h-1.5 w-1.5 rounded-full bg-primary" title="Unread"></span>
									{/if}
								</div>
								{#if item.body}
									<p class="text-xs text-muted-foreground line-clamp-2">{item.body}</p>
								{/if}
								<div class="text-[10px] text-muted-foreground/70 flex items-center gap-1.5 pt-0.5">
									<span>{actorLabel(item.actorAgentId, item.actorUserId)}</span>
									{#if item.entityType}
										<span aria-hidden="true">·</span>
										<span class="font-mono">{item.entityType}</span>
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
