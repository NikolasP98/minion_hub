<script lang="ts">
	import type { PageData } from './$types';
	import { invalidate, goto } from '$app/navigation';
	import { PageHeader, Button } from '$lib/components/ui';
	import { Plus, AlertTriangle, Inbox, CheckCircle2 } from 'lucide-svelte';
	import { priorityLabel, priorityColor, slaColor, PRIORITIES } from '$lib/components/support/support-format';
	import { relativeTime } from '$lib/components/crm/crm-format';
	import ScopeBanner from '$lib/components/crm/ScopeBanner.svelte';
	import * as m from '$lib/paraglide/messages';
	import { canAct } from '$lib/access/can.svelte';

	let { data }: { data: PageData } = $props();

	// Opened pre-bound to a contact from the Connections "+New" action.
	// svelte-ignore state_referenced_locally
	let creating = $state(data.openCreate ?? false);
	let subject = $state('');
	let priority = $state('medium');
	let busy = $state(false);

	async function create() {
		if (!subject.trim()) return;
		busy = true;
		try {
			const res = await fetch('/api/support/issues', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ subject: subject.trim(), priority, crmContactId: data.contactId }),
			});
			if (res.ok) {
				subject = '';
				priority = 'medium';
				creating = false;
				await invalidate('support:list');
			}
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Support</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title="Support" subtitle="Customer tickets with SLA tracking">
		{#snippet actions()}
			<Button
				variant="primary"
				size="sm"
				disabled={!canAct('support', 'edit')}
				title={canAct('support', 'edit') ? undefined : m.no_permission()}
				onclick={() => (creating = !creating)}
			>
				<Plus size={14} /> New ticket
			</Button>
		{/snippet}
	</PageHeader>

	<div class="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4">
		{#if data.contactName}<div><ScopeBanner name={data.contactName} contactId={data.contactId} noun="tickets" /></div>{/if}
		<!-- KPI row -->
		<div class="kpis">
			<div class="kpi"><Inbox size={16} /><span class="n">{data.stats.open}</span><span class="l">Open</span></div>
			<div class="kpi" class:warn={data.stats.breached > 0}>
				<AlertTriangle size={16} /><span class="n">{data.stats.breached}</span><span class="l">SLA breached</span>
			</div>
			<div class="kpi"><CheckCircle2 size={16} /><span class="n">{data.stats.resolvedToday}</span><span class="l">Resolved today</span></div>
		</div>

		{#if creating}
			<section class="card create">
				<input class="inp" bind:value={subject} placeholder="Ticket subject…" onkeydown={(e) => e.key === 'Enter' && create()} />
				<select class="inp sel" bind:value={priority}>
					{#each PRIORITIES as p (p)}<option value={p}>{priorityLabel[p]}</option>{/each}
				</select>
				<Button variant="primary" size="sm" onclick={create} disabled={busy || !subject.trim()}>Create</Button>
				<Button variant="ghost" size="sm" onclick={() => (creating = false)}>Cancel</Button>
			</section>
		{/if}

		<!-- Ticket list -->
		<section class="card list">
			{#each data.issues as it (it.id)}
				<button class="row" onclick={() => goto(`/support/${it.id}`)}>
					<span class="pri" style:--c={priorityColor(it.priority)}>{priorityLabel[it.priority]}</span>
					<span class="subj">{#if it.humanId}<span class="hid">{it.humanId}</span> {/if}{it.subject}</span>
					<span class="status">{it.status}</span>
					<span class="sla" style:--c={slaColor(it.sla.state)} title={it.sla.dueBy ? `Due ${relativeTime(it.sla.dueBy)}` : ''}>
						{it.sla.state === 'failed' ? 'Breached' : it.sla.state === 'fulfilled' ? 'Met' : it.sla.dueBy ? `Due ${relativeTime(it.sla.dueBy)}` : '—'}
					</span>
					<span class="when t-caption">{relativeTime(it.createdAt)}</span>
				</button>
			{:else}
				<p class="t-caption empty">No open tickets.</p>
			{/each}
		</section>
	</div>
</div>

<style>
	.kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.75rem; }
	.kpi {
		display: flex; align-items: center; gap: 0.5rem;
		border: 1px solid var(--hairline); border-radius: var(--radius-lg);
		background: var(--color-card); padding: 0.75rem 1rem; color: var(--color-muted-foreground);
	}
	.kpi .n { font-size: 1.3rem; font-weight: 700; color: var(--color-foreground); font-variant-numeric: tabular-nums; margin-left: auto; }
	.kpi .l { font-size: 0.74rem; }
	.kpi.warn .n { color: var(--color-destructive, #ef4444); }
	.card { border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); }
	.create { display: flex; gap: 0.5rem; align-items: center; padding: 0.75rem 1rem; }
	.inp { height: 2rem; padding: 0 0.6rem; font-size: 0.88rem; border-radius: var(--radius-md); background: var(--color-bg3); border: 1px solid var(--hairline); }
	.inp:first-child { flex: 1; }
	.sel { width: 8rem; }
	.list { display: flex; flex-direction: column; padding: 0.25rem 0; }
	.row {
		display: grid; grid-template-columns: 5rem 1fr 6rem 7rem 6rem; align-items: center; gap: 0.75rem;
		padding: 0.55rem 1rem; text-align: left; font-size: 0.86rem; width: 100%;
	}
	.row + .row { border-top: 1px solid var(--hairline); }
	.row:hover { background: rgba(255, 255, 255, 0.04); }
	.pri {
		justify-self: start; padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.72rem; font-weight: 600;
		color: var(--c); background: color-mix(in srgb, var(--c) 14%, transparent); border: 1px solid color-mix(in srgb, var(--c) 30%, transparent);
	}
	.subj { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.hid { font-variant-numeric: tabular-nums; color: var(--color-muted-foreground); font-size: 0.78rem; }
	.status { color: var(--color-muted-foreground); text-transform: capitalize; }
	.sla { color: var(--c); font-weight: 600; font-size: 0.78rem; }
	.when { justify-self: end; }
	.empty { padding: 1.25rem 1rem; }
</style>
