<script lang="ts">
	import type { PageData } from './$types';
	import { invalidate } from '$app/navigation';
	import { PageHeader, Button } from '$lib/components/ui';
	import { ArrowLeft } from 'lucide-svelte';
	import { relativeTime } from '$lib/components/crm/crm-format';
	import DocTimeline from '$lib/components/shared/DocTimeline.svelte';
	import { createBackNav } from '$lib/nav/back-nav.svelte';
	import { toastWarning } from '$lib/state/ui/toast.svelte';
	import * as m from '$lib/paraglide/messages';

	let { data }: { data: PageData } = $props();
	const o = $derived(data.order);
	const back = createBackNav('/sales', () => 'Sales');
	let busy = $state(false);

	const STATUSES = ['draft', 'confirmed', 'invoiced', 'cancelled'];
	const statusLabel: Record<string, string> = {
		draft: 'Draft', confirmed: 'Confirmed', invoiced: 'Invoiced', cancelled: 'Cancelled',
	};

	async function postComment(body: string) {
		const res = await fetch('/api/activity/comments', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ refType: 'sales_order', refId: o.id, body }),
		});
		if (res.ok) await invalidate('sales:order');
	}

	async function setStatus(status: string) {
		busy = true;
		try {
			const res = await fetch(`/api/sales/orders/${o.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ status, expectedUpdatedAt: o.updatedAt }),
			});
			if (res.status === 409) toastWarning(m.shared_staleWrite());
			if (res.ok || res.status === 409) await invalidate('sales:order');
		} finally {
			busy = false;
		}
	}

	async function applyTransition(action: string) {
		busy = true;
		try {
			const res = await fetch('/api/workflow/apply', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ docType: 'sales_order', docId: o.id, action }),
			});
			if (res.ok) await invalidate('sales:order');
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>{o.humanId ?? 'Order'} — Sales</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={o.description ?? 'Sales order'} subtitle={`${o.humanId ?? 'Order'} · created ${relativeTime(o.createdAt)}`}>
		{#snippet leading()}
			<button class="p-1 -ml-1 rounded hover:bg-white/[0.06]" onclick={back.go} aria-label="Back to sales">
				<ArrowLeft size={16} />
			</button>
		{/snippet}
	</PageHeader>

	<div class="flex-1 min-h-0 overflow-auto p-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
		<!-- Left: detail + activity -->
		<div class="flex flex-col gap-4 min-h-0">
			<section class="card">
				<header class="card-h"><span>Order</span></header>
				<dl class="kv">
					<div><dt>Customer</dt><dd>{o.customerName ?? '—'}</dd></div>
					<div><dt>Total</dt><dd>{o.total ? Number(o.total).toLocaleString() : '—'}</dd></div>
					<div><dt>Status</dt><dd>{statusLabel[o.status] ?? o.status}</dd></div>
				</dl>
			</section>
			<section class="card">
				<header class="card-h"><span>Activity</span></header>
				<DocTimeline items={data.timeline} onComment={postComment} />
			</section>
		</div>

		<!-- Right: controls -->
		<div class="flex flex-col gap-4">
			<section class="card">
				<header class="card-h"><span>Manage</span></header>
				{#if data.transitions.length}
					<div class="field">
						<span class="t-caption">Workflow</span>
						<div class="wf-actions">
							{#each data.transitions as t (t.action)}
								<Button size="sm" disabled={busy} onclick={() => applyTransition(t.action)}>{t.action}</Button>
							{/each}
						</div>
					</div>
				{/if}
				<label class="field">
					<span class="t-caption">Status</span>
					<select class="inp" value={o.status} disabled={busy} onchange={(e) => setStatus((e.currentTarget as HTMLSelectElement).value)}>
						{#each STATUSES as s (s)}<option value={s}>{statusLabel[s]}</option>{/each}
					</select>
				</label>
				{#if o.crmContactId}
					<a class="t-caption link" href={`/crm/${o.crmContactId}`}>View customer →</a>
				{/if}
			</section>
		</div>
	</div>
</div>

<style>
	.card { border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); padding: 0.85rem 1rem; }
	.card-h { font-size: 0.78rem; font-weight: 600; color: var(--color-muted-foreground); text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 0.6rem; display: flex; justify-content: space-between; align-items: center; }
	.kv { display: flex; flex-direction: column; gap: 0.4rem; }
	.kv div { display: flex; justify-content: space-between; gap: 1rem; font-size: 0.86rem; }
	.kv dt { color: var(--color-muted-foreground); }
	.kv dd { font-variant-numeric: tabular-nums; }
	.field { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 0.7rem; }
	.wf-actions { display: flex; flex-wrap: wrap; gap: 0.35rem; }
	.inp { height: 1.9rem; font-size: 0.84rem; border-radius: var(--radius-md); background: var(--color-bg3); border: 1px solid var(--hairline); padding: 0 0.4rem; }
	.link { color: var(--color-accent); }
	.link:hover { text-decoration: underline; }
</style>
