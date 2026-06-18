<script lang="ts">
	/**
	 * Compact 7-day (Mon–Sun) calendar strip for a single team member: shows their
	 * bookings for the week as chips, grouped by day. Read-only overview used on
	 * the scheduling Team page.
	 */
	interface StripBooking {
		id: string;
		start: string;
		end: string;
		status: string;
		attendeeName: string | null;
		title: string;
	}

	let {
		weekStart,
		bookings,
		color = 'var(--accent)',
	}: { weekStart: string; bookings: StripBooking[]; color?: string } = $props();

	const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

	const days = $derived.by(() => {
		const base = new Date(`${weekStart}T00:00:00`);
		const todayKey = new Date().toDateString();
		return Array.from({ length: 7 }, (_, i) => {
			const d = new Date(base);
			d.setDate(base.getDate() + i);
			const key = d.toDateString();
			const dayBookings = bookings
				.filter((b) => new Date(b.start).toDateString() === key)
				.sort((a, b) => a.start.localeCompare(b.start));
			return { label: DAY_LABELS[i], num: d.getDate(), isToday: key === todayKey, bookings: dayBookings };
		});
	});

	const hhmm = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
</script>

<div class="week">
	{#each days as day (day.num)}
		<div class="day" class:today={day.isToday}>
			<div class="dh">
				<span class="dl">{day.label}</span>
				<span class="dn">{day.num}</span>
			</div>
			<div class="db">
				{#each day.bookings as b (b.id)}
					<div class="chip {b.status}" style="--c:{color}" title="{hhmm(b.start)} · {b.title}{b.attendeeName ? ` · ${b.attendeeName}` : ''}">
						<span class="ct">{hhmm(b.start)}</span>
						<span class="cn truncate">{b.attendeeName ?? b.title}</span>
					</div>
				{:else}
					<span class="empty">·</span>
				{/each}
			</div>
		</div>
	{/each}
</div>

<style>
	.week {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 0.35rem;
	}
	.day {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
		border-radius: var(--radius-md, 8px);
		padding: 0.3rem;
		background: var(--bg2, var(--color-card));
		border: 1px solid var(--hairline);
	}
	.day.today {
		border-color: color-mix(in srgb, var(--accent) 55%, transparent);
		background: color-mix(in srgb, var(--accent) 8%, transparent);
	}
	.dh {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.25rem;
	}
	.dl {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-muted-foreground);
	}
	.dn {
		font-size: 0.8rem;
		font-weight: 600;
	}
	.db {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-height: 1.5rem;
	}
	.chip {
		display: flex;
		flex-direction: column;
		gap: 0.05rem;
		border-left: 2px solid var(--c);
		background: color-mix(in srgb, var(--c) 12%, transparent);
		border-radius: 4px;
		padding: 0.15rem 0.3rem;
		min-width: 0;
		overflow: hidden;
	}
	.chip.pending {
		opacity: 0.7;
		border-left-style: dashed;
	}
	.chip.completed {
		opacity: 0.55;
	}
	.ct {
		font-size: 0.62rem;
		color: var(--color-muted-foreground);
		font-variant-numeric: tabular-nums;
	}
	.cn {
		font-size: 0.7rem;
		line-height: 1.1;
	}
	.empty {
		color: var(--color-muted-foreground);
		opacity: 0.35;
		font-size: 0.85rem;
		text-align: center;
	}
</style>
