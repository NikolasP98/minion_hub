<script lang="ts">
	import type { PageData } from './$types';
	import * as m from '$lib/paraglide/messages';
	import { Users } from 'lucide-svelte';
	import { PageHeader } from '$lib/components/ui';

	let { data }: { data: PageData } = $props();
	const clients = $derived(data.clients);

	function fmtDate(d: string | null) {
		if (!d) return '—';
		return new Date(d).toLocaleDateString();
	}
</script>

<svelte:head><title>{m.fin_clients_title()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.fin_clients_title()} subtitle={m.fin_clients_subtitle()}>
		{#snippet leading()}<Users size={16} class="text-accent shrink-0" />{/snippet}
	</PageHeader>

	<div class="flex-1 min-h-0 overflow-auto">
		{#if clients.length === 0}
			<div class="flex flex-col items-center justify-center h-full gap-2 p-8 text-center">
				<Users size={32} class="text-muted-foreground" />
				<p class="t-caption">{m.fin_clients_empty()}</p>
			</div>
		{:else}
			<table class="w-full text-sm border-collapse">
				<thead class="sticky top-0 bg-bg/95 backdrop-blur z-20">
					<tr class="text-left t-caption border-b border-[var(--hairline)]">
						<th class="px-4 py-2 font-medium">{m.fin_col_client()}</th>
						<th class="px-3 py-2 font-medium">{m.fin_col_dni()}</th>
						<th class="px-3 py-2 font-medium text-right">{m.fin_col_invoices()}</th>
						<th class="px-3 py-2 font-medium text-right">{m.fin_col_revenue()}</th>
						<th class="px-4 py-2 font-medium text-right">{m.fin_col_last()}</th>
					</tr>
				</thead>
				<tbody>
					{#each clients as cl (cl.docNumber)}
						<tr class="border-b border-[var(--hairline)] hover:bg-white/[0.03] transition-colors">
							<td class="px-4 py-2 font-medium truncate max-w-[20rem]">{cl.name ?? '—'}</td>
							<td class="px-3 py-2 t-caption">{cl.docNumber}</td>
							<td class="px-3 py-2 text-right tabular-nums">{cl.invoices}</td>
							<td class="px-3 py-2 text-right tabular-nums font-medium">{Number(cl.revenue).toLocaleString()}</td>
							<td class="px-4 py-2 text-right t-caption">{fmtDate(cl.last)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>
