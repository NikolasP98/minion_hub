<script lang="ts">
	import type { PageData } from './$types';
	import { invalidate } from '$app/navigation';
	import { PageHeader, Button } from '$lib/components/ui';
	import { Layers, FolderPlus, Bot } from 'lucide-svelte';
	import * as m from '$lib/paraglide/messages';
	import { canAct } from '$lib/access/can.svelte';

	let { data }: { data: PageData } = $props();
	let name = $state('');
	let objective = $state('');
	let busy = $state(false);

	const statusLabel: Record<string, string> = {
		active: m.workforce_portfolios_status_active(),
		archived: m.workforce_portfolios_status_archived(),
	};

	async function create() {
		if (!name.trim() || busy) return;
		busy = true;
		try {
			// Mutations go through the RBAC-write-gated /api/workforce proxy.
			const res = await fetch(`/api/workforce/companies/${data.companyId}/portfolios`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: name.trim(), objective: objective.trim() || null }),
			});
			if (res.ok) {
				name = '';
				objective = '';
				await invalidate('workforce:portfolios');
			}
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>{m.workforce_portfolios()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0 flex-1 min-w-0">
	<PageHeader title={m.workforce_portfolios()} subtitle={m.workforce_portfolios_subtitle()} />

	<div class="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4">
		<section class="card creator">
			<div class="create-row">
				<input
					class="in"
					placeholder={m.workforce_portfolios_namePlaceholder()}
					bind:value={name}
					onkeydown={(e) => e.key === 'Enter' && create()}
				/>
				<Button variant="ghost"
					class="btn"
					disabled={busy || !name.trim() || !canAct('projects', 'edit')}
					title={canAct('projects', 'edit') ? undefined : m.no_permission()}
					onclick={create}
				><FolderPlus size={15} /> {m.workforce_portfolios_create()}</Button>
			</div>
			<div class="create-row">
				<textarea class="in ta" rows="2" placeholder={m.workforce_portfolios_objectivePlaceholder()} bind:value={objective}></textarea>
			</div>
		</section>

		<section class="grid-list">
			{#each data.portfolios as p (p.id)}
				<a class="card pcard" href={`/workforce/portfolios/${p.id}`}>
					<div class="head">
						<span class="name"><Layers size={15} /> {p.name}</span>
						<span class="status s-{p.status}">{statusLabel[p.status] ?? p.status}</span>
					</div>
					{#if p.objective}
						<p class="objective">{p.objective}</p>
					{/if}
					{#if p.leadAgentId}
						<span class="lead t-caption"><Bot size={13} /> {data.agentNames[p.leadAgentId] ?? p.leadAgentId}</span>
					{/if}
				</a>
			{:else}
				<p class="t-caption empty">{m.workforce_portfolios_empty()}</p>
			{/each}
		</section>
	</div>
</div>

<style>
	.card { border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); }
	.creator { padding: var(--space-3); display: flex; flex-direction: column; gap: var(--space-2); }
	.create-row { display: flex; gap: var(--space-2); align-items: center; }
	.in { font-size: var(--font-size-body); border-radius: var(--radius-md); background: var(--color-bg3); border: 1px solid var(--hairline); padding: 0 var(--space-2); flex: 1; color: var(--color-foreground); height: 2rem; }
	.in.ta { height: auto; padding: var(--space-2) var(--space-2); resize: vertical; font-family: inherit; }
	.btn { display: inline-flex; align-items: center; gap: var(--space-2); height: 2rem; padding: 0 var(--space-3); border-radius: var(--radius-md); border: 1px solid var(--hairline); background: var(--color-accent); color: var(--color-on-accent); font-size: var(--font-size-body); cursor: pointer; }
	.btn:disabled { opacity: 0.5; cursor: default; }
	.grid-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr)); gap: var(--space-3); }
	.pcard { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3) var(--space-4); text-decoration: none; color: var(--color-foreground); }
	.pcard:hover { background: var(--color-bg3); }
	.head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
	.name { display: flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-page-title); font-weight: 600; min-width: 0; }
	.status { font-size: var(--font-size-caption); padding: var(--space-0-5) var(--space-2); border-radius: var(--radius-full); border: 1px solid var(--hairline); color: var(--color-muted-foreground); flex: 0 0 auto; }
	.s-active { color: var(--color-success, var(--color-success-border)); }
	.objective { font-size: var(--font-size-body); color: var(--color-muted-foreground); margin: 0; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
	.lead { display: inline-flex; align-items: center; gap: var(--space-2); }
	.empty { padding: var(--space-4); }
</style>
