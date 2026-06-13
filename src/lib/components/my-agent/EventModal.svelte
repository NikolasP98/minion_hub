<script lang="ts">
	import Modal from '$lib/components/ui/Modal.svelte';
	import {
		Calendar,
		Clock,
		MapPin,
		Repeat,
		ExternalLink,
		Check,
		HelpCircle,
		X,
		Pencil,
		Trash2,
		Sparkles,
	} from 'lucide-svelte';
	import type { CalendarItem } from '$lib/services/my-agent-rpc';

	interface Props {
		item: CalendarItem | null;
		open?: boolean;
		onclose?: () => void;
		/**
		 * Hand a well-formed request to the agent (which holds gws calendar tools).
		 * Used for RSVP / edit / cancel until one-click gateway RPCs land (Phase 2).
		 */
		onask?: (prompt: string) => void;
	}

	let { item, open = $bindable(false), onclose, onask }: Props = $props();

	const title = $derived(item?.title?.trim() || '(untitled event)');

	const start = $derived(item ? new Date(item.startsAt) : null);
	const end = $derived(item ? new Date(item.endsAt) : null);

	const whenLabel = $derived.by(() => {
		if (!start || Number.isNaN(start.getTime())) return '';
		const dateStr = start.toLocaleDateString([], {
			weekday: 'long',
			month: 'long',
			day: 'numeric',
		});
		if (item?.isAllDay) return `${dateStr} · All day`;
		const startTime = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
		const endTime =
			end && !Number.isNaN(end.getTime())
				? end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
				: '';
		return endTime ? `${dateStr} · ${startTime} – ${endTime}` : `${dateStr} · ${startTime}`;
	});

	const rsvp = $derived(item?.responseStatus ?? null);
	const rsvpLabel = $derived.by(() => {
		switch (rsvp) {
			case 'accepted':
				return 'You replied: Going';
			case 'declined':
				return 'You replied: Declined';
			case 'tentative':
				return 'You replied: Maybe';
			case 'needsAction':
				return 'Awaiting your RSVP';
			default:
				return null;
		}
	});

	function ask(prompt: string) {
		onask?.(prompt);
		open = false;
		onclose?.();
	}

	function openInGoogle() {
		if (item?.htmlLink) window.open(item.htmlLink, '_blank', 'noopener');
	}
</script>

<Modal bind:open size="md" {onclose}>
	{#snippet header()}
		<div class="hdr">
			<h2 class="hdr-title" title={title}>{title}</h2>
			{#if item?.htmlLink}
				<button
					type="button"
					class="hdr-open"
					onclick={openInGoogle}
					title="Open in Google Calendar"
					aria-label="Open in Google Calendar"
				>
					<ExternalLink size={14} />
				</button>
			{/if}
		</div>
	{/snippet}

	{#if item}
		<div class="body">
			<div class="row">
				<Calendar size={15} class="ic" />
				<span class="val">{whenLabel}</span>
			</div>

			{#if item.recurring}
				<div class="row">
					<Repeat size={15} class="ic" />
					<span class="val muted">Repeating event</span>
				</div>
			{/if}

			{#if item.location}
				<div class="row">
					<MapPin size={15} class="ic" />
					<span class="val">{item.location}</span>
				</div>
			{/if}

			<div class="row">
				<Clock size={15} class="ic" />
				<span class="val muted">{item.sourceEmail}</span>
			</div>

			{#if rsvpLabel}
				<div class="rsvp-state">{rsvpLabel}</div>
			{/if}

			<!-- RSVP — handed to the agent (gws attendee-patch) until a direct RPC lands. -->
			<div class="section">
				<span class="section-label">RSVP</span>
				<div class="btn-row">
					<button
						type="button"
						class="chip yes"
						class:active={rsvp === 'accepted'}
						onclick={() => ask(`RSVP "Yes / Going" to my calendar event "${title}" (${whenLabel}).`)}
					>
						<Check size={14} /> Going
					</button>
					<button
						type="button"
						class="chip maybe"
						class:active={rsvp === 'tentative'}
						onclick={() => ask(`RSVP "Maybe / Tentative" to my calendar event "${title}" (${whenLabel}).`)}
					>
						<HelpCircle size={14} /> Maybe
					</button>
					<button
						type="button"
						class="chip no"
						class:active={rsvp === 'declined'}
						onclick={() => ask(`RSVP "No / Decline" to my calendar event "${title}" (${whenLabel}).`)}
					>
						<X size={14} /> Decline
					</button>
				</div>
			</div>
		</div>
	{/if}

	{#snippet footer()}
		<div class="footer-actions">
			<button
				type="button"
				class="icon-act"
				onclick={() => ask(`Edit my calendar event "${title}" (${whenLabel}). Ask me what to change.`)}
				title="Edit event"
				aria-label="Edit event"
			>
				<Pencil size={16} />
			</button>
			<button
				type="button"
				class="icon-act danger"
				onclick={() => ask(`Cancel my calendar event "${title}" (${whenLabel}). Confirm with me first.`)}
				title="Cancel event"
				aria-label="Cancel event"
			>
				<Trash2 size={16} />
			</button>
		</div>
		<button
			type="button"
			class="act primary"
			onclick={() => ask(`Tell me about my event "${title}" (${whenLabel}) and what I should prepare.`)}
		>
			<Sparkles size={14} /> Ask agent
		</button>
	{/snippet}
</Modal>

<style>
	/* Header (corner Open icon) */
	.hdr {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.hdr-title {
		flex: 1;
		min-width: 0;
		font-size: 15px;
		font-weight: 650;
		color: var(--color-foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hdr-open {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: var(--radius-md, 6px);
		border: none;
		background: transparent;
		color: var(--color-muted-foreground);
		cursor: pointer;
		opacity: 0.55;
		transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
	}
	.hdr-open:hover {
		opacity: 1;
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 14px;
		color: var(--color-foreground);
	}
	.row :global(.ic) {
		flex-shrink: 0;
		color: var(--color-muted-foreground);
	}
	.val.muted,
	.muted {
		color: var(--color-muted);
	}
	.rsvp-state {
		font-size: 12px;
		color: var(--color-muted);
		padding: 2px 0;
	}
	.section {
		margin-top: 4px;
		display: flex;
		flex-direction: column;
		gap: 7px;
	}
	.section-label {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-muted-foreground);
	}
	.btn-row {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 13px;
		padding: 5px 11px;
		border-radius: 999px;
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-foreground);
		cursor: pointer;
		transition: background 120ms ease, border-color 120ms ease;
	}
	.chip:hover {
		background: color-mix(in srgb, var(--color-foreground) 5%, transparent);
	}
	.chip.yes.active {
		border-color: #4ade80;
		color: #4ade80;
		background: color-mix(in srgb, #4ade80 12%, transparent);
	}
	.chip.maybe.active {
		border-color: #fbbf24;
		color: #fbbf24;
		background: color-mix(in srgb, #fbbf24 12%, transparent);
	}
	.chip.no.active {
		border-color: #f87171;
		color: #f87171;
		background: color-mix(in srgb, #f87171 12%, transparent);
	}

	/* Icon footer cluster (left-aligned) */
	.footer-actions {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-right: auto;
	}
	.icon-act {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border-radius: var(--radius-md, 8px);
		border: 1px solid transparent;
		background: transparent;
		color: var(--color-muted-foreground);
		cursor: pointer;
		transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
	}
	.icon-act:hover {
		color: var(--color-foreground);
		background: color-mix(in srgb, var(--color-foreground) 7%, transparent);
		border-color: var(--color-border);
	}
	.icon-act.danger:hover {
		color: #f87171;
		background: color-mix(in srgb, #f87171 12%, transparent);
		border-color: color-mix(in srgb, #f87171 40%, transparent);
	}

	.act {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		padding: 7px 14px;
		border-radius: var(--theme-radius, 6px);
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-foreground);
		cursor: pointer;
		transition: background 120ms ease, border-color 120ms ease;
	}
	.act:hover {
		background: color-mix(in srgb, var(--color-foreground) 5%, transparent);
	}
	.act.primary {
		border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
		color: var(--color-accent);
	}
	.act.primary:hover {
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
	}
</style>
