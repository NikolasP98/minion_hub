<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ChevronDown } from 'lucide-svelte';
	import { cubicOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import type { TransitionConfig } from 'svelte/transition';
	import ProviderIcon from './ProviderIcon.svelte';
	import type { ProviderKey } from './provider';

	interface Props {
		label: string;
		count: number;
		children: Snippet;
		/** Give the items their own bounded, independent scroll area (sticky header). */
		scrollable?: boolean;
		/** Render a chevron that collapses the body to its `summary` snippet. */
		collapsible?: boolean;
		/** Two-way collapse state (parent persists it). */
		collapsed?: boolean;
		/** Compact stand-in rendered in place of `children` while collapsed. */
		summary?: Snippet;
		/** Provider badges shown beside the count (linked account sources). */
		providers?: ProviderKey[];
	}

	let {
		label,
		count,
		children,
		scrollable = false,
		collapsible = false,
		collapsed = $bindable(false),
		summary,
		providers = [],
	}: Props = $props();

	const sectionId = `feed-sec-${Math.random().toString(36).slice(2, 8)}`;
	// Render the summary whenever collapsed + a summary exists — independent of
	// whether THIS section owns the visible chevron, so one toggle can fold a
	// sibling column that binds the same state.
	const isCollapsed = $derived(collapsed && !!summary);

	const SLIDE_MS = 240;

	// Collapse/expand the body by animating its *clamped* height. The built-in
	// `slide` uses the pane's full natural height (the long email list is ~1200px),
	// but the body clips at 28vh (~280px) — so a naive slide races to the clamp in a
	// fraction of the duration and the expand feels rigid/abrupt. Capping the target
	// at the same 28vh the body enforces means the visible motion uses the WHOLE
	// duration in both directions, so open and close read symmetrically smooth.
	function clampSlide(node: Element, { duration = SLIDE_MS } = {}): TransitionConfig {
		const maxH = typeof window !== 'undefined' ? window.innerHeight * 0.28 : 280;
		const natural = (node as HTMLElement).scrollHeight || (node as HTMLElement).offsetHeight;
		const target = Math.min(natural, maxH);
		return {
			duration,
			easing: cubicOut,
			css: (t) => `height:${t * target}px; overflow:hidden;`,
		};
	}
	// Honour the OS reduced-motion setting by zeroing the duration.
	const slideParams = $derived(prefersReducedMotion.current ? { duration: 0 } : {});
</script>

<section class="feed-section" class:scrollable={scrollable} class:collapsed={isCollapsed}>
	<div class="header">
		{#if collapsible}
			<button
				type="button"
				class="toggle"
				class:open={!collapsed}
				aria-expanded={!collapsed}
				aria-controls={sectionId}
				onclick={() => (collapsed = !collapsed)}
				title={collapsed ? `Expand ${label}` : `Collapse ${label}`}
			>
				<ChevronDown size={14} />
			</button>
		{/if}
		<h2 class="heading">
			<span class="label">{label}</span>
			<span class="count">· {count}</span>
		</h2>
		{#if providers.length > 0}
			<span class="providers" aria-hidden="true">
				{#each providers as p (p)}
					<ProviderIcon provider={p} size={12} />
				{/each}
			</span>
		{/if}
	</div>
	<div class="body" id={sectionId}>
		{#if isCollapsed && summary}
			<div class="pane" transition:clampSlide={slideParams}>
				{@render summary()}
			</div>
		{:else}
			<div class="pane" transition:clampSlide={slideParams}>
				<div class="items">
					{@render children()}
				</div>
			</div>
		{/if}
	</div>
</section>

<style>
	.feed-section {
		margin-bottom: 24px;
	}

	/* Collapsed: the summary is short — drop the trailing margin so the shared
	   toggle handle sits right under the preview cards (no dead space). */
	.feed-section.collapsed {
		margin-bottom: 0;
	}

	/* Scrollable variant: header stays put, items get their own bounded scroll. */
	.feed-section.scrollable {
		display: flex;
		flex-direction: column;
		min-height: 0;
		margin-bottom: 0;
	}

	.header {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0 0 8px;
		padding: 0 4px;
	}

	.toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		margin-left: -2px;
		padding: 0;
		border: none;
		background: transparent;
		color: color-mix(in srgb, var(--color-foreground) 45%, transparent);
		cursor: pointer;
		border-radius: 5px;
		transition: color 120ms ease, background 120ms ease;
	}
	.toggle:hover {
		color: var(--color-foreground);
		background: color-mix(in srgb, var(--color-foreground) 7%, transparent);
	}
	.toggle :global(svg) {
		transition: transform 160ms ease;
		transform: rotate(-90deg);
	}
	.toggle.open :global(svg) {
		transform: rotate(0deg);
	}

	.heading {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--color-accent) 70%, transparent);
		margin: 0;
		display: flex;
		gap: 6px;
		align-items: baseline;
	}

	.feed-section.scrollable .header {
		position: sticky;
		top: 0;
		z-index: 1;
		flex-shrink: 0;
		padding-bottom: 6px;
		background: linear-gradient(var(--color-bg) 70%, transparent);
	}

	.count {
		color: color-mix(in srgb, var(--color-foreground) 35%, transparent);
	}

	.providers {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		margin-left: auto;
		opacity: 0.85;
	}

	.body {
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	/* Wrapper the slide transition animates (height/opacity) on toggle. min-width:0
	   keeps the truncating card titles from forcing the column wide mid-animation. */
	.pane {
		min-width: 0;
	}

	.items {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	/* The 28vh clamp is present in BOTH states (expanded + collapsed). Keeping it
	   while collapsed is what bounds the slide transition: the outgoing full-list
	   pane can never balloon past 28vh, so the body height changes monotonically
	   between 28vh and the summary height — no overshoot that thrashes the chat
	   section below. */
	.feed-section.scrollable .body {
		min-height: 0;
		max-height: 28vh;
		overflow: hidden;
	}

	/* Expanded: the items scroll, with a faded bottom edge hinting more content. */
	.feed-section.scrollable:not(.collapsed) .body {
		overflow-y: auto;
		scrollbar-width: thin;
		padding-right: 4px;
		-webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 14px), transparent);
		mask-image: linear-gradient(to bottom, #000 calc(100% - 14px), transparent);
	}
</style>
