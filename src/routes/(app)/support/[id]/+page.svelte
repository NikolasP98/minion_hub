<script lang="ts">
	import type { PageData } from './$types';
	import { goto, invalidate } from '$app/navigation';
	import { PageHeader, Button } from '$lib/components/ui';
	import { ArrowLeft, ExternalLink } from 'lucide-svelte';
	import { STATUSES, PRIORITIES, statusLabel, priorityLabel, priorityColor, slaColor } from '$lib/components/support/support-format';
	import { relativeTime } from '$lib/components/crm/crm-format';

	let { data }: { data: PageData } = $props();
	const i = $derived(data.issue);
	let busy = $state(false);

	async function patch(body: Record<string, unknown>) {
		busy = true;
		try {
			const res = await fetch(`/api/support/issues/${i.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			});
			if (res.ok) await invalidate('support:issue');
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>{i.subject} — Support</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={i.subject} subtitle={`Ticket · opened ${relativeTime(i.createdAt)}`}>
		{#snippet leading()}
			<button class="p-1 -ml-1 rounded hover:bg-white/[0.06]" onclick={() => goto('/support')} aria-label="Back to tickets">
				<ArrowLeft size={16} />
			</button>
		{/snippet}
	</PageHeader>

	<div class="flex-1 min-h-0 overflow-auto p-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
		<!-- Left: body -->
		<section class="card">
			<header class="card-h"><span>Description</span></header>
			<p class="desc">{i.description || 'No description.'}</p>
		</section>

		<!-- Right: controls + SLA -->
		<div class="flex flex-col gap-4">
			<section class="card">
				<header class="card-h"><span>SLA</span>
					<span class="sla" style:--c={slaColor(data.sla.state)}>
						{data.sla.state === 'failed' ? 'Breached' : data.sla.state === 'fulfilled' ? 'Met' : 'On track'}
					</span>
				</header>
				<dl class="kv">
					<div><dt>Response by</dt><dd>{i.responseBy ? relativeTime(i.responseBy) : '—'}</dd></div>
					<div><dt>Resolution by</dt><dd>{i.resolutionBy ? relativeTime(i.resolutionBy) : '—'}</dd></div>
					<div><dt>First reply</dt><dd>{i.firstRespondedAt ? relativeTime(i.firstRespondedAt) : '—'}</dd></div>
					<div><dt>Resolved</dt><dd>{i.resolvedAt ? relativeTime(i.resolvedAt) : '—'}</dd></div>
				</dl>
			</section>

			<section class="card">
				<header class="card-h"><span>Manage</span></header>
				<label class="field">
					<span class="t-caption">Status</span>
					<select class="inp" value={i.status} disabled={busy} onchange={(e) => patch({ status: (e.currentTarget as HTMLSelectElement).value })}>
						{#each STATUSES as s (s)}<option value={s}>{statusLabel[s]}</option>{/each}
					</select>
				</label>
				<label class="field">
					<span class="t-caption">Priority</span>
					<select class="inp" value={i.priority} disabled={busy} onchange={(e) => patch({ priority: (e.currentTarget as HTMLSelectElement).value })}>
						{#each PRIORITIES as p (p)}<option value={p}>{priorityLabel[p]}</option>{/each}
					</select>
				</label>
				<span class="pri" style:--c={priorityColor(i.priority)}>{priorityLabel[i.priority]}</span>
			</section>

			{#if i.crmContactId}
				<section class="card">
					<header class="card-h"><span>Customer</span></header>
					<a class="link-row" href={`/crm/${i.crmContactId}`}>View CRM contact <ExternalLink size={13} /></a>
				</section>
			{/if}
		</div>
	</div>
</div>

<style>
	.card { border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); padding: 0.85rem 1rem; }
	.card-h { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; font-size: 0.78rem; font-weight: 600; color: var(--color-muted-foreground); text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 0.6rem; }
	.desc { white-space: pre-wrap; font-size: 0.9rem; line-height: 1.5; }
	.kv { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem 1rem; }
	.kv dt { font-size: 0.7rem; color: var(--color-muted-foreground); }
	.kv dd { font-size: 0.88rem; font-weight: 600; }
	.field { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 0.6rem; }
	.inp { height: 2rem; padding: 0 0.5rem; font-size: 0.86rem; border-radius: var(--radius-md); background: var(--color-bg3); border: 1px solid var(--hairline); }
	.sla { color: var(--c); font-weight: 600; font-size: 0.78rem; text-transform: none; letter-spacing: 0; }
	.pri { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.72rem; font-weight: 600; color: var(--c); background: color-mix(in srgb, var(--c) 14%, transparent); border: 1px solid color-mix(in srgb, var(--c) 30%, transparent); }
	.link-row { display: inline-flex; align-items: center; gap: 0.35rem; color: var(--color-accent); font-size: 0.86rem; }
	.link-row:hover { text-decoration: underline; }
</style>
