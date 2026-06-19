<script lang="ts">
	import type { PageData } from './$types';
	import { goto } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';
	import { CreditCard } from 'lucide-svelte';
	import { PageHeader } from '$lib/components/ui';

	let { data }: { data: PageData } = $props();
	const payments = $derived(data.payments);
	const total = $derived(data.total);
	const loadedLimit = $derived(data.limit);

	// ── Server-side pagination ────────────────────────────────────────────────
	// Rows are already a server page; when the user scrolls near the bottom and the
	// server has more, bump `?show=` so the loader fetches the next page (lazy SSR,
	// keepFocus/noScroll so the scroll position is preserved across the navigation).
	const PAGE = 60;
	let loadingMore = $state(false);
	const hasMore = $derived(payments.length < total);
	async function loadMore() {
		if (loadingMore || !hasMore) return;
		loadingMore = true;
		await goto(`?show=${loadedLimit + PAGE}`, {
			keepFocus: true,
			noScroll: true,
			invalidateAll: false,
		});
		loadingMore = false;
	}
	function infiniteScroll(root: HTMLElement) {
		const onScroll = () => {
			if (!hasMore || loadingMore) return;
			if (root.scrollTop + root.clientHeight >= root.scrollHeight - 400) {
				void loadMore();
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
					{#each payments as p (p.id)}
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
