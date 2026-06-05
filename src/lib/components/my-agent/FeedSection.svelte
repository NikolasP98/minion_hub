<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		label: string;
		count: number;
		children: Snippet;
	}

	const { label, count, children }: Props = $props();
</script>

<section class="feed-section">
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

	.count {
		color: color-mix(in srgb, var(--color-foreground) 35%, transparent);
	}

	.items {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
</style>
