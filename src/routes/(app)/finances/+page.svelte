<script lang="ts">
	import type { PageData } from './$types';
	import * as m from '$lib/paraglide/messages';
	import { Wallet } from 'lucide-svelte';
	import { PageHeader } from '$lib/components/ui';
	let { data }: { data: PageData } = $props();
	const max = $derived(Math.max(1, ...data.monthly.map((x) => x.revenue)));
</script>
<svelte:head><title>{m.nav_finance()}</title></svelte:head>
<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.nav_finance()} subtitle={m.fin_dashboard_subtitle()}>
		{#snippet leading()}<Wallet size={16} class="text-accent shrink-0" />{/snippet}
	</PageHeader>
	<div class="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4 max-w-6xl">
		{#if !data.hasData}
			<p class="t-caption">{m.fin_empty()}</p>
		{:else}
			<div class="kpi"><div class="kpi-val">S/ {data.totalRevenue.toLocaleString()}</div><div class="kpi-label">{m.fin_total_revenue()}</div></div>
			<section class="card">
				<header class="card-h">{m.fin_revenue_by_month()}</header>
				<div class="bars">
					{#each data.monthly.slice().reverse() as row (row.month)}
						<div class="bar-row" title={`${row.month}: S/ ${row.revenue.toLocaleString()} · ${row.invoices}`}>
							<span class="bar-label">{row.month}</span>
							<span class="bar-wrap"><span class="bar" style:width={`${(row.revenue / max) * 100}%`}></span></span>
							<span class="bar-n">S/ {Math.round(row.revenue).toLocaleString()}</span>
						</div>
					{/each}
				</div>
			</section>
		{/if}
	</div>
</div>
<style>
	.kpi { padding: 0.85rem 1rem; border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); width: fit-content; }
	.kpi-val { font-size: 1.75rem; font-weight: 700; font-variant-numeric: tabular-nums; }
	.kpi-label { font-size: 0.78rem; color: var(--color-muted-foreground); }
	.card { border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); padding: 0.85rem 1rem; }
	.card-h { font-size: 0.78rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: var(--color-muted-foreground); margin-bottom: 0.8rem; }
	.bars { display: flex; flex-direction: column; gap: 0.4rem; }
	.bar-row { display: grid; grid-template-columns: 4rem 1fr auto; align-items: center; gap: 0.6rem; }
	.bar-label { font-size: 0.74rem; color: var(--color-muted-foreground); }
	.bar-wrap { height: 0.7rem; border-radius: 999px; background: var(--color-bg3); overflow: hidden; }
	.bar { display: block; height: 100%; border-radius: 999px; background: var(--color-accent); }
	.bar-n { font-size: 0.78rem; font-variant-numeric: tabular-nums; min-width: 5rem; text-align: right; }
</style>
