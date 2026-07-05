<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import * as m from '$lib/paraglide/messages';
	import { Image, ExternalLink } from 'lucide-svelte';
	import { PageHeader, EmptyState } from '$lib/components/ui';
	import DataTable from '$lib/components/data-table/DataTable.svelte';
	import type { DataColumn } from '$lib/components/data-table/DataTable.svelte';

	let { data }: { data: PageData } = $props();
	const posts = $derived(data.posts);
	type Row = (typeof posts)[number];

	function setPlatform(platform: 'fb' | 'ig' | null) {
		const p = new URLSearchParams(window.location.search);
		if (platform) p.set('platform', platform);
		else p.delete('platform');
		goto(`/ads/posts?${p}`, { keepFocus: true, noScroll: true, replaceState: true });
	}

	function setPromoted(promoted: 'ad' | 'organic' | null) {
		const p = new URLSearchParams(window.location.search);
		if (promoted) p.set('promoted', promoted);
		else p.delete('promoted');
		goto(`/ads/posts?${p}`, { keepFocus: true, noScroll: true, replaceState: true });
	}

	const dateOf = (d: string | null) => (d ? new Date(d).getTime() : -Infinity);
	function fmtDate(d: string | null): string {
		return d ? new Date(d).toLocaleDateString() : '—';
	}
	function fmtInt(v: number): string {
		return Math.round(v).toLocaleString();
	}
	function truncate(s: string | null, n = 90): string {
		if (!s) return '—';
		return s.length > n ? `${s.slice(0, n)}…` : s;
	}

	// Metric column set is data-driven: IG/FB metric names drift, so we derive the
	// union of keys present across the loaded posts rather than hardcoding a list.
	const metricKeys = $derived.by(() => {
		const s = new Set<string>();
		for (const p of posts) for (const k of Object.keys(p.metrics)) s.add(k);
		return [...s].sort();
	});

	const columns = $derived.by<DataColumn<Row>[]>(() => [
		{ key: 'platform', label: m.ads_col_platform(), custom: true, accessor: (p) => p.platform ?? '', width: 110 },
		{ key: 'type', label: m.ads_col_type(), custom: true, accessor: (p) => (p.isPromoted ? 'ad' : 'organic'), width: 110 },
		{ key: 'posted', label: m.ads_col_posted(), custom: true, accessor: (p) => p.postedAt, sortFn: (a, b) => dateOf(a.postedAt) - dateOf(b.postedAt), exportValue: (p) => (p.postedAt ? new Date(p.postedAt).toISOString().slice(0, 10) : ''), width: 130 },
		{ key: 'caption', label: m.ads_col_caption(), custom: true, accessor: (p) => p.caption ?? '', exportValue: (p) => p.caption ?? '', width: 340 },
		...metricKeys.map((k): DataColumn<Row> => ({
			key: `m:${k}`, label: k, align: 'right', numeric: true, custom: true,
			accessor: (p) => p.metrics[k] ?? 0, sortFn: (a, b) => (a.metrics[k] ?? 0) - (b.metrics[k] ?? 0), width: 120,
		})),
		{ key: 'link', label: m.ads_post_view_link(), custom: true, align: 'center', sortable: false, exportable: false, width: 56 },
	]);
</script>

<svelte:head><title>{m.ads_nav_posts()} · {m.nav_ads()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.ads_nav_posts()} subtitle={m.ads_posts_subtitle()}>
		{#snippet leading()}<Image size={16} class="text-accent shrink-0" />{/snippet}
	</PageHeader>

	{#if !data.hasConnection}
		<div class="flex-1 min-h-0 overflow-auto p-4">
			<EmptyState icon={Image} title={m.ads_empty_title()} description={m.ads_empty_posts_desc()} />
		</div>
	{:else}
		<DataTable
			class="flex-1 min-h-0"
			{columns}
			data={posts}
			getRowId={(p) => p.postId}
			searchPlaceholder={m.ads_posts_search()}
			searchFields={(p) => p.caption ?? ''}
			initialSort={{ key: 'posted', dir: 'desc' }}
			exportable
			exportName="ad-posts"
			selectable
			storageKey="ads-posts"
			emptyMessage={m.ads_empty_posts_desc()}
		>
			{#snippet toolbar()}
				<div class="seg-group">
					<button class="seg" class:active={data.platform === null} onclick={() => setPlatform(null)}>{m.ads_col_platform()}</button>
					<button class="seg" class:active={data.platform === 'fb'} onclick={() => setPlatform('fb')}>{m.ads_platform_fb()}</button>
					<button class="seg" class:active={data.platform === 'ig'} onclick={() => setPlatform('ig')}>{m.ads_platform_ig()}</button>
				</div>
				<div class="seg-group">
					<button class="seg" class:active={data.promoted === null} onclick={() => setPromoted(null)}>{m.ads_promoted_all()}</button>
					<button class="seg" class:active={data.promoted === 'organic'} onclick={() => setPromoted('organic')}>{m.ads_promoted_organic()}</button>
					<button class="seg" class:active={data.promoted === 'ad'} onclick={() => setPromoted('ad')}>{m.ads_promoted_ads()}</button>
				</div>
			{/snippet}

			{#snippet cell(p: Row, col: DataColumn<Row>)}
				{#if col.key === 'platform'}
					<span class="post-platform" data-platform={p.platform ?? ''}>{p.platform === 'ig' ? m.ads_platform_ig() : m.ads_platform_fb()}</span>
				{:else if col.key === 'type'}
					<span class="post-type" class:ad={p.isPromoted}>{p.isPromoted ? m.ads_badge_ad() : m.ads_badge_organic()}</span>
				{:else if col.key === 'posted'}
					<span class="t-caption">{fmtDate(p.postedAt)}</span>
				{:else if col.key === 'caption'}
					<span class="truncate block" title={p.caption ?? ''}>{truncate(p.caption)}</span>
				{:else if col.key === 'link'}
					{#if p.permalink}
						<a href={p.permalink} target="_blank" rel="noreferrer" class="post-link" title={m.ads_post_view_link()}>
							<ExternalLink size={13} />
						</a>
					{/if}
				{:else if col.key.startsWith('m:')}
					<span class="tabular-nums">{fmtInt(p.metrics[col.key.slice(2)] ?? 0)}</span>
				{/if}
			{/snippet}
		</DataTable>
	{/if}
</div>

<style>
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
	.post-platform {
		font-size: 0.7rem;
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-muted-foreground) 15%, transparent);
		color: var(--color-muted-foreground);
	}
	.post-platform[data-platform='ig'] {
		background: color-mix(in srgb, var(--color-pink, #ec4899) 15%, transparent);
		color: var(--color-pink, #ec4899);
	}
	.post-platform[data-platform='fb'] {
		background: color-mix(in srgb, var(--color-info, #3b82f6) 15%, transparent);
		color: var(--color-info, #3b82f6);
	}
	.post-type {
		font-size: 0.7rem;
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-muted-foreground) 15%, transparent);
		color: var(--color-muted-foreground);
	}
	.post-type.ad {
		background: color-mix(in srgb, var(--color-accent) 18%, transparent);
		color: var(--color-accent);
	}
	.post-link {
		color: var(--color-muted-foreground);
		display: inline-flex;
	}
	.post-link:hover {
		color: var(--color-accent);
	}
</style>
