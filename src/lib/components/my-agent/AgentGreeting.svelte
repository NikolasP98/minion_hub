<script lang="ts">
	interface Props {
		greeting: string;
		userName?: string | null;
	}

	const { greeting }: Props = $props();
</script>

<header class="greeting">
	<div class="avatar" aria-hidden="true"></div>
	<p class="text">{greeting}</p>
</header>

<style>
	.greeting {
		display: flex;
		align-items: flex-start;
		gap: 16px;
		padding: 32px 0 24px;
	}

	.avatar {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: rgba(232, 125, 106, 0.08);
		box-shadow: 0 0 0 1px #e87d6a;
		flex-shrink: 0;
		margin-top: 2px;
	}

	.text {
		font-size: 16px;
		line-height: 1.5;
		color: rgba(255, 255, 255, 0.85);
		margin: 0;
	}
</style>
