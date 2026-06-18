<script lang="ts">
	import type { PageData } from './$types';
	import { Sparkles, Plus, Trash2, Pencil } from 'lucide-svelte';
	import { invalidate } from '$app/navigation';
	import { PageHeader, Card, Button, Badge, EmptyState } from '$lib/components/ui';
	import * as m from '$lib/paraglide/messages';
	import EventTypeEditor from '$lib/components/scheduling/EventTypeEditor.svelte';

	let { data }: { data: PageData } = $props();

	// 'new' | eventTypeId | null
	let editing = $state<string | null>(null);

	const resourceOpts = $derived(data.resources.map((r) => ({ id: r.id, name: r.name })));

	function editorModel(id: string) {
		const et = data.eventTypes.find((e) => e.id === id);
		if (!et) return null;
		return {
			id: et.id,
			slug: et.slug,
			title: et.title,
			description: et.description,
			length: et.length,
			slotInterval: et.slotInterval,
			beforeBuffer: et.beforeBuffer,
			afterBuffer: et.afterBuffer,
			minimumBookingNotice: et.minimumBookingNotice,
			periodDays: et.periodDays,
			schedulingType: et.schedulingType,
			requiresConfirmation: et.requiresConfirmation,
			public: et.public,
			productId: et.productId,
			resourceIds: et.resourceIds,
		};
	}

	async function onsaved() {
		editing = null;
		await invalidate('scheduling:data');
	}
	async function remove(id: string) {
		await fetch(`/api/scheduling/event-types/${id}`, { method: 'DELETE' });
		await invalidate('scheduling:data');
	}
</script>

<svelte:head><title>{m.sched_eventTypes_title()} · {m.nav_scheduling()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.sched_eventTypes_title()} subtitle={m.sched_dashboard_subtitle()}>
		{#snippet leading()}
			<Sparkles size={16} class="text-accent shrink-0" />
		{/snippet}
		{#snippet actions()}
			<Button size="sm" onclick={() => (editing = 'new')}><Plus size={14} /> {m.sched_eventType_new()}</Button>
		{/snippet}
	</PageHeader>

	<div class="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-3">
		{#if editing === 'new'}
			<Card padding="lg">
				<EventTypeEditor resources={resourceOpts} products={data.products} {onsaved} oncancel={() => (editing = null)} />
			</Card>
		{/if}

		{#if data.eventTypes.length === 0 && editing !== 'new'}
			<EmptyState title={m.sched_empty_eventTypes()} />
		{:else}
			{#each data.eventTypes as et (et.id)}
				<Card padding="md">
					{#if editing === et.id}
						<EventTypeEditor
							eventType={editorModel(et.id)}
							resources={resourceOpts}
							products={data.products}
							{onsaved}
							oncancel={() => (editing = null)}
						/>
					{:else}
						<div class="flex items-center gap-3">
							<div class="flex-1 min-w-0">
								<div class="font-medium truncate">
									{et.title}
									{#if !et.public}<Badge>private</Badge>{/if}
									{#if !et.active}<Badge>off</Badge>{/if}
								</div>
								<div class="t-caption truncate">
									/{et.slug} · {et.length}m · {et.resourceIds.length} {m.sched_nav_resources()}
								</div>
							</div>
							<button class="icon-btn" onclick={() => (editing = et.id)} aria-label={m.sched_save()}>
								<Pencil size={15} />
							</button>
							<button class="icon-btn del" onclick={() => remove(et.id)} aria-label={m.sched_delete()}>
								<Trash2 size={15} />
							</button>
						</div>
					{/if}
				</Card>
			{/each}
		{/if}
	</div>
</div>

<style>
	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--color-muted-foreground);
		border-radius: 6px;
		padding: 0.25rem;
	}
	.icon-btn:hover {
		background: var(--hairline);
	}
	.icon-btn.del:hover {
		color: var(--color-destructive);
	}
</style>
