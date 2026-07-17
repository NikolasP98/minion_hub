<script lang="ts">
	import { goto } from '$lib/navigation';
	import type { PageData } from './$types';
	import * as m from '$lib/paraglide/messages';
	import { MessagesSquare } from 'lucide-svelte';
	import { PageHeader, EmptyState, Button, iconSizes } from '$lib/components/ui';
	import DataTable from '$lib/components/data-table/DataTable.svelte';
	import type { DataColumn } from '$lib/components/data-table/DataTable.svelte';
	import type { AdPerformanceRow } from '$server/services/meta/ad-performance.service';

	let { data }: { data: PageData } = $props();
	const campaigns = $derived(data.campaigns);
	const ads = $derived(data.ads);
	type Row = AdPerformanceRow;

	// svelte-ignore state_referenced_locally
	let fromDate = $state(data.range.from);
	// svelte-ignore state_referenced_locally
	let toDate = $state(data.range.to);

	// Campaign rows expand to their ads (grouped by campaignId). Ad rows are leaves.
	function childrenOf(r: Row): Row[] {
		if (r.adId != null) return [];
		return ads.filter((a) => a.campaignId === r.campaignId);
	}
	const nameOf = (r: Row) => r.adName ?? r.campaignName ?? '—';
	const rowId = (r: Row) => (r.adId != null ? `a:${r.adId}` : `c:${r.campaignId}`);
	function searchText(r: Row): string {
		const parts = [r.campaignName ?? ''];
		for (const a of ads) if (a.campaignId === r.campaignId) parts.push(a.adName ?? '');
		return parts.join(' ');
	}

	function fmtMoney(v: number): string {
		return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
	}
	function fmtInt(v: number): string {
		return Math.round(v).toLocaleString();
	}

	// Ribbon totals: spend/convos/clicks/impressions are additive across campaigns;
	// cost-per-conversation and CTR are derived from those sums (not averaged).
	const totals = $derived.by(() => {
		let spend = 0;
		let conversations = 0;
		let clicks = 0;
		let impressions = 0;
		for (const c of campaigns) {
			spend += c.spend;
			conversations += c.conversationsStarted;
			clicks += c.clicks;
			impressions += c.impressions;
		}
		return {
			spend,
			conversations,
			costPerConversation: conversations > 0 ? spend / conversations : null,
			ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
		};
	});

	const kpis = $derived([
		{ id: 'spend', label: m.ads_kpi_spend(), value: fmtMoney(totals.spend) },
		{ id: 'conversations', label: m.ads_kpi_conversations(), value: fmtInt(totals.conversations) },
		{
			id: 'cpc',
			label: m.ads_kpi_cost_per_convo(),
			value: totals.costPerConversation == null ? '—' : fmtMoney(totals.costPerConversation),
		},
		{ id: 'ctr', label: m.ads_kpi_ctr(), value: `${totals.ctr.toFixed(2)}%` },
	]);

	// Campaign rows drill into the campaign detail page; ad rows just expand.
	function handleRowClick(r: Row) {
		if (r.adId != null) return;
		if (r.campaignId != null) goto(`/socials/campaigns/${encodeURIComponent(r.campaignId)}`);
	}

	const columns: DataColumn<Row>[] = [
		{ key: 'name', label: m.ads_col_campaign(), custom: true, accessor: nameOf, exportValue: nameOf, sortFn: (a, b) => nameOf(a).localeCompare(nameOf(b)), width: 300 },
		{ key: 'conversations', label: m.ads_col_conversations(), align: 'right', numeric: true, custom: true, accessor: (r) => r.conversationsStarted, sortFn: (a, b) => a.conversationsStarted - b.conversationsStarted, width: 130 },
		{ key: 'costPerConversation', label: m.ads_col_cost_per_convo(), align: 'right', numeric: true, custom: true, accessor: (r) => r.costPerConversation ?? Infinity, sortFn: (a, b) => (a.costPerConversation ?? Infinity) - (b.costPerConversation ?? Infinity), width: 130 },
		{ key: 'spend', label: m.ads_col_spend(), align: 'right', numeric: true, custom: true, accessor: (r) => r.spend, sortFn: (a, b) => a.spend - b.spend, width: 120 },
		{ key: 'impressions', label: m.ads_col_impressions(), align: 'right', numeric: true, custom: true, accessor: (r) => r.impressions, sortFn: (a, b) => a.impressions - b.impressions, width: 120 },
		{ key: 'clicks', label: m.ads_col_clicks(), align: 'right', numeric: true, custom: true, accessor: (r) => r.clicks, sortFn: (a, b) => a.clicks - b.clicks, width: 100 },
		{ key: 'ctr', label: m.ads_col_ctr(), align: 'right', numeric: true, custom: true, accessor: (r) => r.ctr, sortFn: (a, b) => a.ctr - b.ctr, width: 90 },
	];

	function navigateRange(f: string, t: string) {
		const p = new URLSearchParams(window.location.search);
		if (f) p.set('from', f);
		if (t) p.set('to', t);
		goto(`/socials/ad-performance?${p}`, { keepFocus: true, noScroll: true, replaceState: true });
	}
	function preset30d() {
		const to = new Date();
		const from = new Date();
		from.setDate(from.getDate() - 30);
		fromDate = from.toISOString().slice(0, 10);
		toDate = to.toISOString().slice(0, 10);
		navigateRange(fromDate, toDate);
	}
	function presetAll() {
		if (!data.extent.minDate || !data.extent.maxDate) return;
		const to = new Date(`${data.extent.maxDate}T00:00:00Z`);
		to.setUTCDate(to.getUTCDate() + 1);
		fromDate = data.extent.minDate;
		toDate = to.toISOString().slice(0, 10);
		navigateRange(fromDate, toDate);
	}
</script>

<svelte:head><title>{m.ads_nav_performance()} · {m.nav_ads()}</title></svelte:head>

<div class="ad-performance-page flex flex-col h-full min-h-0 flex-1 min-w-0">
	<PageHeader title={m.ads_nav_performance()} subtitle={m.ads_performance_subtitle()}>
		{#snippet leading()}<MessagesSquare size={iconSizes.md} class="text-accent shrink-0" />{/snippet}
	</PageHeader>

	{#if !data.hasConnection}
		<div class="flex-1 min-h-0 overflow-auto p-4">
			<EmptyState icon={MessagesSquare} title={m.ads_empty_title()} description={m.ads_empty_performance_desc()} />
		</div>
	{:else}
		<div class="kpi-ribbon">
			{#each kpis as k (k.id)}
				<div class="kpi">
					<div class="kpi-val">{k.value}</div>
					<div class="kpi-label">{k.label}</div>
				</div>
			{/each}
		</div>

		<DataTable
			class="flex-1 min-h-0"
			{columns}
			data={campaigns}
			getRowId={rowId}
			getSubRows={childrenOf}
			searchPlaceholder={m.ads_performance_search()}
			searchFields={searchText}
			initialSort={{ key: 'conversations', dir: 'desc' }}
			exportable
			exportName="ad-performance"
			storageKey="ads-performance"
			emptyMessage={m.ads_empty_performance_desc()}
			onRowClick={handleRowClick}
		>
			{#snippet toolbar()}
				<label class="date-label">
					<span>{m.ads_date_from()}</span>
					<input type="date" bind:value={fromDate} oninput={() => navigateRange(fromDate, toDate)} />
				</label>
				<label class="date-label">
					<span>{m.ads_date_to()}</span>
					<input type="date" bind:value={toDate} oninput={() => navigateRange(fromDate, toDate)} />
				</label>
				<Button variant="ghost" class="preset" onclick={preset30d}>{m.ads_preset_30d()}</Button>
				<Button variant="ghost" class="preset" onclick={presetAll}>{m.ads_preset_all()}</Button>
			{/snippet}

			{#snippet cell(r: Row, col: DataColumn<Row>)}
				{#if col.key === 'name'}
					<span class="truncate block" class:font-medium={r.adId == null}>{nameOf(r)}</span>
				{:else if col.key === 'conversations'}
					<span class="tabular-nums">{fmtInt(r.conversationsStarted)}</span>
				{:else if col.key === 'costPerConversation'}
					<span class="tabular-nums">{r.costPerConversation == null ? '—' : fmtMoney(r.costPerConversation)}</span>
				{:else if col.key === 'spend'}
					<span class="tabular-nums">{fmtMoney(r.spend)}</span>
				{:else if col.key === 'impressions'}
					<span class="tabular-nums">{fmtInt(r.impressions)}</span>
				{:else if col.key === 'clicks'}
					<span class="tabular-nums">{fmtInt(r.clicks)}</span>
				{:else if col.key === 'ctr'}
					<span class="tabular-nums">{r.ctr.toFixed(2)}%</span>
				{/if}
			{/snippet}
		</DataTable>
	{/if}
</div>

<style>
	.kpi-ribbon {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
	}
	.kpi {
		display: flex;
		flex-direction: column;
		justify-content: center;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-lg);
		background: var(--color-surface-1);
	}
	.kpi-val {
		font-size: var(--font-size-display);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.kpi-label {
		font-size: var(--font-size-caption);
		color: var(--color-text-secondary);
		margin-top: var(--space-1);
	}
	.date-label {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-caption);
		color: var(--color-text-secondary);
		white-space: nowrap;
	}
	.date-label input {
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
		background: var(--color-surface-1);
		color: var(--color-text-primary);
		font-size: var(--font-size-body);
	}
	.ad-performance-page :global(.preset) {
		padding: var(--space-1) var(--space-2);
		font-size: var(--font-size-caption);
		background: transparent;
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
		cursor: pointer;
		color: var(--color-text-secondary);
		transition: background var(--duration-fast), color var(--duration-fast);
	}
	.ad-performance-page :global(.preset):hover {
		background: var(--color-surface-2);
		color: inherit;
	}
</style>
