<script lang="ts">
	import type { PageData } from './$types';
	import * as m from '$lib/paraglide/messages';
	import { goto } from '$app/navigation';
	import { Image, ExternalLink, Facebook, Instagram } from 'lucide-svelte';
	import { PageHeader, EmptyState } from '$lib/components/ui';
	import DataTable from '$lib/components/data-table/DataTable.svelte';
	import type { DataColumn } from '$lib/components/data-table/DataTable.svelte';
	import { metricLabel } from '$lib/ads/metric-labels';

	let { data }: { data: PageData } = $props();
	const posts = $derived(data.posts);
	type Row = (typeof posts)[number];

	const platformOptions = $derived([
		{ value: 'fb', label: m.ads_platform_fb() },
		{ value: 'ig', label: m.ads_platform_ig() },
	]);
	const typeOptions = $derived([
		{ value: 'organic', label: m.ads_badge_organic() },
		{ value: 'boosted', label: m.ads_badge_boosted() },
	]);

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
		{ key: 'thumb', label: m.ads_col_thumbnail(), custom: true, sortable: false, exportable: false, align: 'center', width: 56 },
		{ key: 'platform', label: m.ads_col_platform(), custom: true, accessor: (p) => p.platform ?? '', width: 110, filter: { options: () => platformOptions } },
		{ key: 'type', label: m.ads_col_type(), custom: true, accessor: (p) => (p.isPromoted ? 'boosted' : 'organic'), width: 110, filter: { options: () => typeOptions } },
		{ key: 'posted', label: m.ads_col_posted(), custom: true, accessor: (p) => p.postedAt, sortFn: (a, b) => dateOf(a.postedAt) - dateOf(b.postedAt), exportValue: (p) => (p.postedAt ? new Date(p.postedAt).toISOString().slice(0, 10) : ''), width: 130 },
		{ key: 'caption', label: m.ads_col_caption(), custom: true, accessor: (p) => p.caption ?? '', exportValue: (p) => p.caption ?? '', width: 340 },
		...metricKeys.map((k): DataColumn<Row> => ({
			key: `m:${k}`, label: metricLabel(k), align: 'right', numeric: true, custom: true,
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
			onRowClick={(p) => goto(`/socials/posts/${encodeURIComponent(p.postId)}`)}
		>
			{#snippet cell(p: Row, col: DataColumn<Row>)}
				{#if col.key === 'thumb'}
					{#if p.thumbFileId}
						<img src="/api/files/{p.thumbFileId}/raw" loading="lazy" alt="" width="40" height="40" class="post-thumb" />
					{:else if p.platform === 'ig'}
						<div class="post-thumb post-thumb-placeholder" data-platform="ig" aria-hidden="true"><Instagram size={16} /></div>
					{:else}
						<div class="post-thumb post-thumb-placeholder" data-platform="fb" aria-hidden="true"><Facebook size={16} /></div>
					{/if}
				{:else if col.key === 'platform'}
					<span class="post-platform" data-platform={p.platform ?? ''}>{p.platform === 'ig' ? m.ads_platform_ig() : m.ads_platform_fb()}</span>
				{:else if col.key === 'type'}
					<span class="post-type" class:ad={p.isPromoted}>{p.isPromoted ? m.ads_badge_boosted() : m.ads_badge_organic()}</span>
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
	.post-thumb {
		width: 40px;
		height: 40px;
		border-radius: 8px;
		object-fit: cover;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
	.post-thumb-placeholder {
		background: color-mix(in srgb, var(--color-muted-foreground) 15%, transparent);
		color: var(--color-muted-foreground);
	}
	.post-thumb-placeholder[data-platform='ig'] {
		background: color-mix(in srgb, var(--color-pink, #ec4899) 15%, transparent);
		color: var(--color-pink, #ec4899);
	}
	.post-thumb-placeholder[data-platform='fb'] {
		background: color-mix(in srgb, var(--color-info, #3b82f6) 15%, transparent);
		color: var(--color-info, #3b82f6);
	}
</style>
