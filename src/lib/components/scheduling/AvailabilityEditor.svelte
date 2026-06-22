<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { Button } from '$lib/components/ui';
	import * as m from '$lib/paraglide/messages';

	interface Rule {
		days: number[];
		startTime: string;
		endTime: string;
		date: string | null;
	}
	interface Schedule {
		scheduleId: string;
		timezone: string;
		rules: Rule[];
	}
	let { resourceId, schedule }: { resourceId: string; schedule: Schedule | null } = $props();

	const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

	interface DayState {
		enabled: boolean;
		start: string;
		end: string;
	}

	// Build a weekly model (one row per weekday) from the recurring rules.
	function buildWeek(s: Schedule | null): DayState[] {
		const week: DayState[] = DAY_LABELS.map(() => ({ enabled: false, start: '09:00', end: '17:00' }));
		for (const r of s?.rules ?? []) {
			if (r.date != null) continue; // overrides not edited here (MVP)
			for (const d of r.days) {
				if (d >= 0 && d <= 6) week[d] = { enabled: true, start: r.startTime, end: r.endTime };
			}
		}
		return week;
	}

	// svelte-ignore state_referenced_locally
	let week = $state<DayState[]>(buildWeek(schedule));
	let saving = $state(false);
	let saved = $state(false);
	let err = $state<string | null>(null);

	// Dirty tracking — the Save button only appears once the week is edited.
	const serialize = (w: DayState[]) => JSON.stringify(w);
	// svelte-ignore state_referenced_locally
	let baseline = $state(serialize(week));
	const dirty = $derived(serialize(week) !== baseline);

	async function save() {
		saving = true;
		saved = false;
		err = null;
		const rules = week
			.map((d, i) => ({ enabled: d.enabled, day: i, start: d.start, end: d.end }))
			.filter((d) => d.enabled)
			.map((d) => ({ days: [d.day], startTime: d.start, endTime: d.end, date: null }));
		try {
			const res = await fetch(`/api/scheduling/resources/${resourceId}/availability`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ timezone: schedule?.timezone, rules }),
			});
			if (!res.ok) throw new Error(String(res.status));
			saved = true;
			baseline = serialize(week); // committed → clean again, hide Save
			await invalidate('scheduling:data');
		} catch (e) {
			err = e instanceof Error ? e.message : 'error';
		} finally {
			saving = false;
		}
	}
</script>

<div class="avail">
	<div class="t-label mb-2">{m.sched_availability_title()}</div>
	{#each week as d, i (i)}
		<div class="day-row">
			<label class="day-toggle">
				<input type="checkbox" bind:checked={d.enabled} />
				<span>{DAY_LABELS[i]}</span>
			</label>
			{#if d.enabled}
				<input type="time" bind:value={d.start} class="time-in" aria-label={m.sched_start()} />
				<span class="dash">–</span>
				<input type="time" bind:value={d.end} class="time-in" aria-label={m.sched_end()} />
			{:else}
				<span class="t-caption off">—</span>
			{/if}
		</div>
	{/each}
	{#if dirty || err}
		<div class="flex items-center gap-2 mt-2">
			{#if dirty}<Button size="sm" onclick={save} disabled={saving || !schedule}>{m.sched_save()}</Button>{/if}
			{#if err}<span class="t-caption" style="color:var(--color-destructive)">{err}</span>{/if}
		</div>
	{:else if saved}
		<div class="mt-2"><span class="t-caption text-accent">✓ {m.sched_rem_saved()}</span></div>
	{/if}
</div>

<style>
	.avail {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.day-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 28px;
	}
	.day-toggle {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		width: 64px;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.time-in {
		border: 1px solid var(--hairline);
		border-radius: 6px;
		padding: 0.15rem 0.4rem;
		background: var(--color-card);
		font-size: 0.8rem;
	}
	.dash {
		color: var(--color-muted-foreground);
	}
	.off {
		opacity: 0.5;
	}
</style>
