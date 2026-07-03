<script lang="ts">
	import type { PageData } from './$types';
	import { invalidate } from '$app/navigation';
	import { PageHeader } from '$lib/components/ui';
	import { ClipboardList, CircleDollarSign } from 'lucide-svelte';
	import { relativeTime } from '$lib/components/crm/crm-format';
	import ScopeBanner from '$lib/components/crm/ScopeBanner.svelte';
	import { toastWarning } from '$lib/state/ui/toast.svelte';
	import * as m from '$lib/paraglide/messages';

	let { data }: { data: PageData } = $props();
	let busy = $state(false);

	const STATUSES = ['draft', 'confirmed', 'invoiced', 'cancelled'];
	const statusLabel: Record<string, string> = {
		draft: 'Draft',
		confirmed: 'Confirmed',
		invoiced: 'Invoiced',
		cancelled: 'Cancelled',
	};

	async function setStatus(id: string, status: string, expectedUpdatedAt: string | Date) {
		busy = true;
		try {
			const res = await fetch(`/api/sales/orders/${id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ status, expectedUpdatedAt }),
			});
			if (res.status === 409) toastWarning(m.shared_staleWrite());
			if (res.ok || res.status === 409) await invalidate('sales:list');
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Sales Orders</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title="Sales Orders" subtitle="Commitments to bill — created from bookings, reconciled against invoices" />

	<div class="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4">
		{#if data.contactName}<div><ScopeBanner name={data.contactName} contactId={data.contactId} noun="orders" /></div>{/if}
		<div class="kpis">
			<div class="kpi"><ClipboardList size={16} /><span class="n">{data.stats.open}</span><span class="l">Open orders</span></div>
			<div class="kpi"><CircleDollarSign size={16} /><span class="n">{data.stats.committed.toLocaleString()}</span><span class="l">Committed value</span></div>
		</div>

		<section class="card list">
			{#each data.orders as o (o.id)}
				<div class="row">
					<a class="desc" href={`/sales/${o.id}`}>{#if o.humanId}<span class="hid">{o.humanId}</span> {/if}{o.description ?? '—'}</a>
					<span class="cust t-caption">{o.customerName ?? '—'}</span>
					<span class="total">{o.total ? Number(o.total).toLocaleString() : '—'}</span>
					<select class="status-sel" value={o.status} disabled={busy} onchange={(e) => setStatus(o.id, (e.currentTarget as HTMLSelectElement).value, o.updatedAt)}>
						{#each STATUSES as s (s)}<option value={s}>{statusLabel[s]}</option>{/each}
					</select>
					<span class="when t-caption">{relativeTime(o.createdAt)}</span>
				</div>
			{:else}
				<p class="t-caption empty">No sales orders yet. Create one from a booking.</p>
			{/each}
		</section>
	</div>
</div>

<style>
	.kpis { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem; max-width: 32rem; }
	.kpi { display: flex; align-items: center; gap: 0.5rem; border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); padding: 0.75rem 1rem; color: var(--color-muted-foreground); }
	.kpi .n { font-size: 1.3rem; font-weight: 700; color: var(--color-foreground); font-variant-numeric: tabular-nums; margin-left: auto; }
	.kpi .l { font-size: 0.74rem; }
	.card { border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); }
	.list { display: flex; flex-direction: column; padding: 0.25rem 0; }
	.row { display: grid; grid-template-columns: 1fr 8rem 6rem 8rem 6rem; align-items: center; gap: 0.75rem; padding: 0.55rem 1rem; font-size: 0.86rem; }
	.row + .row { border-top: 1px solid var(--hairline); }
	.desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.hid { font-variant-numeric: tabular-nums; color: var(--color-muted-foreground); font-size: 0.78rem; }
	.total { font-variant-numeric: tabular-nums; font-weight: 600; }
	.status-sel { height: 1.8rem; font-size: 0.8rem; border-radius: var(--radius-md); background: var(--color-bg3); border: 1px solid var(--hairline); padding: 0 0.4rem; }
	.when { justify-self: end; }
	.empty { padding: 1.25rem 1rem; }
</style>
