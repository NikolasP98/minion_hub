<script lang="ts">
	import type { PageData } from './$types';
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { ArrowLeft, ExternalLink, Facebook, Instagram, Megaphone } from 'lucide-svelte';
	import { PageHeader, Button } from '$lib/components/ui';
	import { createBackNav } from '$lib/nav/back-nav.svelte';
	import { metricLabel } from '$lib/ads/metric-labels';

	let { data }: { data: PageData } = $props();
	const back = createBackNav('/socials/posts', m.ads_nav_posts);
	const post = $derived(data.post);

	function fmtDate(d: string | null): string {
		return d ? new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
	}
	function fmtInt(v: number): string {
		return Math.round(v).toLocaleString();
	}

	const metricEntries = $derived(Object.entries(post.metrics).sort(([a], [b]) => a.localeCompare(b)));

	// ── On-demand rich media (spec §5.3) ────────────────────────────────────
	// Start with the mirrored preview (instant, already on the page data);
	// upgrade in place if the fresh-media endpoint returns a carousel/video.
	type Media = { type: 'image' | 'video'; url: string; poster?: string };
	const mirroredUrl = $derived(post.thumbFileId ? `/api/files/${post.thumbFileId}/raw` : null);
	let media = $state<Media[]>([]);

	onMount(async () => {
		try {
			const res = await fetch(`/api/meta/posts/${encodeURIComponent(post.postId)}`);
			if (!res.ok) return;
			const body = (await res.json()) as { items?: Media[] };
			if (Array.isArray(body.items) && body.items.length > 0) media = body.items;
		} catch {
			// enrichment is best-effort — the mirrored preview (or glyph) stays put
		}
	});
</script>

<svelte:head><title>{m.ads_post_detail_title()} · {m.nav_ads()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.ads_post_detail_title()} subtitle={fmtDate(post.postedAt)}>
		{#snippet leading()}
			{#if post.platform === 'ig'}<Instagram size={16} class="text-accent shrink-0" />{:else}<Facebook size={16} class="text-accent shrink-0" />{/if}
		{/snippet}
	</PageHeader>

	<div class="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4 max-w-3xl">
		<Button variant="outline" size="sm" onclick={back.go} class="self-start">
			<ArrowLeft size={14} />
			{back.label}
		</Button>

		<div class="doc">
			<!-- Media -->
			<section class="media-sec">
				{#if media.length > 1}
					<div class="carousel">
						{#each media as item, i (i)}
							{#if item.type === 'video'}
								<!-- svelte-ignore a11y_media_has_caption -- ponytail: source video has no caption track (Meta CDN), no captioning pipeline in scope -->
								<video controls poster={item.poster} src={item.url} class="carousel-item"></video>
							{:else}
								<img src={item.url} alt="" class="carousel-item" />
							{/if}
						{/each}
					</div>
				{:else if media.length === 1 && media[0].type === 'video'}
					<!-- svelte-ignore a11y_media_has_caption -- ponytail: source video has no caption track (Meta CDN), no captioning pipeline in scope -->
					<video controls poster={media[0].poster ?? mirroredUrl ?? undefined} src={media[0].url} class="media-single"></video>
				{:else if media.length === 1}
					<img src={media[0].url} alt="" class="media-single" />
				{:else if mirroredUrl}
					<img src={mirroredUrl} alt="" class="media-single" />
				{:else}
					<div class="media-glyph" data-platform={post.platform ?? ''} aria-hidden="true">
						{#if post.platform === 'ig'}<Instagram size={40} />{:else}<Facebook size={40} />{/if}
					</div>
				{/if}
			</section>

			<!-- Badges + meta -->
			<section class="doc-sec meta-row">
				<span class="post-platform" data-platform={post.platform ?? ''}>{post.platform === 'ig' ? m.ads_platform_ig() : m.ads_platform_fb()}</span>
				<span class="post-type" class:ad={post.isPromoted}>{post.isPromoted ? m.ads_badge_ad() : m.ads_badge_organic()}</span>
				{#if post.promotedByAdIds.length > 0}
					<a class="promoted-chip" href="/socials/campaigns">
						<Megaphone size={13} />
						{m.ads_post_detail_promoted_chip({ count: post.promotedByAdIds.length })}
					</a>
				{/if}
				{#if post.permalink}
					<a class="perma-link" href={post.permalink} target="_blank" rel="noreferrer">
						<ExternalLink size={13} />
						{m.ads_post_view_link()}
					</a>
				{/if}
			</section>

			<!-- Full caption -->
			{#if post.caption}
				<section class="doc-sec">
					<header class="panel-h">{m.ads_col_caption()}</header>
					<p class="caption-full">{post.caption}</p>
				</section>
			{/if}

			<!-- Stats -->
			{#if metricEntries.length > 0}
				<section class="doc-sec">
					<header class="panel-h">{m.ads_post_detail_stats_title()}</header>
					<div class="stats-grid">
						{#each metricEntries as [key, value] (key)}
							<div class="stat">
								<span class="stat-v">{fmtInt(value)}</span>
								<span class="stat-l">{metricLabel(key)}</span>
							</div>
						{/each}
					</div>
				</section>
			{/if}
		</div>
	</div>
</div>

<style>
	.doc {
		border: 1px solid var(--hairline);
		border-radius: var(--radius-lg);
		background: var(--color-card);
		overflow: hidden;
	}
	.media-sec {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-bg3, color-mix(in srgb, var(--color-muted-foreground) 6%, transparent));
	}
	.media-single {
		max-width: 520px;
		width: 100%;
		max-height: 640px;
		object-fit: contain;
		border-radius: 0;
	}
	.media-glyph {
		width: 100%;
		height: 220px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-muted-foreground);
	}
	.media-glyph[data-platform='ig'] {
		color: var(--color-pink, #ec4899);
	}
	.media-glyph[data-platform='fb'] {
		color: var(--color-info, #3b82f6);
	}
	.carousel {
		display: flex;
		gap: 0.5rem;
		overflow-x: auto;
		scroll-snap-type: x mandatory;
		width: 100%;
		padding: 0.5rem;
	}
	.carousel-item {
		scroll-snap-align: center;
		flex: 0 0 auto;
		max-height: 520px;
		max-width: 90%;
		border-radius: var(--radius-md);
		object-fit: contain;
	}

	.doc-sec {
		border-top: 1px solid var(--hairline);
		padding: 1rem 1.5rem;
	}
	.meta-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
	}
	.panel-h {
		font-size: 0.78rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-muted-foreground);
		margin-bottom: 0.6rem;
	}
	.caption-full {
		white-space: pre-wrap;
		font-size: 0.9rem;
		line-height: 1.5;
		color: var(--color-foreground);
	}

	.post-platform,
	.post-type {
		font-size: 0.7rem;
		padding: 0.15rem 0.5rem;
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
	.post-type.ad {
		background: color-mix(in srgb, var(--color-accent) 18%, transparent);
		color: var(--color-accent);
	}
	.promoted-chip,
	.perma-link {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.8rem;
		color: var(--color-accent);
	}
	.promoted-chip:hover,
	.perma-link:hover {
		text-decoration: underline;
	}
	.perma-link {
		margin-left: auto;
		color: var(--color-muted-foreground);
	}

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
		gap: 0.75rem 1.25rem;
	}
	.stat {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.stat-v {
		font-size: 1.25rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--color-foreground);
	}
	.stat-l {
		font-size: 0.72rem;
		color: var(--color-muted-foreground);
	}
</style>
