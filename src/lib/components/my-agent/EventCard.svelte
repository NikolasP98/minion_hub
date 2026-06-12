<script lang="ts">
	import { Repeat, Check, X, HelpCircle, MapPin } from 'lucide-svelte';
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

	// Proximity tier drives the accent rail colour.
	type Tier = 'now' | 'soon' | 'today' | 'upcoming' | 'past';
	const tier = $derived.by<Tier>(() => {
		if (!validStart) return 'upcoming';
		if (inProgress) return 'now';
		if (!item.isAllDay && minutesUntil >= 0 && minutesUntil <= 30) return 'soon';
		if (end.getTime() <= nowMs) return 'past';
		if (isToday) return 'today';
		return 'upcoming';
	});

	const dayLabel = $derived.by(() => {
		if (!validStart) return '';
		if (isToday) return 'Today';
		return start.toLocaleDateString([], { weekday: 'short' });
	});

	const timeLabel = $derived.by(() => {
		if (!validStart) return '—';
		if (item.isAllDay) return 'All day';
		return start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
	});

	// Secondary line: end time range (timed) or the calendar date (all-day, non-today).
	const rangeLabel = $derived.by(() => {
		if (!validStart) return '';
		if (item.isAllDay) {
			return isToday ? '' : start.toLocaleDateString([], { month: 'short', day: 'numeric' });
		}
		const endValid = !Number.isNaN(end.getTime());
		const endTime = endValid
			? end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
			: '';
		return endTime ? `– ${endTime}` : '';
	});

	// "starting soon" / "in progress" pill text.
	const statusPill = $derived.by(() => {
		if (inProgress) return 'Now';
		if (tier === 'soon') return minutesUntil <= 1 ? 'Starting now' : `in ${minutesUntil} min`;
		return '';
	});

	const title = $derived(item.title?.trim() || '(untitled event)');

	const rsvp = $derived(item.responseStatus ?? null);
	const rsvpMeta = $derived.by(() => {
		switch (rsvp) {
			case 'accepted':
				return { icon: Check, cls: 'rsvp-yes', label: 'Going' };
			case 'declined':
				return { icon: X, cls: 'rsvp-no', label: 'Declined' };
			case 'tentative':
				return { icon: HelpCircle, cls: 'rsvp-maybe', label: 'Maybe' };
			default:
				return null;
		}
	});

	function dragStart(e: DragEvent) {
		const parts = [`Event: "${title}"`, `When: ${dayLabel} ${timeLabel}${rangeLabel ? ' ' + rangeLabel : ''}`];
		if (item.location) parts.push(`Location: ${item.location}`);
		if (item.recurring) parts.push('Recurring event');
		if (rsvpMeta) parts.push(`RSVP: ${rsvpMeta.label}`);
		if (item.htmlLink) parts.push(`Link: ${item.htmlLink}`);
		const ctx: DragContext = {
			kind: 'event',
			label: title,
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
	class="event-card tier-{tier}"
	role="button"
	tabindex="0"
	draggable="true"
	onclick={onopen}
	onkeydown={handleKey}
	ondragstart={dragStart}
	title={title}
>
	<span class="rail" aria-hidden="true"></span>

	<div class="when" aria-hidden="true">
		<span class="day">{dayLabel}</span>
		<span class="time" class:allday={item.isAllDay}>{timeLabel}</span>
		{#if rangeLabel}<span class="range">{rangeLabel}</span>{/if}
	</div>

	<div class="text">
		<div class="title-row">
			<span class="title">{title}</span>
			{#if item.recurring}
				<Repeat size={12} class="marker recur" aria-label="Recurring event" />
			{/if}
			{#if rsvpMeta}
				{@const Icon = rsvpMeta.icon}
				<span class="marker {rsvpMeta.cls}" title={`RSVP: ${rsvpMeta.label}`}>
					<Icon size={12} />
				</span>
			{/if}
		</div>
		<div class="sub">
			{#if statusPill}
				<span class="pill">{statusPill}</span>
			{/if}
			{#if item.location}
				<span class="loc"><MapPin size={11} />{item.location}</span>
			{/if}
		</div>
	</div>
</div>

<style>
	.event-card {
		display: flex;
		align-items: stretch;
		gap: 12px;
		min-height: 54px;
		padding: 8px 12px 8px 0;
		border-radius: 8px;
		border: 1px solid transparent;
		cursor: pointer;
		transition: background 120ms ease, border-color 120ms ease;
	}
	.event-card:hover,
	.event-card:focus-visible {
		background: color-mix(in srgb, var(--color-foreground) 2.5%, transparent);
		border-color: color-mix(in srgb, var(--color-foreground) 6%, transparent);
		outline: none;
	}

	/* Accent rail — colour encodes proximity. */
	.rail {
		width: 3px;
		flex-shrink: 0;
		border-radius: 0 3px 3px 0;
		background: var(--rail, color-mix(in srgb, var(--color-foreground) 18%, transparent));
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
		--rail: color-mix(in srgb, var(--color-accent) 45%, transparent);
	}
	.tier-past {
		--rail: color-mix(in srgb, var(--color-foreground) 14%, transparent);
	}
	.tier-past .when,
	.tier-past .title {
		opacity: 0.55;
	}

	/* Time indicator block. */
	.when {
		flex-shrink: 0;
		width: 58px;
		display: flex;
		flex-direction: column;
		justify-content: center;
		text-align: right;
		padding-left: 8px;
		line-height: 1.15;
	}
	.when .day {
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--color-foreground) 45%, transparent);
	}
	.when .time {
		font-size: 14px;
		font-weight: 600;
		color: color-mix(in srgb, var(--color-foreground) 90%, transparent);
		font-variant-numeric: tabular-nums;
	}
	.when .time.allday {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: color-mix(in srgb, var(--color-accent) 80%, transparent);
	}
	.when .range {
		font-size: 10px;
		color: color-mix(in srgb, var(--color-foreground) 38%, transparent);
		font-variant-numeric: tabular-nums;
	}
	.tier-now .when .time,
	.tier-soon .when .time {
		color: var(--rail);
	}

	.text {
		min-width: 0;
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 2px;
	}
	.title-row {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.title {
		font-size: 14px;
		color: color-mix(in srgb, var(--color-foreground) 92%, transparent);
		line-height: 1.35;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.marker {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
	}
	.marker.recur :global(svg) {
		color: color-mix(in srgb, var(--color-foreground) 42%, transparent);
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

	.sub {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.pill {
		flex-shrink: 0;
		font-size: 10px;
		font-weight: 600;
		padding: 1px 7px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--rail) 20%, transparent);
		color: var(--rail);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.loc {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 12px;
		color: color-mix(in srgb, var(--color-foreground) 48%, transparent);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.loc :global(svg) {
		flex-shrink: 0;
		opacity: 0.7;
	}
</style>
