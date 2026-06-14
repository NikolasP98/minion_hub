<script lang="ts">
	import { Repeat, Check, X, HelpCircle, MapPin } from 'lucide-svelte';
	import * as m from '$lib/paraglide/messages';
	import type { CalendarItem } from '$lib/services/my-agent-rpc';
	import { setDragContext, type DragContext } from '$lib/utils/drag-context';

	interface Props {
		item: CalendarItem;
		/** Open the event modal. */
		onopen?: () => void;
		/** Wall-clock ms, passed in so the whole list shares one "now" + re-renders together. */
		nowMs: number;
	}

	const { item, onopen, nowMs }: Props = $props();

	const start = $derived(new Date(item.startsAt));
	const end = $derived(new Date(item.endsAt));
	const validStart = $derived(!Number.isNaN(start.getTime()));
	const validEnd = $derived(!Number.isNaN(end.getTime()));

	const isToday = $derived.by(() => {
		if (!validStart) return false;
		const now = new Date(nowMs);
		return (
			start.getFullYear() === now.getFullYear() &&
			start.getMonth() === now.getMonth() &&
			start.getDate() === now.getDate()
		);
	});

	// Minutes until the event starts (negative = already started/past).
	const minutesUntil = $derived(validStart ? Math.round((start.getTime() - nowMs) / 60000) : NaN);
	const inProgress = $derived(
		validStart && start.getTime() <= nowMs && end.getTime() > nowMs && !item.isAllDay,
	);

	// Proximity tier drives the accent rail colour + dot.
	type Tier = 'now' | 'soon' | 'today' | 'upcoming' | 'past';
	const tier = $derived.by<Tier>(() => {
		if (!validStart) return 'upcoming';
		if (inProgress) return 'now';
		if (!item.isAllDay && minutesUntil >= 0 && minutesUntil <= 30) return 'soon';
		if (end.getTime() <= nowMs) return 'past';
		if (isToday) return 'today';
		return 'upcoming';
	});

	function fmtTime(d: Date) {
		// "9:30" — strip the meridiem from the headline number; it rides on the end time.
		return d
			.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
			.replace(/\s?[AP]M$/i, '');
	}
	function meridiem(d: Date) {
		const m = d.toLocaleTimeString([], { hour: 'numeric', hour12: true }).match(/[AP]M$/i);
		return m ? m[0].toUpperCase() : '';
	}

	// Headline time element.
	const startTime = $derived(validStart && !item.isAllDay ? fmtTime(start) : '');
	const startMeridiem = $derived(validStart && !item.isAllDay ? meridiem(start) : '');
	const endTime = $derived(validEnd && !item.isAllDay ? `${fmtTime(end)} ${meridiem(end)}`.trim() : '');

	// "starting soon" / "in progress" pill text.
	const statusPill = $derived.by(() => {
		if (inProgress) return m.event_statusNow();
		if (tier === 'soon') return minutesUntil <= 1 ? m.event_statusStarting() : `${minutesUntil}m`;
		return '';
	});

	const title = $derived(item.title?.trim() || '(untitled event)');

	const rsvp = $derived(item.responseStatus ?? null);
	const rsvpMeta = $derived.by(() => {
		switch (rsvp) {
			case 'accepted':
				return { icon: Check, cls: 'rsvp-yes', label: m.event_rsvpGoing() };
			case 'declined':
				return { icon: X, cls: 'rsvp-no', label: m.event_rsvpDeclined() };
			case 'tentative':
				return { icon: HelpCircle, cls: 'rsvp-maybe', label: m.event_rsvpMaybe() };
			default:
				return null;
		}
	});

	function dragStart(e: DragEvent) {
		const when = item.isAllDay
			? m.event_allDay()
			: `${startTime} ${startMeridiem}${endTime ? ` – ${endTime}` : ''}`.trim();
		const parts = [`Event: "${title}"`, `When: ${when}`];
		if (item.location) parts.push(`Location: ${item.location}`);
		if (item.recurring) parts.push(m.event_recurringLabel());
		if (rsvpMeta) parts.push(`RSVP: ${rsvpMeta.label}`);
		if (item.htmlLink) parts.push(`Link: ${item.htmlLink}`);
		const ctx: DragContext = { kind: 'event', label: title, text: parts.join('\n') };
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
	class="event-card tier-{tier}"
	class:all-day={item.isAllDay}
	role="button"
	tabindex="0"
	draggable="true"
	onclick={onopen}
	onkeydown={handleKey}
	ondragstart={dragStart}
	title={title}
>
	<span class="rail" aria-hidden="true"></span>

	<div class="time" aria-hidden="true">
		{#if item.isAllDay}
			<span class="allday-badge">All day</span>
		{:else}
			<span class="start">
				<span class="num">{startTime}</span><span class="mer">{startMeridiem}</span>
			</span>
			{#if endTime}<span class="end">{endTime}</span>{/if}
		{/if}
	</div>

	<div class="text">
		<div class="title-row">
			<span class="title">{title}</span>
			{#if statusPill}<span class="pill">{statusPill}</span>{/if}
		</div>
		{#if item.location}
			<span class="loc"><MapPin size={11} />{item.location}</span>
		{/if}
	</div>

	<div class="markers" aria-hidden={!item.recurring && !rsvpMeta}>
		{#if item.recurring}
			<Repeat size={13} class="marker recur" aria-label={m.event_recurringLabel()} />
		{/if}
		{#if rsvpMeta}
			{@const Icon = rsvpMeta.icon}
			<span class="marker {rsvpMeta.cls}" title={`RSVP: ${rsvpMeta.label}`}>
				<Icon size={13} />
			</span>
		{/if}
	</div>
</div>

<style>
	.event-card {
		position: relative;
		display: flex;
		align-items: center;
		gap: 14px;
		min-height: 56px;
		padding: 10px 12px 10px 0;
		border-radius: 10px;
		border: 1px solid transparent;
		cursor: pointer;
		transition:
			background 140ms ease,
			border-color 140ms ease,
			transform 140ms ease;
	}
	.event-card:hover,
	.event-card:focus-visible {
		background: color-mix(in srgb, var(--color-foreground) 3.5%, transparent);
		border-color: color-mix(in srgb, var(--color-foreground) 7%, transparent);
		transform: translateX(1px);
		outline: none;
	}

	/* Accent rail — colour encodes proximity; rounded to read softer. */
	.rail {
		align-self: stretch;
		width: 3px;
		flex-shrink: 0;
		margin: 4px 0;
		border-radius: 0 4px 4px 0;
		background: var(--rail, color-mix(in srgb, var(--color-foreground) 16%, transparent));
	}
	.tier-now {
		--rail: #f87171;
	}
	.tier-soon {
		--rail: #fbbf24;
	}
	.tier-today {
		--rail: var(--color-accent);
	}
	.tier-upcoming {
		--rail: color-mix(in srgb, var(--color-accent) 40%, transparent);
	}
	.tier-past {
		--rail: color-mix(in srgb, var(--color-foreground) 12%, transparent);
	}
	.tier-now .rail {
		box-shadow: 0 0 8px -1px color-mix(in srgb, var(--rail) 70%, transparent);
	}
	.tier-past {
		opacity: 0.62;
	}

	/* Time block — left-aligned, roomy, never wraps. */
	.time {
		flex-shrink: 0;
		width: 60px;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1px;
		padding-left: 10px;
		line-height: 1.1;
	}
	.start {
		display: inline-flex;
		align-items: baseline;
		gap: 2px;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.start .num {
		font-size: 15px;
		font-weight: 650;
		color: color-mix(in srgb, var(--color-foreground) 92%, transparent);
	}
	.start .mer {
		font-size: 9.5px;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: color-mix(in srgb, var(--color-foreground) 48%, transparent);
	}
	.end {
		font-size: 11px;
		color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.allday-badge {
		font-size: 9.5px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: color-mix(in srgb, var(--color-accent) 78%, transparent);
		padding: 2px 6px;
		border-radius: 5px;
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		white-space: nowrap;
	}
	.tier-now .start .num,
	.tier-soon .start .num {
		color: var(--rail);
	}

	.text {
		min-width: 0;
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 3px;
	}
	.title-row {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.title {
		font-size: 13.5px;
		font-weight: 500;
		color: color-mix(in srgb, var(--color-foreground) 90%, transparent);
		line-height: 1.3;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.pill {
		flex-shrink: 0;
		font-size: 9.5px;
		font-weight: 700;
		padding: 2px 7px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--rail) 18%, transparent);
		color: var(--rail);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.loc {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 11.5px;
		color: color-mix(in srgb, var(--color-foreground) 46%, transparent);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.loc :global(svg) {
		flex-shrink: 0;
		opacity: 0.7;
	}

	.markers {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 7px;
		padding-right: 2px;
	}
	.marker {
		display: inline-flex;
		align-items: center;
	}
	.marker.recur :global(svg) {
		color: color-mix(in srgb, var(--color-foreground) 38%, transparent);
	}
	.rsvp-yes {
		color: #4ade80;
	}
	.rsvp-no {
		color: #f87171;
	}
	.rsvp-maybe {
		color: #fbbf24;
	}
</style>
