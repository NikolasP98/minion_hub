<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	interface Day {
		date: string;
		bookedMin: number;
		availableMin: number;
	}
	interface Util {
		resourceId: string;
		name: string;
		color: string | null;
		bookedMin: number;
		availableMin: number;
		utilization: number;
		bookingCount: number;
		days: Day[];
	}
	let { utilization }: { utilization: Util[] } = $props();

	const hrs = (min: number) => (min / 60).toFixed(1);

	/** 0..1 → background colour using the accent, gray when no availability. */
	function cell(d: Day): string {
		if (d.availableMin <= 0) return 'background:var(--hairline);opacity:0.4';
		const r = Math.min(1, d.bookedMin / d.availableMin);
		// Low ratio → faint, high → strong accent.
		return `background:var(--accent);opacity:${(0.12 + r * 0.85).toFixed(2)}`;
	}
	const pct = (u: number) => Math.round(u * 100);
	const dayLabel = (date: string) => date.slice(5); // MM-DD
</script>

<div class="util">
	{#each utilization as r (r.resourceId)}
		<div class="util-row">
			<div class="util-meta">
				<span class="util-name" title={r.name}>{r.name}</span>
				<span class="t-caption">{hrs(r.bookedMin)} / {hrs(r.availableMin)} h · {pct(r.utilization)}%</span>
			</div>
			<div class="util-strip">
				{#each r.days as d (d.date)}
					<span
						class="util-cell"
						style={cell(d)}
						title="{dayLabel(d.date)} — {hrs(d.bookedMin)}/{hrs(d.availableMin)} h"
					></span>
				{/each}
			</div>
		</div>
	{/each}
</div>

<style>
	.util {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.util-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.util-meta {
		width: 180px;
		min-width: 180px;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		overflow: hidden;
	}
	.util-name {
		font-size: 0.85rem;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.util-strip {
		flex: 1;
		display: flex;
		gap: 2px;
		height: 22px;
	}
	.util-cell {
		flex: 1;
		border-radius: 3px;
		min-width: 4px;
	}
</style>
