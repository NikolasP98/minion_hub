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
	}

	.text {
		font-size: 16px;
		line-height: 1.5;
		color: rgba(255, 255, 255, 0.85);
		margin: 0;
	}
</style>
