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
		/**
		 * True once the user has opened this email IN THE HUB. This is a hub-only
		 * open state (persisted in localStorage by the parent), deliberately
		 * separate from Gmail's read/unread — opening here never touches Gmail.
		 */
		opened?: boolean;
	}

	const { item, onopen, nowMs, isNew = false, opened = false }: Props = $props();

	// Three hub-only states drive the whole treatment:
	//   opened   → gray, open envelope (the user has read it here)
	//   new      → green + dot, closed envelope (arrived since last visit, unopened)
	//   unopened → red, closed envelope (seen before, still not opened)
	// "new" only applies while still unopened.
	const status = $derived<'opened' | 'new' | 'unopened'>(
		opened ? 'opened' : isNew ? 'new' : 'unopened',
	);

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
	// User-applied Gmail labels (system labels already stripped server-side).
	const labels = $derived(item.labels ?? []);

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
	class="email-card status-{status}"
	role="button"
	tabindex="0"
	draggable="true"
	onclick={onopen}
	onkeydown={handleKey}
	ondragstart={dragStart}
	title={subject}
>
	<div class="icon" aria-hidden="true">
		{#if opened}
			<MailOpen size={17} />
		{:else}
			<Mail size={17} />
		{/if}
		{#if status === 'new'}<span class="dot" aria-label={m.email_newIndicator()}></span>{/if}
	</div>

	<div class="text">
		<div class="top">
			<span class="sender">{sender}</span>
			<div class="meta">
				{#each labels as label (label)}<span class="tag" title={label}>{label}</span>{/each}
				{#if relative}<span class="time">{relative}</span>{/if}
			</div>
		</div>
		<div class="subject-row">
			{#if item.shared}<span class="shared-badge" title={sharedTitle}>{m.shared_feedBadge()}</span
				>{/if}
			<span class="subject">{subject}</span>
		</div>
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
	/* Opened emails recede. */
	.email-card.status-opened {
		opacity: 0.72;
	}
	.email-card.status-opened:hover,
	.email-card.status-opened:focus-visible {
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
	/* New + unopened — green, loud, with the dot. */
	.email-card.status-new .icon {
		color: #4ade80;
	}
	/* Unopened (seen before) — red, closed envelope. */
	.email-card.status-unopened .icon {
		color: var(--color-destructive, #f87171);
	}
	/* Opened — gray, open envelope. */
	.email-card.status-opened .icon {
		color: color-mix(in srgb, var(--color-foreground) 30%, transparent);
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
	/* Unopened (new or seen) reads at full strength; new is a touch bolder. */
	.email-card.status-unopened .sender {
		color: color-mix(in srgb, var(--color-foreground) 92%, transparent);
	}
	.email-card.status-new .sender {
		color: color-mix(in srgb, var(--color-foreground) 96%, transparent);
		font-weight: 700;
	}
	.email-card.status-opened .sender {
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
	.meta {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.tag {
		flex-shrink: 0;
		max-width: 8.5rem;
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 0.02em;
		padding: 1px 6px;
		border-radius: 5px;
		color: color-mix(in srgb, var(--color-foreground) 62%, transparent);
		background: color-mix(in srgb, var(--color-foreground) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-foreground) 8%, transparent);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.time {
		flex-shrink: 0;
		font-size: 11px;
		color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
		font-variant-numeric: tabular-nums;
	}
	.email-card.status-new .time {
		color: color-mix(in srgb, #4ade80 80%, var(--color-foreground));
		font-weight: 600;
	}

	.subject-row {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.subject {
		font-size: 13px;
		color: color-mix(in srgb, var(--color-foreground) 60%, transparent);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.email-card.status-unopened .subject,
	.email-card.status-new .subject {
		color: color-mix(in srgb, var(--color-foreground) 82%, transparent);
		font-weight: 500;
	}
	.email-card.status-opened .subject {
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
