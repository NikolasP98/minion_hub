<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ChevronDown } from 'lucide-svelte';
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
</script>

<section class="feed-section" class:scrollable={scrollable && !isCollapsed} class:collapsed={isCollapsed}>
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
			{@render summary()}
		{:else}
			<div class="items">
				{@render children()}
			</div>
		{/if}
	</div>
</section>

<style>
	.feed-section {
		margin-bottom: 24px;
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

	.items {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.feed-section.scrollable .body {
		min-height: 0;
		max-height: 28vh;
		overflow-y: auto;
		scrollbar-width: thin;
		padding-right: 4px;
		/* fade the bottom edge to hint more content */
		-webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 14px), transparent);
		mask-image: linear-gradient(to bottom, #000 calc(100% - 14px), transparent);
	}
</style>
