<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import * as m from '$lib/paraglide/messages';
	import { Target, Image } from 'lucide-svelte';
	import { PageHeader, EmptyState, Button } from '$lib/components/ui';
	import DataTable from '$lib/components/data-table/DataTable.svelte';
	import type { DataColumn } from '$lib/components/data-table/DataTable.svelte';

	let { data }: { data: PageData } = $props();
	const campaigns = $derived(data.campaigns);
	const adsets = $derived(data.adsets);
	const ads = $derived(data.ads);
	type Row = (typeof campaigns)[number];

	// svelte-ignore state_referenced_locally
	let fromDate = $state(data.range.from);
	// svelte-ignore state_referenced_locally
	let toDate = $state(data.range.to);

	// Hierarchy: campaign → ad set → ad, linked by id. Each level's metrics come
	// straight from the API (reach is not additive, so we never sum children up).
	function childrenOf(r: Row): Row[] {
		if (r.adId != null) return [];
		if (r.adsetId != null) return ads.filter((a) => a.adsetId === r.adsetId);
		return adsets.filter((a) => a.campaignId === r.campaignId);
	}
	const nameOf = (r: Row) => r.adName ?? r.adsetName ?? r.campaignName ?? '—';
	const rowId = (r: Row) => (r.adId != null ? `a:${r.adId}` : r.adsetId != null ? `s:${r.adsetId}` : `c:${r.campaignId}`);
	// Search a campaign by its own name + every descendant ad set / ad name, so a
	// query for a deep ad still surfaces (and can be expanded from) its campaign.
	function searchText(r: Row): string {
		const parts = [r.campaignName ?? ''];
		for (const s of adsets) if (s.campaignId === r.campaignId) parts.push(s.adsetName ?? '');
		for (const a of ads) if (a.campaignId === r.campaignId) parts.push(a.adName ?? '');
		return parts.join(' ');
	}

	function fmtMoney(v: number): string {
		return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
	}
	function fmtInt(v: number): string {
		return Math.round(v).toLocaleString();
	}

	// Campaign rows drill into the campaign detail page; ad rows with a linked
	// post cross-link to that post's detail page. Adset rows (and ads with no
	// linked post) are left to expand — no navigation target for them.
	function handleRowClick(r: Row) {
		if (r.adId != null) {
			if (r.postId) goto(`/socials/posts/${encodeURIComponent(r.postId)}`);
			return;
		}
		if (r.adsetId != null) return;
		if (r.campaignId != null) goto(`/socials/campaigns/${encodeURIComponent(r.campaignId)}`);
	}

	const columns: DataColumn<Row>[] = [
		{ key: 'preview', label: m.ads_col_thumbnail(), custom: true, sortable: false, exportable: false, align: 'center', width: 56 },
		{ key: 'name', label: m.ads_col_campaign(), custom: true, accessor: nameOf, exportValue: nameOf, sortFn: (a, b) => nameOf(a).localeCompare(nameOf(b)), width: 300 },
		{ key: 'spend', label: m.ads_col_spend(), align: 'right', numeric: true, custom: true, accessor: (r) => r.spend, sortFn: (a, b) => a.spend - b.spend, width: 120 },
		{ key: 'impressions', label: m.ads_col_impressions(), align: 'right', numeric: true, custom: true, accessor: (r) => r.impressions, sortFn: (a, b) => a.impressions - b.impressions, width: 120 },
		{ key: 'reach', label: m.ads_col_reach(), align: 'right', numeric: true, custom: true, accessor: (r) => r.reach, sortFn: (a, b) => a.reach - b.reach, width: 110 },
		{ key: 'clicks', label: m.ads_col_clicks(), align: 'right', numeric: true, custom: true, accessor: (r) => r.clicks, sortFn: (a, b) => a.clicks - b.clicks, width: 100 },
		{ key: 'ctr', label: m.ads_col_ctr(), align: 'right', numeric: true, custom: true, accessor: (r) => r.ctr, sortFn: (a, b) => a.ctr - b.ctr, width: 90 },
		{ key: 'cpc', label: m.ads_col_cpc(), align: 'right', numeric: true, custom: true, accessor: (r) => r.cpc, sortFn: (a, b) => a.cpc - b.cpc, width: 100 },
	];

	function navigateRange(f: string, t: string) {
		const p = new URLSearchParams(window.location.search);
		if (f) p.set('from', f);
		if (t) p.set('to', t);
		goto(`/socials/campaigns?${p}`, { keepFocus: true, noScroll: true, replaceState: true });
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

<svelte:head><title>{m.ads_nav_campaigns()} · {m.nav_ads()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.ads_nav_campaigns()} subtitle={m.ads_campaigns_subtitle()}>
		{#snippet leading()}<Target size={16} class="text-accent shrink-0" />{/snippet}
	</PageHeader>

	{#if !data.hasConnection}
		<div class="flex-1 min-h-0 overflow-auto p-4">
			<EmptyState icon={Target} title={m.ads_empty_title()} description={m.ads_empty_campaigns_desc()} />
		</div>
	{:else}
		<DataTable
			class="flex-1 min-h-0"
			{columns}
			data={campaigns}
			getRowId={rowId}
			getSubRows={childrenOf}
			searchPlaceholder={m.ads_campaigns_search()}
			searchFields={searchText}
			initialSort={{ key: 'spend', dir: 'desc' }}
			exportable
			exportName="ad-campaigns"
			storageKey="ads-campaigns"
			emptyMessage={m.ads_empty_campaigns_desc()}
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
				{#if col.key === 'preview'}
					{#if r.adId != null}
						{#if r.thumbFileId}
							<img src="/api/files/{r.thumbFileId}/raw" loading="lazy" alt="" width="40" height="40" class="row-thumb" />
						{:else}
							<div class="row-thumb row-thumb-placeholder" aria-hidden="true"><Image size={16} /></div>
						{/if}
					{/if}
				{:else if col.key === 'name'}
					<span class="truncate block" class:font-medium={r.adId == null && r.adsetId == null}>{nameOf(r)}</span>
				{:else if col.key === 'spend'}
					<span class="tabular-nums">{fmtMoney(r.spend)}</span>
				{:else if col.key === 'impressions'}
					<span class="tabular-nums">{fmtInt(r.impressions)}</span>
				{:else if col.key === 'reach'}
					<span class="tabular-nums">{fmtInt(r.reach)}</span>
				{:else if col.key === 'clicks'}
					<span class="tabular-nums">{fmtInt(r.clicks)}</span>
				{:else if col.key === 'ctr'}
					<span class="tabular-nums">{r.ctr.toFixed(2)}%</span>
				{:else if col.key === 'cpc'}
					<span class="tabular-nums">{fmtMoney(r.cpc)}</span>
				{/if}
			{/snippet}
		</DataTable>
	{/if}
</div>

<style>
	.date-label { display: flex; flex-direction: row; align-items: center; gap: var(--space-2); font-size: var(--font-size-caption); color: var(--color-muted-foreground); white-space: nowrap; }
	.date-label input { padding: var(--space-1) var(--space-2); border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--color-card); color: var(--color-foreground); font-size: var(--font-size-body); color-scheme: dark; }
	.preset { padding: var(--space-1) var(--space-2); font-size: var(--font-size-caption); background: transparent; border: 1px solid var(--hairline); border-radius: var(--radius-md); cursor: pointer; color: var(--color-muted-foreground); transition: background var(--duration-fast), color var(--duration-fast); }
	.preset:hover { background: var(--color-card); color: inherit; }
	.row-thumb {
		width: 40px; height: 40px; border-radius: var(--radius-md); object-fit: cover;
		display: flex; align-items: center; justify-content: center; flex-shrink: 0;
	}
	.row-thumb-placeholder {
		background: color-mix(in srgb, var(--color-muted-foreground) 15%, transparent);
		color: var(--color-muted-foreground);
	}
</style>
