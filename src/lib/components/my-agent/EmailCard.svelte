<script lang="ts">
	import * as m from '$lib/paraglide/messages';
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
	// Status tier drives the card's whole treatment: a brand-new arrival reads
	// loud (green), an unread-but-seen message reads normal, an opened one recedes.
	const opened = $derived(!unread);

	const received = $derived(item.receivedAt ? new Date(item.receivedAt) : null);
	const relative = $derived.by(() => {
		if (!received || Number.isNaN(received.getTime())) return '';
		const diffMs = nowMs - received.getTime();
		const mins = Math.round(diffMs / 60000);
		if (mins < 1) return m.email_justNow();
		if (mins < 60) return m.email_minsAgo({mins});
		const hours = Math.round(mins / 60);
		if (hours < 24) return m.email_hoursAgo({hours});
		const days = Math.round(hours / 24);
		if (days < 7) return m.email_daysAgo({days});
		return received.toLocaleDateString([], { month: 'short', day: 'numeric' });
	});

	const sender = $derived(item.fromName?.trim() || item.from?.trim() || m.email_unknownSender());
	const subject = $derived(item.subject?.trim() || m.email_noSubject());
	const snippet = $derived(item.snippet?.trim() || '');

	// Surfaced from a subscribed shared inbox rather than the user's own account.
	const sharedTitle = $derived(
		item.shared
			? item.sharedOwnerName
				? m.shared_feedBadgeFrom({ owner: item.sharedOwnerName })
				: m.shared_feedBadgeFromGeneric()
			: '',
	);

	function dragStart(e: DragEvent) {
		const parts = [
			m.email_dragFrom({sender}),
			m.email_dragSubject({subject}),
		];
		if (relative) parts.push(m.email_dragReceived({relative}));
		if (snippet) parts.push(m.email_dragPreview({snippet}));
		if (item.htmlLink) parts.push(m.email_dragLink({link: item.htmlLink}));
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
	class:opened
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
		{#if isNew}<span class="dot" aria-label={m.email_newIndicator()}></span>{/if}
	</div>

	<div class="text">
		<div class="top">
			<span class="sender">{sender}</span>
			{#if item.shared}<span class="shared-badge" title={sharedTitle}>{m.shared_feedBadge()}</span
				>{/if}
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
	.email-card.opened {
		opacity: 0.78;
	}
	.email-card.opened:hover,
	.email-card.opened:focus-visible {
		opacity: 1;
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
	/* New arrival — green, loud. Overrides the unread accent. */
	.email-card.is-new .icon {
		color: #4ade80;
	}
	/* Opened — recede the envelope further. */
	.email-card.opened .icon {
		color: color-mix(in srgb, var(--color-foreground) 28%, transparent);
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
	.email-card.is-new .sender {
		color: color-mix(in srgb, #4ade80 85%, var(--color-foreground));
		font-weight: 700;
	}
	.email-card.opened .sender {
		font-weight: 500;
		color: color-mix(in srgb, var(--color-foreground) 58%, transparent);
	}
	.shared-badge {
		flex-shrink: 0;
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		padding: 1px 5px;
		border-radius: 5px;
		color: color-mix(in srgb, var(--color-accent) 90%, var(--color-foreground));
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
		white-space: nowrap;
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
	.email-card.opened .subject {
		color: color-mix(in srgb, var(--color-foreground) 48%, transparent);
		font-weight: 400;
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
