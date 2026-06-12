<script lang="ts">
	import { Mail, MailOpen } from 'lucide-svelte';
	import type { EmailItem } from '$lib/services/my-agent-rpc';
	import { setDragContext, type DragContext } from '$lib/utils/drag-context';

	interface Props {
		item: EmailItem;
		/** Open the email reader modal. */
		onopen?: () => void;
		/** Wall-clock ms, shared across the list so relative times re-render together. */
		nowMs: number;
		/**
		 * True when this email arrived after the user's last feed view — drives the
		 * subtle "new" accent. Computed by the parent against a localStorage marker.
		 */
		isNew?: boolean;
	}

	const { item, onopen, nowMs, isNew = false }: Props = $props();

	const unread = $derived(item.unread !== false);

	const received = $derived(item.receivedAt ? new Date(item.receivedAt) : null);
	const relative = $derived.by(() => {
		if (!received || Number.isNaN(received.getTime())) return '';
		const diffMs = nowMs - received.getTime();
		const mins = Math.round(diffMs / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.round(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.round(hours / 24);
		if (days < 7) return `${days}d ago`;
		return received.toLocaleDateString([], { month: 'short', day: 'numeric' });
	});

	const sender = $derived(item.fromName?.trim() || item.from?.trim() || 'Unknown sender');
	const subject = $derived(item.subject?.trim() || '(no subject)');
	const snippet = $derived(item.snippet?.trim() || '');

	function dragStart(e: DragEvent) {
		const parts = [
			`Email from ${sender}`,
			`Subject: ${subject}`,
		];
		if (relative) parts.push(`Received: ${relative}`);
		if (snippet) parts.push(`Preview: ${snippet}`);
		if (item.htmlLink) parts.push(`Link: ${item.htmlLink}`);
		const ctx: DragContext = {
			kind: 'email',
			label: subject,
			text: parts.join('\n'),
		};
		setDragContext(e, ctx);
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onopen?.();
		}
	}
</script>

<div
	class="email-card"
	class:unread
	class:is-new={isNew}
	role="button"
	tabindex="0"
	draggable="true"
	onclick={onopen}
	onkeydown={handleKey}
	ondragstart={dragStart}
	title={subject}
>
	<div class="icon" aria-hidden="true">
		{#if unread}
			<Mail size={17} />
		{:else}
			<MailOpen size={17} />
		{/if}
		{#if isNew}<span class="dot" aria-label="New since last view"></span>{/if}
	</div>

	<div class="text">
		<div class="top">
			<span class="sender">{sender}</span>
			{#if relative}<span class="time">{relative}</span>{/if}
		</div>
		<div class="subject">{subject}</div>
		{#if snippet}<div class="snippet">{snippet}</div>{/if}
	</div>
</div>

<style>
	.email-card {
		display: flex;
		align-items: flex-start;
		gap: 11px;
		min-height: 50px;
		padding: 8px 12px 8px 10px;
		border-radius: 8px;
		border: 1px solid transparent;
		cursor: pointer;
		transition:
			background 120ms ease,
			border-color 120ms ease;
	}
	.email-card:hover,
	.email-card:focus-visible {
		background: color-mix(in srgb, var(--color-foreground) 2.5%, transparent);
		border-color: color-mix(in srgb, var(--color-foreground) 6%, transparent);
		outline: none;
	}

	.icon {
		position: relative;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		padding-top: 2px;
		color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
	}
	.email-card.unread .icon {
		color: color-mix(in srgb, var(--color-accent) 85%, transparent);
	}
	.icon .dot {
		position: absolute;
		top: 0;
		right: 0;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #4ade80;
		box-shadow: 0 0 0 2px var(--color-bg, #000);
	}

	.text {
		min-width: 0;
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
		min-width: 0;
	}
	.sender {
		font-size: 13px;
		font-weight: 600;
		color: color-mix(in srgb, var(--color-foreground) 72%, transparent);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.email-card.unread .sender {
		color: color-mix(in srgb, var(--color-foreground) 92%, transparent);
	}
	.time {
		flex-shrink: 0;
		font-size: 11px;
		color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
		font-variant-numeric: tabular-nums;
	}
	.email-card.is-new .time {
		color: color-mix(in srgb, #4ade80 80%, var(--color-foreground));
		font-weight: 600;
	}

	.subject {
		font-size: 13px;
		color: color-mix(in srgb, var(--color-foreground) 60%, transparent);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.email-card.unread .subject {
		color: color-mix(in srgb, var(--color-foreground) 82%, transparent);
		font-weight: 500;
	}
	.snippet {
		font-size: 12px;
		color: color-mix(in srgb, var(--color-foreground) 42%, transparent);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
</style>
