<script lang="ts">
	import type { PageData } from './$types';
	import { goto } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';
	import { FileText } from 'lucide-svelte';
	import { PageHeader } from '$lib/components/ui';

	let { data }: { data: PageData } = $props();
	const invoices = $derived(data.invoices);

	function fmtDate(d: Date | null) {
		if (!d) return '—';
		return new Date(d).toLocaleDateString();
	}

	function fmtMoney(v: string | null) {
		if (v == null) return '—';
		return Number(v).toLocaleString();
	}
</script>

<svelte:head><title>{m.fin_invoices_title()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.fin_invoices_title()} subtitle={m.fin_invoices_subtitle()}>
		{#snippet leading()}<FileText size={16} class="text-accent shrink-0" />{/snippet}
	</PageHeader>

	<div class="flex-1 min-h-0 overflow-auto">
		{#if invoices.length === 0}
			<div class="flex flex-col items-center justify-center h-full gap-2 p-8 text-center">
				<FileText size={32} class="text-muted-foreground" />
				<p class="t-caption">{m.fin_invoices_empty()}</p>
			</div>
		{:else}
			<table class="w-full text-sm border-collapse">
				<thead class="sticky top-0 bg-bg/95 backdrop-blur z-20">
					<tr class="text-left t-caption border-b border-[var(--hairline)]">
						<th class="px-4 py-2 font-medium">{m.fin_col_number()}</th>
						<th class="px-3 py-2 font-medium">{m.fin_col_issued_at()}</th>
						<th class="px-3 py-2 font-medium">{m.fin_col_client()}</th>
						<th class="px-3 py-2 font-medium">{m.fin_col_dni()}</th>
						<th class="px-3 py-2 font-medium text-right">{m.fin_col_total()}</th>
						<th class="px-4 py-2 font-medium">{m.fin_col_status()}</th>
					</tr>
				</thead>
				<tbody>
					{#each invoices as inv (inv.id)}
						<tr
							class="border-b border-[var(--hairline)] hover:bg-white/[0.03] cursor-pointer transition-colors"
							onclick={() => goto(`/finances/invoices/${inv.id}`)}
						>
							<td class="px-4 py-2 font-medium">{inv.number ?? inv.documentId ?? '—'}</td>
							<td class="px-3 py-2 t-caption">{fmtDate(inv.issuedAt)}</td>
							<td class="px-3 py-2 truncate max-w-[20rem]">{inv.clientName ?? '—'}</td>
							<td class="px-3 py-2 t-caption">{inv.clientDocNumber ?? '—'}</td>
							<td class="px-3 py-2 text-right font-variant-numeric tabular-nums">{fmtMoney(inv.total)}</td>
							<td class="px-4 py-2"><span class="status-pill" data-status={inv.status ?? ''}>{inv.status ?? '—'}</span></td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>

<style>
	.status-pill {
		display: inline-block;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		font-size: 0.74rem;
		font-weight: 500;
		text-transform: capitalize;
		background: color-mix(in srgb, var(--color-muted-foreground) 15%, transparent);
		color: var(--color-muted-foreground);
	}
	.status-pill[data-status='paid'] {
		background: color-mix(in srgb, var(--color-success, #22c55e) 15%, transparent);
		color: var(--color-success, #22c55e);
	}
	.status-pill[data-status='partial'] {
		background: color-mix(in srgb, var(--color-warning, #f59e0b) 15%, transparent);
		color: var(--color-warning, #f59e0b);
	}
	.status-pill[data-status='void'] {
		background: color-mix(in srgb, var(--color-destructive, #ef4444) 12%, transparent);
		color: var(--color-destructive, #ef4444);
	}
</style>
