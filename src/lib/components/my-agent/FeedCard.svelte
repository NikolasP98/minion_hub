<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { Reply, Clock, X } from 'lucide-svelte';

	interface Props {
		title: string;
		subtitle?: string;
		icon?: string;
		onreply?: () => void;
		onsnooze?: () => void;
		ondismiss?: () => void;
		onopen?: () => void;
	}

	const { title, subtitle, icon, onreply, onsnooze, ondismiss, onopen }: Props = $props();

	function handleKey(e: KeyboardEvent) {
		if (!onopen) return;
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onopen?.();
		}
	}
</script>

<div
	class="card"
	class:interactive={!!onopen}
	role={onopen ? 'button' : undefined}
	tabindex={onopen ? 0 : undefined}
	onclick={onopen}
	onkeydown={handleKey}
>
	<div class="body">
		{#if icon}
			<span class="icon" aria-hidden="true">{icon}</span>
		{/if}
		<div class="text">
			<div class="title">{title}</div>
			{#if subtitle}
				<div class="subtitle">{subtitle}</div>
			{/if}
		</div>
	</div>
	{#if onreply || onsnooze || ondismiss}
		<div class="actions" aria-label={m.feed_itemActions()}>
			{#if onreply}
				<button
					type="button"
					class="action"
					aria-label={m.feed_reply()}
					onclick={(e) => {
						e.stopPropagation();
						onreply?.();
					}}
				>
					<Reply size={14} />
				</button>
			{/if}
			{#if onsnooze}
				<button
					type="button"
					class="action"
					aria-label={m.feed_snooze24h()}
					onclick={(e) => {
						e.stopPropagation();
						onsnooze?.();
					}}
				>
					<Clock size={14} />
				</button>
			{/if}
			{#if ondismiss}
				<button
					type="button"
					class="action"
					aria-label={m.feed_dismiss()}
					onclick={(e) => {
						e.stopPropagation();
						ondismiss?.();
					}}
				>
					<X size={14} />
				</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 56px;
		padding: 12px 16px;
		border-radius: 8px;
		background: transparent;
		border: 1px solid transparent;
		transition: background 120ms ease, border-color 120ms ease;
	}

	.card.interactive {
		cursor: pointer;
	}

	.card.interactive:hover,
	.card.interactive:focus-visible {
		background: color-mix(in srgb, var(--color-foreground) 2.5%, transparent);
		border-color: color-mix(in srgb, var(--color-foreground) 6%, transparent);
		outline: none;
	}

	.body {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
		flex: 1;
	}

	.icon {
		font-size: 16px;
		opacity: 0.7;
	}

	.text {
		min-width: 0;
		flex: 1;
	}

	.title {
		font-size: 14px;
		color: color-mix(in srgb, var(--color-foreground) 92%, transparent);
		line-height: 1.4;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.subtitle {
		font-size: 12px;
		color: color-mix(in srgb, var(--color-foreground) 50%, transparent);
		margin-top: 2px;
	}

	.actions {
		display: flex;
		gap: 4px;
		opacity: 0;
		transition: opacity 120ms ease;
	}

	.card:hover .actions,
	.card:focus-within .actions {
		opacity: 1;
	}

	.action {
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 6px;
		background: transparent;
		border: none;
		color: color-mix(in srgb, var(--color-foreground) 50%, transparent);
		cursor: pointer;
		transition: background 100ms ease, color 100ms ease;
	}

	.action:hover {
		background: color-mix(in srgb, var(--color-foreground) 6%, transparent);
		color: color-mix(in srgb, var(--color-foreground) 92%, transparent);
	}

	.action:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 1px;
	}
</style>
