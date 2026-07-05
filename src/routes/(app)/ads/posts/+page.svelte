<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import * as m from '$lib/paraglide/messages';
	import { Image, ExternalLink } from 'lucide-svelte';
	import { PageHeader, EmptyState } from '$lib/components/ui';

	let { data }: { data: PageData } = $props();
	const posts = $derived(data.posts);

	let search = $state('');

	const view = $derived.by(() => {
		const q = search.trim().toLowerCase();
		if (!q) return posts;
		return posts.filter((p) => (p.caption ?? '').toLowerCase().includes(q));
	});

	function setPlatform(platform: 'fb' | 'ig' | null) {
		const p = new URLSearchParams();
		if (platform) p.set('platform', platform);
		goto(`/ads/posts?${p}`, { keepFocus: true, noScroll: true });
	}

	function fmtDate(d: string | null): string {
		if (!d) return '—';
		return new Date(d).toLocaleDateString();
	}
	function fmtInt(v: number): string {
		return Math.round(v).toLocaleString();
	}
	function truncate(s: string | null, n = 90): string {
		if (!s) return '—';
		return s.length > n ? `${s.slice(0, n)}…` : s;
	}
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
		<div class="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-[var(--hairline)]">
			<input
				bind:value={search}
				placeholder={m.ads_posts_search()}
				class="h-8 px-3 text-sm rounded-[var(--radius-md)] bg-bg3 border border-[var(--hairline)] min-w-[14rem]"
			/>
			<div class="seg-group">
				<button class="seg" class:active={data.platform === null} onclick={() => setPlatform(null)}>{m.ads_col_platform()}</button>
				<button class="seg" class:active={data.platform === 'fb'} onclick={() => setPlatform('fb')}>{m.ads_platform_fb()}</button>
				<button class="seg" class:active={data.platform === 'ig'} onclick={() => setPlatform('ig')}>{m.ads_platform_ig()}</button>
			</div>
			<span class="t-caption">{m.ads_posts_count({ count: view.length })}</span>
		</div>

		<div class="flex-1 min-h-0 overflow-auto">
			{#if posts.length === 0}
				<div class="flex flex-col items-center justify-center h-full gap-2 p-8 text-center">
					<Image size={32} class="text-muted-foreground" />
					<p class="t-caption">{m.ads_empty_posts_desc()}</p>
				</div>
			{:else}
				<table class="w-full text-sm border-collapse">
					<thead class="sticky top-0 bg-bg/95 backdrop-blur z-20">
						<tr class="text-left t-caption border-b border-[var(--hairline)]">
							<th class="px-4 py-2 font-medium">{m.ads_col_platform()}</th>
							<th class="px-3 py-2 font-medium">{m.ads_col_posted()}</th>
							<th class="px-3 py-2 font-medium">{m.ads_col_caption()}</th>
							<th class="px-3 py-2 font-medium">{m.ads_col_metrics()}</th>
							<th class="px-4 py-2 font-medium"></th>
						</tr>
					</thead>
					<tbody>
						{#if view.length === 0}
							<tr><td colspan="5" class="px-4 py-8 text-center t-caption text-muted-foreground">{m.ads_posts_no_match()}</td></tr>
						{/if}
						{#each view as post (post.postId)}
							<tr class="border-b border-[var(--hairline)]">
								<td class="px-4 py-2">
									<span class="post-platform" data-platform={post.platform ?? ''}>{post.platform === 'ig' ? m.ads_platform_ig() : m.ads_platform_fb()}</span>
								</td>
								<td class="px-3 py-2 t-caption">{fmtDate(post.postedAt)}</td>
								<td class="px-3 py-2 max-w-[24rem]"><span class="truncate block">{truncate(post.caption)}</span></td>
								<td class="px-3 py-2 t-caption">
									{#each Object.entries(post.metrics) as [key, value] (key)}
										<span class="metric-chip">{key}: {fmtInt(value)}</span>
									{/each}
								</td>
								<td class="px-4 py-2 text-right">
									{#if post.permalink}
										<a href={post.permalink} target="_blank" rel="noreferrer" class="post-link" title={m.ads_post_view_link()}>
											<ExternalLink size={13} />
										</a>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>
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
	.metric-chip {
		display: inline-block;
		margin-right: 0.5rem;
		white-space: nowrap;
	}
	.post-link {
		color: var(--color-muted-foreground);
		display: inline-flex;
	}
	.post-link:hover {
		color: var(--color-accent);
	}
</style>
