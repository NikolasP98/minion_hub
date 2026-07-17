<script lang="ts">
	import type { PageData } from './$types';
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { ArrowLeft, ExternalLink, Megaphone, MessageCircle, X } from 'lucide-svelte';
	import PlatformIcon from '$lib/components/socials/PlatformIcon.svelte';
	import { PageHeader, Button } from '$lib/components/ui';
	import { createBackNav } from '$lib/nav/back-nav.svelte';
	import { metricLabel } from '$lib/ads/metric-labels';
	import { relativeTime } from '$lib/components/crm/crm-format';

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

	// ── Comments panel (spec §5.4 — IG-style split) ─────────────────────────
	type Comment = { id: string; username: string; text: string; timestamp: string | null; likeCount: number; replies: Comment[] };
	let comments = $state<Comment[]>([]);
	let commentsAvailable = $state(true);
	let commentsLoaded = $state(false);
	let mobileCommentsOpen = $state(false);

	// Prefer the synced comments metric when present (both platforms' totals land
	// under one of these two keys — see metric-labels.ts); fall back to the
	// client-fetched count once the comments panel has loaded.
	const commentCount = $derived(Math.round(post.metrics.comments_total ?? post.metrics.comments ?? comments.length));

	onMount(async () => {
		try {
			const res = await fetch(`/api/meta/posts/${encodeURIComponent(post.postId)}`);
			if (res.ok) {
				const body = (await res.json()) as { items?: Media[] };
				if (Array.isArray(body.items) && body.items.length > 0) media = body.items;
			}
		} catch {
			// enrichment is best-effort — the mirrored preview (or glyph) stays put
		}

		try {
			const res = await fetch(`/api/meta/posts/${encodeURIComponent(post.postId)}/comments`);
			if (res.ok) {
				const body = (await res.json()) as { available?: boolean; comments?: Comment[] };
				commentsAvailable = body.available !== false;
				if (Array.isArray(body.comments)) comments = body.comments;
				// IG under instagram_business_basic answers 200 with an EMPTY list even when
				// the post has comments (content needs instagram_business_manage_comments).
				// An empty list on a post whose count metric is >0 is scope-gating, not
				// "no comments yet" — show the unavailable state instead of lying.
				if (comments.length === 0 && commentCount > 0) commentsAvailable = false;
			} else {
				commentsAvailable = false;
			}
		} catch {
			commentsAvailable = false;
		} finally {
			commentsLoaded = true;
		}
	});
</script>

{#snippet commentNode(c: Comment, isReply: boolean)}
	<div class="comment" class:reply={isReply}>
		<div class="comment-row">
			<span class="comment-user">{c.username || '—'}</span>
			<span class="comment-time">{relativeTime(c.timestamp)}</span>
		</div>
		{#if c.text}<p class="comment-text">{c.text}</p>{/if}
		{#if c.likeCount > 0}<span class="comment-likes">♥ {c.likeCount}</span>{/if}
		{#if c.replies.length > 0}
			<div class="comment-replies">
				{#each c.replies as r (r.id)}
					{@render commentNode(r, true)}
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

<svelte:head><title>{m.ads_post_detail_title()} · {m.nav_ads()}</title></svelte:head>

<!-- flex-1 min-w-0: page roots inside the SectionShell flex-row must fill it
     (bare h-full roots shrink to intrinsic width — governance layout contract). -->
<div class="social-post-page flex flex-col h-full min-h-0 flex-1 min-w-0">
	<PageHeader title={m.ads_post_detail_title()} subtitle={fmtDate(post.postedAt)}>
		{#snippet leading()}
			<PlatformIcon platform={post.platform} size={16} class="text-accent shrink-0" />
		{/snippet}
	</PageHeader>

	<div class="flex-1 min-h-0 lg:flex lg:gap-4 lg:p-4 lg:items-stretch">
		<!-- LEFT: media + badges + caption + stats — own scroll on lg so it never pushes the comments panel off-screen -->
		<div class="flex-1 min-w-0 min-h-0 overflow-auto p-4 lg:p-0 flex flex-col gap-4 max-w-3xl mx-auto lg:max-w-none lg:mx-0">
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
							<PlatformIcon platform={post.platform} size={40} />
						</div>
					{/if}
				</section>

				<!-- Badges + meta -->
				<section class="doc-sec meta-row">
					<span class="post-platform" data-platform={post.platform ?? ''}>{post.platform === 'ig' ? m.ads_platform_ig() : m.ads_platform_fb()}</span>
					<span class="post-type" class:ad={post.isPromoted}>{post.isPromoted ? m.ads_badge_boosted() : m.ads_badge_organic()}</span>
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

		<!-- RIGHT: comments panel — own scroll, IG-style split on lg / overlay on mobile -->
		<aside class="comments-panel" class:is-open={mobileCommentsOpen}>
			<header class="comments-head">
				<span>{m.ads_post_detail_comments_title({ count: commentCount })}</span>
				<Button variant="ghost" type="button" class="close-btn" onclick={() => (mobileCommentsOpen = false)} aria-label={m.common_close()}>
					<X size={16} />
				</Button>
			</header>
			<div class="comments-body">
				{#if commentsLoaded}
					{#if !commentsAvailable}
						<p class="comments-msg">{m.ads_post_detail_comments_unavailable()}</p>
					{:else if comments.length === 0}
						<p class="comments-msg">{m.ads_post_detail_comments_empty()}</p>
					{:else}
						{#each comments as c (c.id)}
							{@render commentNode(c, false)}
						{/each}
					{/if}
				{/if}
			</div>
		</aside>
	</div>

	<!-- Mobile toggle — comments panel becomes an overlay covering the content.
	     Hidden at lg+ via the scoped media rule below (a lg:hidden utility loses
	     the specificity fight against the scoped .comments-fab display rule). -->
	<Button variant="ghost" type="button" class="comments-fab" onclick={() => (mobileCommentsOpen = true)} aria-label={m.ads_post_detail_comments_open()}>
		<MessageCircle size={18} />
		{#if commentCount > 0}<span class="fab-count">{commentCount}</span>{/if}
	</Button>
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
		max-height: min(640px, 60vh);
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
		color: var(--color-pink);
	}
	.media-glyph[data-platform='fb'] {
		color: var(--color-info, var(--color-accent));
	}
	.carousel {
		display: flex;
		gap: var(--space-2);
		overflow-x: auto;
		scroll-snap-type: x mandatory;
		width: 100%;
		padding: var(--space-2);
	}
	.carousel-item {
		scroll-snap-align: center;
		flex: 0 0 auto;
		max-height: min(520px, 55vh);
		max-width: 90%;
		border-radius: var(--radius-md);
		object-fit: contain;
	}

	.doc-sec {
		border-top: 1px solid var(--hairline);
		padding: var(--space-4) var(--space-6);
	}
	.meta-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.panel-h {
		font-size: var(--font-size-body);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-muted-foreground);
		margin-bottom: var(--space-2);
	}
	.caption-full {
		white-space: pre-wrap;
		font-size: var(--font-size-page-title);
		line-height: 1.5;
		color: var(--color-foreground);
	}

	.post-platform,
	.post-type {
		font-size: var(--font-size-caption);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-full);
		background: color-mix(in srgb, var(--color-muted-foreground) 15%, transparent);
		color: var(--color-muted-foreground);
	}
	.post-platform[data-platform='ig'] {
		background: color-mix(in srgb, var(--color-pink) 15%, transparent);
		color: var(--color-pink);
	}
	.post-platform[data-platform='fb'] {
		background: color-mix(in srgb, var(--color-info, var(--color-accent)) 15%, transparent);
		color: var(--color-info, var(--color-accent));
	}
	.post-type.ad {
		background: color-mix(in srgb, var(--color-accent) 18%, transparent);
		color: var(--color-accent);
	}
	.promoted-chip,
	.perma-link {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--font-size-body);
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
		gap: var(--space-3) var(--space-6);
	}
	.stat {
		display: flex;
		flex-direction: column;
		gap: var(--space-0-5);
	}
	.stat-v {
		font-size: var(--font-size-page-title);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--color-foreground);
	}
	.stat-l {
		font-size: var(--font-size-caption);
		color: var(--color-muted-foreground);
	}

	/* ── Comments panel ──────────────────────────────────────────────────── */
	/* Mobile default: hidden until toggled, then a full-screen overlay with its
	   own scroll. At lg+: always visible as a static right-hand column (the
	   `.is-open` overlay chrome is dropped via the media query below). */
	.comments-panel {
		display: none;
		flex-direction: column;
		min-height: 0;
	}
	/* Overlay chrome is mobile-ONLY: at lg+ the panel is a static column, and
	   .is-open (2 classes) would otherwise outrank the lg reset (1 class) and
	   pin a 340px fixed drawer to the LEFT edge of the viewport. */
	@media (max-width: 1023.98px) {
		.comments-panel.is-open {
			display: flex;
			position: fixed;
			inset: 0;
			z-index: var(--layer-modal);
			background: var(--color-bg, var(--color-card));
		}
	}
	@media (min-width: 1024px) {
		.comments-panel {
			display: flex;
			position: static;
			inset: auto;
			z-index: auto;
			width: 340px;
			flex-shrink: 0;
			background: transparent;
			border-left: 1px solid var(--hairline);
		}
	}
	.comments-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--hairline);
		font-size: var(--font-size-body);
		font-weight: 600;
		color: var(--color-foreground);
	}
	.comments-panel :global(.close-btn) {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-muted-foreground);
		padding: var(--space-1);
	}
	@media (min-width: 1024px) {
		.comments-panel :global(.close-btn) {
			display: none;
		}
	}
	.comments-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: var(--space-3) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.comments-msg {
		color: var(--color-muted-foreground);
		font-size: var(--font-size-body);
		padding: var(--space-4) 0;
		text-align: center;
	}
	.comment {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.comment.reply {
		margin-left: var(--space-6);
		padding-left: var(--space-2);
		border-left: 2px solid var(--hairline);
	}
	.comment-row {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
	}
	.comment-user {
		font-weight: 600;
		font-size: var(--font-size-body);
		color: var(--color-foreground);
	}
	.comment-time {
		font-size: var(--font-size-caption);
		color: var(--color-muted-foreground);
	}
	.comment-text {
		white-space: pre-wrap;
		font-size: var(--font-size-body);
		line-height: 1.4;
		color: var(--color-foreground);
	}
	.comment-likes {
		font-size: var(--font-size-caption);
		color: var(--color-muted-foreground);
	}
	.comment-replies {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	/* Mobile floating toggle */
	.social-post-page :global(.comments-fab) {
		position: fixed;
		bottom: 1.25rem;
		right: 1.25rem;
		display: flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-full);
		background: var(--color-accent);
		color: var(--color-accent-foreground, var(--color-text-primary));
		box-shadow: var(--shadow-elevation-1);
		z-index: var(--layer-popover);
	}
	@media (min-width: 1024px) {
		.social-post-page :global(.comments-fab) {
			display: none;
		}
	}
	.fab-count {
		font-size: var(--font-size-caption);
		font-weight: 700;
	}
</style>
