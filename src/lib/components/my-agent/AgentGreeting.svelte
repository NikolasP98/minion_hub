<script lang="ts">
	interface Props {
		greeting: string;
		userName?: string | null;
	}

	const { greeting }: Props = $props();
</script>

<header class="greeting">
	<p class="text">{greeting}</p>
</header>

<style>
	.greeting {
		display: flex;
		align-items: center;
		min-width: 0;
	}

	.text {
		font-size: 16px;
		line-height: 1.4;
		font-weight: 500;
		letter-spacing: -0.01em;
		color: var(--color-foreground);
		margin: 0;
		/* Keep the greeting readable when the column narrows: wrap to at most two
		   lines and ellipsize rather than smooshing into a tall column. */
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		text-wrap: balance;
	}
</style>
