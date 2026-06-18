<script lang="ts">
	import type { PageData } from './$types';
	import { Users, Plus, Trash2, ChevronRight } from 'lucide-svelte';
	import { invalidate } from '$app/navigation';
	import { PageHeader, Card, Button, Input, EmptyState } from '$lib/components/ui';
	import * as m from '$lib/paraglide/messages';
	import AvailabilityEditor from '$lib/components/scheduling/AvailabilityEditor.svelte';

	let { data }: { data: PageData } = $props();

	let name = $state('');
	let email = $state('');
	let timezone = $state('America/Lima');
	let adding = $state(false);
	let expanded = $state<string | null>(null);

	async function addResource() {
		if (!name.trim()) return;
		adding = true;
		try {
			const res = await fetch('/api/scheduling/resources', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name, email: email || null, timezone }),
			});
			if (res.ok) {
				name = '';
				email = '';
				await invalidate('scheduling:data');
			}
		} finally {
			adding = false;
		}
	}

	async function toggleActive(id: string, active: boolean) {
		await fetch(`/api/scheduling/resources/${id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ active }),
		});
		await invalidate('scheduling:data');
	}

	async function remove(id: string) {
		await fetch(`/api/scheduling/resources/${id}`, { method: 'DELETE' });
		await invalidate('scheduling:data');
	}
</script>

<svelte:head><title>{m.sched_resources_title()} · {m.nav_scheduling()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.sched_resources_title()} subtitle={m.sched_dashboard_subtitle()}>
		{#snippet leading()}
			<Users size={16} class="text-accent shrink-0" />
		{/snippet}
	</PageHeader>

	<div class="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4">
		<!-- Add form -->
		<Card padding="md">
			<div class="flex flex-wrap items-end gap-2">
				<label class="field">
					<span class="t-caption">{m.sched_resource_name()}</span>
					<Input bind:value={name} placeholder="Nombre" />
				</label>
				<label class="field">
					<span class="t-caption">{m.sched_resource_email()}</span>
					<Input bind:value={email} placeholder="email@…" />
				</label>
				<label class="field">
					<span class="t-caption">{m.sched_resource_timezone()}</span>
					<Input bind:value={timezone} />
				</label>
				<Button onclick={addResource} disabled={adding || !name.trim()}>
					<Plus size={14} /> {m.sched_resource_new()}
				</Button>
			</div>
		</Card>

		{#if data.resources.length === 0}
			<EmptyState title={m.sched_empty_resources()} />
		{:else}
			<div class="flex flex-col gap-2">
				{#each data.resources as r (r.id)}
					<Card padding="md">
						<div class="flex items-center gap-3">
							<button
								class="expand-btn"
								onclick={() => (expanded = expanded === r.id ? null : r.id)}
								aria-label="toggle"
							>
								<ChevronRight size={16} style="transform:rotate({expanded === r.id ? 90 : 0}deg);transition:transform .15s" />
							</button>
							<div class="flex-1 min-w-0">
								<div class="font-medium truncate">{r.name}</div>
								<div class="t-caption truncate">{r.email ?? ''} · {r.timezone}</div>
							</div>
							<label class="t-caption flex items-center gap-1">
								<input type="checkbox" checked={r.active} onchange={(e) => toggleActive(r.id, e.currentTarget.checked)} />
								{m.sched_resource_active()}
							</label>
							<button class="del-btn" onclick={() => remove(r.id)} aria-label={m.sched_delete()}>
								<Trash2 size={15} />
							</button>
						</div>
						{#if expanded === r.id}
							<div class="mt-3 pt-3 border-t border-[var(--hairline)]">
								<AvailabilityEditor resourceId={r.id} schedule={data.schedules[r.id]} />
							</div>
						{/if}
					</Card>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.expand-btn,
	.del-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--color-muted-foreground);
		border-radius: 6px;
		padding: 0.25rem;
	}
	.del-btn:hover {
		color: var(--color-destructive);
		background: var(--hairline);
	}
	.expand-btn:hover {
		background: var(--hairline);
	}
</style>
