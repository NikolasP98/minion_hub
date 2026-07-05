<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import * as m from '$lib/paraglide/messages';
	import { Target, ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-svelte';
	import { PageHeader, EmptyState } from '$lib/components/ui';

	let { data }: { data: PageData } = $props();
	const rows = $derived(data.rows);

	// svelte-ignore state_referenced_locally
	let fromDate = $state(data.range.from);
	// svelte-ignore state_referenced_locally
	let toDate = $state(data.range.to);

	let search = $state('');
	type SortKey = 'name' | 'spend' | 'impressions' | 'reach' | 'clicks' | 'ctr' | 'cpc';
	let sortKey = $state<SortKey>('spend');
	let sortDir = $state<'asc' | 'desc'>('desc');

	type Row = (typeof rows)[number];

	function setSort(key: SortKey) {
		if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		else {
			sortKey = key;
			sortDir = key === 'name' ? 'asc' : 'desc';
		}
	}

	function nameOf(r: Row): string {
		return (data.level === 'campaign' ? r.campaignName : data.level === 'adset' ? r.adsetName : r.adName) ?? '—';
	}

	const view = $derived.by(() => {
		const q = search.trim().toLowerCase();
		let list = rows;
		if (q) {
			list = list.filter(
				(r) =>
					(r.campaignName ?? '').toLowerCase().includes(q) ||
					(r.adsetName ?? '').toLowerCase().includes(q) ||
					(r.adName ?? '').toLowerCase().includes(q),
			);
		}
		const cmp: Record<SortKey, (a: Row, b: Row) => number> = {
			name: (a, b) => nameOf(a).localeCompare(nameOf(b)),
			spend: (a, b) => a.spend - b.spend,
			impressions: (a, b) => a.impressions - b.impressions,
			reach: (a, b) => a.reach - b.reach,
			clicks: (a, b) => a.clicks - b.clicks,
			ctr: (a, b) => a.ctr - b.ctr,
			cpc: (a, b) => a.cpc - b.cpc,
		};
		const dir = sortDir === 'asc' ? 1 : -1;
		return [...list].sort((a, b) => dir * cmp[sortKey](a, b));
	});

	function setLevel(level: 'campaign' | 'adset' | 'ad') {
		const p = new URLSearchParams(window.location.search);
		p.set('level', level);
		goto(`/ads/campaigns?${p}`, { keepFocus: true, noScroll: true, replaceState: true });
	}

	function navigateRange(f: string, t: string) {
		const p = new URLSearchParams(window.location.search);
		if (f) p.set('from', f);
		if (t) p.set('to', t);
		goto(`/ads/campaigns?${p}`, { keepFocus: true, noScroll: true, replaceState: true });
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
		// range.to is exclusive — bump maxDate by 1 day so the last day of data is included.
		const to = new Date(`${data.extent.maxDate}T00:00:00Z`);
		to.setUTCDate(to.getUTCDate() + 1);
		fromDate = data.extent.minDate;
		toDate = to.toISOString().slice(0, 10);
		navigateRange(fromDate, toDate);
	}

	function fmtMoney(v: number): string {
		return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
	}
	function fmtInt(v: number): string {
		return Math.round(v).toLocaleString();
	}
</script>

<svelte:head><title>{m.ads_nav_campaigns()} · {m.nav_ads()}</title></svelte:head>

{#snippet sortHead(key: SortKey, label: string)}
	<button class="sort-h" class:active={sortKey === key} onclick={() => setSort(key)}>
		<span>{label}</span>
		{#if sortKey === key}
			{#if sortDir === 'asc'}<ArrowUp size={12} />{:else}<ArrowDown size={12} />{/if}
		{:else}
			<ChevronsUpDown size={11} class="dim" />
		{/if}
	</button>
{/snippet}

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.ads_nav_campaigns()} subtitle={m.ads_campaigns_subtitle()}>
		{#snippet leading()}<Target size={16} class="text-accent shrink-0" />{/snippet}
	</PageHeader>

	{#if !data.hasConnection}
		<div class="flex-1 min-h-0 overflow-auto p-4">
			<EmptyState icon={Target} title={m.ads_empty_title()} description={m.ads_empty_campaigns_desc()} />
		</div>
	{:else}
		<div class="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-[var(--hairline)]">
			<label class="date-label">
				<span>{m.ads_date_from()}</span>
				<input type="date" bind:value={fromDate} oninput={() => navigateRange(fromDate, toDate)} />
			</label>
			<label class="date-label">
				<span>{m.ads_date_to()}</span>
				<input type="date" bind:value={toDate} oninput={() => navigateRange(fromDate, toDate)} />
			</label>
			<button class="preset" onclick={preset30d}>{m.ads_preset_30d()}</button>
			<button class="preset" onclick={presetAll}>{m.ads_preset_all()}</button>
			<input
				bind:value={search}
				placeholder={m.ads_campaigns_search()}
				class="h-8 px-3 text-sm rounded-[var(--radius-md)] bg-bg3 border border-[var(--hairline)] min-w-[14rem]"
			/>
			<div class="seg-group">
				<button class="seg" class:active={data.level === 'campaign'} onclick={() => setLevel('campaign')}>{m.ads_campaigns_level_campaign()}</button>
				<button class="seg" class:active={data.level === 'adset'} onclick={() => setLevel('adset')}>{m.ads_campaigns_level_adset()}</button>
				<button class="seg" class:active={data.level === 'ad'} onclick={() => setLevel('ad')}>{m.ads_campaigns_level_ad()}</button>
			</div>
			<span class="t-caption">{m.ads_campaigns_count({ count: view.length })}</span>
		</div>

		<div class="flex-1 min-h-0 overflow-auto">
			{#if rows.length === 0}
				<div class="flex flex-col items-center justify-center h-full gap-2 p-8 text-center">
					<Target size={32} class="text-muted-foreground" />
					<p class="t-caption">{m.ads_empty_campaigns_desc()}</p>
				</div>
			{:else}
				<table class="w-full text-sm border-collapse">
					<thead class="sticky top-0 bg-bg/95 backdrop-blur z-20">
						<tr class="text-left t-caption border-b border-[var(--hairline)]">
							<th class="px-4 py-2 font-medium">{m.ads_col_campaign()}</th>
							{#if data.level === 'adset' || data.level === 'ad'}<th class="px-3 py-2 font-medium">{m.ads_col_adset()}</th>{/if}
							{#if data.level === 'ad'}<th class="px-3 py-2 font-medium">{m.ads_col_ad()}</th>{/if}
							<th class="px-3 py-2 font-medium text-right">{@render sortHead('spend', m.ads_col_spend())}</th>
							<th class="px-3 py-2 font-medium text-right">{@render sortHead('impressions', m.ads_col_impressions())}</th>
							<th class="px-3 py-2 font-medium text-right">{@render sortHead('reach', m.ads_col_reach())}</th>
							<th class="px-3 py-2 font-medium text-right">{@render sortHead('clicks', m.ads_col_clicks())}</th>
							<th class="px-3 py-2 font-medium text-right">{@render sortHead('ctr', m.ads_col_ctr())}</th>
							<th class="px-4 py-2 font-medium text-right">{@render sortHead('cpc', m.ads_col_cpc())}</th>
						</tr>
					</thead>
					<tbody>
						{#if view.length === 0}
							<tr><td colspan="8" class="px-4 py-8 text-center t-caption text-muted-foreground">{m.ads_campaigns_no_match()}</td></tr>
						{/if}
						{#each view as r (`${r.campaignId}-${r.adsetId}-${r.adId}`)}
							<tr class="border-b border-[var(--hairline)]">
								{#if data.level === 'campaign'}
									<td class="px-4 py-2 font-medium">{r.campaignName ?? '—'}</td>
								{:else}
									<td class="px-4 py-2">{r.campaignName ?? '—'}</td>
									{#if data.level === 'adset' || data.level === 'ad'}<td class="px-3 py-2">{r.adsetName ?? '—'}</td>{/if}
									{#if data.level === 'ad'}<td class="px-3 py-2 font-medium">{r.adName ?? '—'}</td>{/if}
								{/if}
								<td class="px-3 py-2 text-right font-variant-numeric tabular-nums">{fmtMoney(r.spend)}</td>
								<td class="px-3 py-2 text-right font-variant-numeric tabular-nums">{fmtInt(r.impressions)}</td>
								<td class="px-3 py-2 text-right font-variant-numeric tabular-nums">{fmtInt(r.reach)}</td>
								<td class="px-3 py-2 text-right font-variant-numeric tabular-nums">{fmtInt(r.clicks)}</td>
								<td class="px-3 py-2 text-right font-variant-numeric tabular-nums">{r.ctr.toFixed(2)}%</td>
								<td class="px-4 py-2 text-right font-variant-numeric tabular-nums">{fmtMoney(r.cpc)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>
	{/if}
</div>

<style>
	.sort-h {
		display: inline-flex; align-items: center; gap: 0.25rem;
		font: inherit; color: inherit; cursor: pointer;
	}
	.sort-h.active { color: var(--color-accent); }
	:global(.sort-h .dim) { opacity: 0.35; }
	.date-label {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.72rem;
		color: var(--color-muted-foreground);
		white-space: nowrap;
	}
	.date-label input {
		padding: 0.3rem 0.5rem;
		border: 1px solid var(--hairline);
		border-radius: 6px;
		background: var(--color-card);
		color: var(--color-foreground);
		font-size: 0.82rem;
		color-scheme: dark;
	}
	.preset {
		padding: 0.3rem 0.65rem;
		font-size: 0.75rem;
		background: transparent;
		border: 1px solid var(--hairline);
		border-radius: 6px;
		cursor: pointer;
		color: var(--color-muted-foreground);
		transition: background 0.15s, color 0.15s;
	}
	.preset:hover {
		background: var(--color-card);
		color: inherit;
	}
	.seg-group {
		display: flex;
		border: 1px solid var(--hairline);
		border-radius: 6px;
		overflow: hidden;
	}
	.seg {
		padding: 0.3rem 0.7rem;
		font-size: 0.78rem;
		background: transparent;
		border: none;
		cursor: pointer;
		color: var(--color-muted-foreground);
		transition: background 0.15s, color 0.15s;
	}
	.seg:not(:last-child) { border-right: 1px solid var(--hairline); }
	.seg.active { background: var(--color-accent); color: #fff; }
</style>
