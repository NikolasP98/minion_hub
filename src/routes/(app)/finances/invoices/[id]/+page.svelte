<script lang="ts">
	import type { PageData } from './$types';
	import { goto } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';
	import { ArrowLeft, FileText } from 'lucide-svelte';
	import { PageHeader, Button } from '$lib/components/ui';

	let { data }: { data: PageData } = $props();
	const inv = $derived(data.invoice);
	const items = $derived(data.items);
	const payments = $derived(data.payments);

	function fmtDate(d: Date | null) {
		if (!d) return '—';
		return new Date(d).toLocaleDateString();
	}

	function fmtMoney(v: string | null) {
		if (v == null) return '—';
		return Number(v).toLocaleString();
	}
</script>

<svelte:head><title>{m.fin_invoice_detail_title()} {inv.number ?? inv.documentId ?? ''}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader
		title={`${m.fin_invoice_detail_title()} ${inv.number ?? inv.documentId ?? inv.id}`}
		subtitle={m.fin_invoice_detail_subtitle()}
	>
		{#snippet leading()}<FileText size={16} class="text-accent shrink-0" />{/snippet}
	</PageHeader>

	<div class="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4 max-w-5xl">
		<Button variant="outline" size="sm" onclick={() => goto('/finances/invoices')} class="self-start">
			<ArrowLeft size={14} />
			{m.fin_back_to_invoices()}
		</Button>

		<!-- Header fields -->
		<section class="card">
			<div class="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
				<div class="field">
					<span class="field-label">{m.fin_col_number()}</span>
					<span class="field-val">{inv.number ?? inv.documentId ?? '—'}</span>
				</div>
				<div class="field">
					<span class="field-label">{m.fin_col_issued_at()}</span>
					<span class="field-val">{fmtDate(inv.issuedAt)}</span>
				</div>
				<div class="field">
					<span class="field-label">{m.fin_col_status()}</span>
					<span class="field-val capitalize">{inv.status ?? '—'}</span>
				</div>
				<div class="field">
					<span class="field-label">{m.fin_col_client()}</span>
					<span class="field-val">{inv.clientName ?? '—'}</span>
				</div>
				<div class="field">
					<span class="field-label">{m.fin_col_dni()}</span>
					<span class="field-val">{inv.clientDocNumber ?? '—'}</span>
				</div>
				<div class="field">
					<span class="field-label">{m.fin_col_currency()}</span>
					<span class="field-val">{inv.currency ?? '—'}</span>
				</div>
				<div class="field">
					<span class="field-label">{m.fin_col_subtotal()}</span>
					<span class="field-val">{fmtMoney(inv.subtotal)}</span>
				</div>
				<div class="field">
					<span class="field-label">{m.fin_col_tax()}</span>
					<span class="field-val">{fmtMoney(inv.tax)}</span>
				</div>
				<div class="field">
					<span class="field-label">{m.fin_col_discount()}</span>
					<span class="field-val">{fmtMoney(inv.discount)}</span>
				</div>
				<div class="field">
					<span class="field-label">{m.fin_col_total()}</span>
					<span class="field-val font-semibold">{fmtMoney(inv.total)}</span>
				</div>
				{#if inv.seller}
					<div class="field">
						<span class="field-label">{m.fin_col_seller()}</span>
						<span class="field-val">{inv.seller}</span>
					</div>
				{/if}
				{#if inv.note}
					<div class="field col-span-2 sm:col-span-3">
						<span class="field-label">{m.fin_col_note()}</span>
						<span class="field-val">{inv.note}</span>
					</div>
				{/if}
			</div>
		</section>

		<!-- Items table -->
		{#if items.length > 0}
			<section class="card">
				<header class="card-h">{m.fin_invoice_items()}</header>
				<div class="overflow-auto">
					<table class="w-full text-sm border-collapse">
						<thead>
							<tr class="text-left t-caption border-b border-[var(--hairline)]">
								<th class="px-3 py-2 font-medium">{m.fin_col_description()}</th>
								<th class="px-3 py-2 font-medium text-right">{m.fin_col_qty()}</th>
								<th class="px-3 py-2 font-medium text-right">{m.fin_col_unit_price()}</th>
								<th class="px-3 py-2 font-medium text-right">{m.fin_col_discount()}</th>
								<th class="px-3 py-2 font-medium text-right">{m.fin_col_total()}</th>
							</tr>
						</thead>
						<tbody>
							{#each items as it (it.id)}
								<tr class="border-b border-[var(--hairline)]">
									<td class="px-3 py-2">{it.description ?? it.code ?? '—'}</td>
									<td class="px-3 py-2 text-right tabular-nums">{it.quantity ?? '—'}</td>
									<td class="px-3 py-2 text-right tabular-nums">{fmtMoney(it.unitPrice)}</td>
									<td class="px-3 py-2 text-right tabular-nums">{fmtMoney(it.discount)}</td>
									<td class="px-3 py-2 text-right tabular-nums font-medium">{fmtMoney(it.total)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{/if}

		<!-- Payments table -->
		{#if payments.length > 0}
			<section class="card">
				<header class="card-h">{m.fin_invoice_payments()}</header>
				<div class="overflow-auto">
					<table class="w-full text-sm border-collapse">
						<thead>
							<tr class="text-left t-caption border-b border-[var(--hairline)]">
								<th class="px-3 py-2 font-medium">{m.fin_col_paid_at()}</th>
								<th class="px-3 py-2 font-medium">{m.fin_col_method()}</th>
								<th class="px-3 py-2 font-medium text-right">{m.fin_col_amount()}</th>
								<th class="px-3 py-2 font-medium">{m.fin_col_status()}</th>
							</tr>
						</thead>
						<tbody>
							{#each payments as p (p.id)}
								<tr class="border-b border-[var(--hairline)]">
									<td class="px-3 py-2 t-caption">{fmtDate(p.paidAt)}</td>
									<td class="px-3 py-2 capitalize">{p.method ?? '—'}</td>
									<td class="px-3 py-2 text-right tabular-nums font-medium">{fmtMoney(p.amount)}</td>
									<td class="px-3 py-2 capitalize t-caption">{p.status ?? '—'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{/if}
	</div>
</div>

<style>
	.card {
		border: 1px solid var(--hairline);
		border-radius: var(--radius-lg);
		background: var(--color-card);
		padding: 0.85rem 1rem;
	}
	.card-h {
		font-size: 0.78rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-muted-foreground);
		margin-bottom: 0.75rem;
	}
	.field { display: flex; flex-direction: column; gap: 0.15rem; }
	.field-label { font-size: 0.72rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.03em; color: var(--color-muted-foreground); }
	.field-val { font-size: 0.875rem; }
</style>
