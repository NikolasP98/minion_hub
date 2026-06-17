<script lang="ts">
	import type { PageData } from './$types';
	import * as m from '$lib/paraglide/messages';
	import { CreditCard } from 'lucide-svelte';
	import { PageHeader } from '$lib/components/ui';

	let { data }: { data: PageData } = $props();
	const payments = $derived(data.payments);

	// ── Windowed rendering ────────────────────────────────────────────────────
	const PAGE = 60;
	let renderLimit = $state(PAGE);
	const windowed = $derived(payments.slice(0, renderLimit));
	$effect(() => {
		payments.length;
		renderLimit = PAGE;
	});
	function infiniteScroll(root: HTMLElement) {
		const onScroll = () => {
			if (renderLimit >= payments.length) return;
			if (root.scrollTop + root.clientHeight >= root.scrollHeight - 400) {
				renderLimit += PAGE;
			}
		};
		root.addEventListener('scroll', onScroll, { passive: true });
		return { destroy: () => root.removeEventListener('scroll', onScroll) };
	}

	function fmtDate(d: Date | null) {
		if (!d) return '—';
		return new Date(d).toLocaleDateString();
	}

	function fmtMoney(v: string | null) {
		if (v == null) return '—';
		return Number(v).toLocaleString();
	}
</script>

<svelte:head><title>{m.fin_payments_title()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.fin_payments_title()} subtitle={m.fin_payments_subtitle()}>
		{#snippet leading()}<CreditCard size={16} class="text-accent shrink-0" />{/snippet}
	</PageHeader>

	<div class="flex-1 min-h-0 overflow-auto" use:infiniteScroll>
		{#if payments.length === 0}
			<div class="flex flex-col items-center justify-center h-full gap-2 p-8 text-center">
				<CreditCard size={32} class="text-muted-foreground" />
				<p class="t-caption">{m.fin_payments_empty()}</p>
			</div>
		{:else}
			<table class="w-full text-sm border-collapse">
				<thead class="sticky top-0 bg-bg/95 backdrop-blur z-20">
					<tr class="text-left t-caption border-b border-[var(--hairline)]">
						<th class="px-4 py-2 font-medium">{m.fin_col_paid_at()}</th>
						<th class="px-3 py-2 font-medium">{m.fin_col_method()}</th>
						<th class="px-3 py-2 font-medium text-right">{m.fin_col_amount()}</th>
						<th class="px-4 py-2 font-medium">{m.fin_col_status()}</th>
					</tr>
				</thead>
				<tbody>
					{#each windowed as p (p.id)}
						<tr class="border-b border-[var(--hairline)] hover:bg-white/[0.03] transition-colors">
							<td class="px-4 py-2 t-caption">{fmtDate(p.paidAt)}</td>
							<td class="px-3 py-2 capitalize">{p.method ?? '—'}</td>
							<td class="px-3 py-2 text-right font-variant-numeric tabular-nums font-medium">{fmtMoney(p.amount)}</td>
							<td class="px-4 py-2 capitalize t-caption">{p.status ?? '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>
