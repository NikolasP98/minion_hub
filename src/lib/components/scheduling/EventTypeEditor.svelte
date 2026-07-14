<script lang="ts">
	import { Button, Toggle } from '$lib/components/ui';
	import WeekHoursEditor from './WeekHoursEditor.svelte';
	import * as m from '$lib/paraglide/messages';

	interface EventType {
		id?: string;
		slug: string;
		title: string;
		description: string | null;
		length: number;
		slotInterval: number | null;
		beforeBuffer: number;
		afterBuffer: number;
		minimumBookingNotice: number;
		periodDays: number | null;
		schedulingType: string | null;
		useCustomSchedule: boolean;
		scheduleRules: Array<{ days: number[]; startTime: string; endTime: string }>;
		requiresConfirmation: boolean;
		public: boolean;
		productId: string | null;
		resourceIds: string[];
	}
	let {
		eventType = null,
		resources,
		products,
		onsaved,
		oncancel,
	}: {
		eventType?: EventType | null;
		resources: Array<{ id: string; name: string }>;
		products: Array<{ id: string; name: string }>;
		onsaved: () => void;
		oncancel: () => void;
	} = $props();

	const slugify = (s: string) =>
		s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

	// svelte-ignore state_referenced_locally
	let f = $state<EventType>(
		eventType
			? { ...eventType }
			: {
					slug: '',
					title: '',
					description: null,
					length: 30,
					slotInterval: null,
					beforeBuffer: 0,
					afterBuffer: 0,
					minimumBookingNotice: 120,
					periodDays: 30,
					schedulingType: null,
					useCustomSchedule: false,
					scheduleRules: [],
					requiresConfirmation: false,
					public: true,
					productId: null,
					resourceIds: [],
				},
	);
	// svelte-ignore state_referenced_locally
	let slugTouched = $state(!!eventType);
	let saving = $state(false);
	let err = $state<string | null>(null);

	// Per-service weekly schedule (only used when f.useCustomSchedule). 0=Sun…6=Sat.
	type DayState = { enabled: boolean; start: string; end: string };
	function buildWeek(rules: EventType['scheduleRules']): DayState[] {
		const week: DayState[] = Array.from({ length: 7 }, () => ({ enabled: false, start: '09:00', end: '17:00' }));
		for (const r of rules ?? []) for (const d of r.days) if (d >= 0 && d <= 6) week[d] = { enabled: true, start: r.startTime, end: r.endTime };
		return week;
	}
	const weekToRules = (w: DayState[]) =>
		w.map((d, i) => ({ d, i })).filter((x) => x.d.enabled).map((x) => ({ days: [x.i], startTime: x.d.start, endTime: x.d.end }));
	// svelte-ignore state_referenced_locally
	let week = $state<DayState[]>(buildWeek(f.scheduleRules));

	function onTitle(v: string) {
		f.title = v;
		if (!slugTouched) f.slug = slugify(v);
	}
	function toggleResource(id: string) {
		f.resourceIds = f.resourceIds.includes(id) ? f.resourceIds.filter((r) => r !== id) : [...f.resourceIds, id];
	}

	async function save() {
		if (!f.title.trim() || !f.slug.trim() || f.length <= 0) {
			err = 'title, slug, length required';
			return;
		}
		saving = true;
		err = null;
		// Sync the weekly editor into the payload (empty when not using a custom schedule).
		f.scheduleRules = f.useCustomSchedule ? weekToRules(week) : [];
		try {
			const url = eventType?.id ? `/api/scheduling/event-types/${eventType.id}` : '/api/scheduling/event-types';
			const res = await fetch(url, {
				method: eventType?.id ? 'PATCH' : 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(f),
			});
			if (!res.ok) throw new Error(await res.text());
			onsaved();
		} catch (e) {
			err = e instanceof Error ? e.message : 'error';
		} finally {
			saving = false;
		}
	}
</script>

<div class="editor">
	<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
		<label class="field">
			<span class="t-caption">{m.sched_et_title()}</span>
			<input class="txt" value={f.title} oninput={(e) => onTitle(e.currentTarget.value)} />
		</label>
		<label class="field">
			<span class="t-caption">{m.sched_et_slug()}</span>
			<input class="txt" bind:value={f.slug} oninput={() => (slugTouched = true)} />
		</label>
		<label class="field">
			<span class="t-caption">{m.sched_et_length()}</span>
			<input class="txt" type="number" bind:value={f.length} />
		</label>
		<label class="field">
			<span class="t-caption">{m.sched_et_interval()}</span>
			<input class="txt" type="number" bind:value={f.slotInterval} placeholder={String(f.length)} />
		</label>
		<label class="field">
			<span class="t-caption">{m.sched_et_bufferBefore()}</span>
			<input class="txt" type="number" bind:value={f.beforeBuffer} />
		</label>
		<label class="field">
			<span class="t-caption">{m.sched_et_bufferAfter()}</span>
			<input class="txt" type="number" bind:value={f.afterBuffer} />
		</label>
		<label class="field">
			<span class="t-caption">{m.sched_et_notice()}</span>
			<input class="txt" type="number" bind:value={f.minimumBookingNotice} />
		</label>
		<label class="field">
			<span class="t-caption">{m.sched_et_periodDays()}</span>
			<input class="txt" type="number" bind:value={f.periodDays} />
		</label>
		<label class="field">
			<span class="t-caption">{m.sched_et_schedulingType()}</span>
			<select class="txt" bind:value={f.schedulingType}>
				<option value={null}>{m.sched_et_single()}</option>
				<option value="round_robin">{m.sched_et_roundRobin()}</option>
				<option value="collective">{m.sched_et_collective()}</option>
			</select>
		</label>
		{#if products.length}
			<label class="field">
				<span class="t-caption">{m.sched_et_product()}</span>
				<select class="txt" bind:value={f.productId}>
					<option value={null}>{m.sched_none()}</option>
					{#each products as p (p.id)}
						<option value={p.id}>{p.name}</option>
					{/each}
				</select>
			</label>
		{/if}
	</div>

	<div class="mt-3">
		<span class="t-caption">{m.sched_et_resources()}</span>
		<div class="flex flex-wrap gap-2 mt-1">
			{#each resources as r (r.id)}
				<button
					type="button"
					class="chip {f.resourceIds.includes(r.id) ? 'chip-on' : ''}"
					onclick={() => toggleResource(r.id)}
				>
					{r.name}
				</button>
			{/each}
		</div>
	</div>

	<div class="flex items-center gap-4 mt-3">
		<label class="t-caption flex items-center gap-2">
			<Toggle bind:checked={f.public} size="sm" ariaLabel={m.sched_et_public()} /> {m.sched_et_public()}
		</label>
		<label class="t-caption flex items-center gap-2">
			<Toggle bind:checked={f.requiresConfirmation} size="sm" ariaLabel={m.sched_et_requiresConfirmation()} /> {m.sched_et_requiresConfirmation()}
		</label>
	</div>

	<!-- Per-service schedule -->
	<div class="mt-3 pt-3 border-t border-[var(--hairline)]">
		<label class="t-caption flex items-center gap-2">
			<Toggle bind:checked={f.useCustomSchedule} size="sm" ariaLabel={m.sched_et_customSchedule()} /> {m.sched_et_customSchedule()}
		</label>
		<p class="t-caption mt-1 opacity-70">{m.sched_et_customSchedule_help()}</p>
		{#if f.useCustomSchedule}
			<div class="mt-2"><WeekHoursEditor bind:week /></div>
		{/if}
	</div>

	{#if err}<p class="t-caption mt-2" style="color:var(--color-destructive)">{err}</p>{/if}

	<div class="flex gap-2 mt-3">
		<Button onclick={save} disabled={saving}>{m.sched_save()}</Button>
		<Button variant="ghost" onclick={oncancel}>{m.sched_cancel()}</Button>
	</div>
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.txt {
		border: 1px solid var(--hairline);
		border-radius: 8px;
		padding: 0.4rem 0.5rem;
		background: var(--color-card);
		font-size: 0.875rem;
		width: 100%;
	}
	.chip {
		border: 1px solid var(--hairline);
		border-radius: 999px;
		padding: 0.25rem 0.7rem;
		font-size: 0.8rem;
		background: var(--color-card);
	}
	.chip-on {
		background: var(--accent);
		color: var(--color-accent-foreground, #fff);
		border-color: var(--accent);
	}
</style>
