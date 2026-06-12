<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		label: string;
		count: number;
		children: Snippet;
		/** Give the items their own bounded, independent scroll area (sticky header). */
		scrollable?: boolean;
	}

	const { label, count, children, scrollable = false }: Props = $props();
</script>

<section class="feed-section" class:scrollable>
	<h2 class="header">
		<span class="label">{label}</span>
		<span class="count">· {count}</span>
	</h2>
	<div class="items">
		{@render children()}
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
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--color-accent) 70%, transparent);
		margin: 0 0 8px;
		padding: 0 4px;
		display: flex;
		gap: 6px;
	}

	.feed-section.scrollable .header {
		position: sticky;
		top: 0;
		z-index: 1;
		flex-shrink: 0;
		padding-bottom: 6px;
		background: linear-gradient(
			var(--color-bg) 70%,
			transparent
		);
	}

	.count {
		color: color-mix(in srgb, var(--color-foreground) 35%, transparent);
	}

	.items {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.feed-section.scrollable .items {
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
