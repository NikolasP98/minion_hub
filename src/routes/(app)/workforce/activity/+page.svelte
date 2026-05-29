<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import { startPolling } from '$lib/utils/live-polling';
	import LiveIndicator from '$lib/components/LiveIndicator.svelte';
	import JsonView from '$lib/components/workforce/JsonView.svelte';
	import { PageHeader } from '$lib/components/ui';
	import { Activity } from 'lucide-svelte';

	let { data }: { data: PageData } = $props();

	const { items } = $derived(data);

	onMount(() => startPolling('app:activity', 5000));

	const ACTOR_COLORS: Record<string, string> = {
		agent: 'bg-primary/10 text-primary',
		user: 'bg-blue-500/10 text-blue-600',
		system: 'bg-muted text-muted-foreground',
	};

	function actorBadgeClass(actorType: string): string {
		return ACTOR_COLORS[actorType] ?? 'bg-muted text-muted-foreground';
	}

	function formatTimestamp(createdAt: Date | string): string {
		const d = new Date(createdAt);
		return d.toLocaleString([], {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
	}
</script>

<PageHeader title="Activity">
	{#snippet leading()}
		<Activity size={16} class="text-accent shrink-0" />
	{/snippet}
	{#snippet actions()}
		<LiveIndicator intervalMs={5000} />
		<span class="text-sm text-muted-foreground">{items.length} event{items.length !== 1 ? 's' : ''}</span>
	{/snippet}
</PageHeader>
<main class="flex-1 min-h-0 overflow-y-auto p-6 space-y-6">
	{#if items.length === 0}
		<div class="rounded-lg border border-border bg-card p-12 flex flex-col items-center justify-center text-center">
			<p class="text-muted-foreground text-sm">No activity yet.</p>
		</div>
	{:else}
		<ul class="divide-y divide-border rounded-lg border border-border bg-card">
			{#each items as item (item.id)}
				<li class="px-4 py-3 flex items-start gap-3">
					<!-- Actor type badge -->
					<span
						class="shrink-0 mt-0.5 rounded px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide {actorBadgeClass(item.actorType)}"
					>
						{item.actorType}
					</span>

					<!-- Action + entity -->
					<div class="min-w-0 flex-1 space-y-0.5">
						<p class="text-sm">
							<span class="font-medium">{item.action}</span>
							{#if item.entityType}
								<span class="text-muted-foreground"> on </span>
								<span class="font-medium text-foreground/80">{item.entityType}</span>
							{/if}
							{#if item.entityId}
								<span class="text-muted-foreground text-xs ml-1">#{item.entityId.slice(0, 8)}</span>
							{/if}
						</p>
						{#if item.details !== null}
							<JsonView value={item.details} />
						{/if}
					</div>

					<!-- Timestamp -->
					<time
						class="shrink-0 text-xs text-muted-foreground whitespace-nowrap"
						datetime={new Date(item.createdAt).toISOString()}
					>
						{formatTimestamp(item.createdAt)}
					</time>
				</li>
			{/each}
		</ul>
	{/if}
</main>
