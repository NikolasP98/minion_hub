<script lang="ts">
	import type { PageData } from './$types';
	import { CalendarClock, Check, ArrowLeft, ArrowRight } from 'lucide-svelte';
	import * as m from '$lib/paraglide/messages';

	let { data }: { data: PageData } = $props();

	type Step = 'service' | 'time' | 'details' | 'done';
	// svelte-ignore state_referenced_locally
	let step = $state<Step>(data.eventTypes.length === 1 ? 'time' : 'service');
	// svelte-ignore state_referenced_locally
	let eventTypeId = $state(data.eventTypes.length === 1 ? data.eventTypes[0].id : '');
	let windowSlots = $state<Array<{ start: string; end: string }>>([]);
	let selectedDay = $state('');
	let showCustom = $state(false);
	let customDate = $state('');
	let slot = $state('');
	let loading = $state(false);
	let name = $state('');
	let email = $state('');
	let phone = $state('');
	let err = $state<string | null>(null);
	let doneStatus = $state<string>('accepted');

	const chosenService = $derived(data.eventTypes.find((e) => e.id === eventTypeId));

	// Group fetched slots by local day → drives the quick-day buttons and time grid.
	const byDay = $derived.by(() => {
		const map = new Map<string, Array<{ start: string; end: string }>>();
		for (const s of windowSlots) {
			const k = dayKey(s.start);
			(map.get(k) ?? map.set(k, []).get(k)!).push(s);
		}
		return map;
	});
	const availableDays = $derived([...byDay.keys()].sort());
	const quickDays = $derived(availableDays.slice(0, 5));
	const daySlots = $derived(byDay.get(selectedDay) ?? []);

	const steps = $derived(
		(data.eventTypes.length > 1
			? [
					{ k: 'service', label: m.sched_book_step_service() },
					{ k: 'time', label: m.sched_book_step_time() },
					{ k: 'details', label: m.sched_book_step_details() },
				]
			: [
					{ k: 'time', label: m.sched_book_step_time() },
					{ k: 'details', label: m.sched_book_step_details() },
				]) as Array<{ k: Step; label: string }>,
	);
	const currentIdx = $derived(steps.findIndex((s) => s.k === step));

	function dayKey(iso: string): string {
		const d = new Date(iso);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}
	function fmtDayShort(key: string): { weekday: string; day: string } {
		const d = new Date(`${key}T00:00:00`);
		return {
			weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
			day: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
		};
	}
	function hhmm(iso: string): string {
		return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	}
	function fmtDateTime(iso: string): string {
		return new Date(iso).toLocaleString(undefined, {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			hour: '2-digit',
			minute: '2-digit',
		});
	}

	function pickService(id: string) {
		eventTypeId = id;
		step = 'time';
		void loadWindow();
	}

	/** One fetch covering the next 30 days; days with slots become quick buttons. */
	async function loadWindow() {
		if (!eventTypeId) return;
		loading = true;
		err = null;
		slot = '';
		const from = new Date();
		const to = new Date(from.getTime() + 30 * 86_400_000);
		try {
			const res = await fetch(
				`/api/scheduling/public/${data.slug}/slots?eventTypeId=${eventTypeId}&from=${from.toISOString()}&to=${to.toISOString()}`,
			);
			windowSlots = res.ok ? ((await res.json()).slots ?? []) : [];
		} catch {
			windowSlots = [];
		} finally {
			loading = false;
		}
		if (!selectedDay && availableDays.length) selectedDay = availableDays[0];
	}

	/** Fetch a single custom day outside the window and merge it in. */
	async function loadCustomDay() {
		if (!customDate || !eventTypeId) return;
		slot = '';
		if (byDay.has(customDate)) {
			selectedDay = customDate;
			return;
		}
		loading = true;
		const from = new Date(`${customDate}T00:00:00`);
		const to = new Date(from.getTime() + 86_400_000);
		try {
			const res = await fetch(
				`/api/scheduling/public/${data.slug}/slots?eventTypeId=${eventTypeId}&from=${from.toISOString()}&to=${to.toISOString()}`,
			);
			const fresh: Array<{ start: string; end: string }> = res.ok ? ((await res.json()).slots ?? []) : [];
			const seen = new Set(windowSlots.map((s) => s.start));
			windowSlots = [...windowSlots, ...fresh.filter((s) => !seen.has(s.start))];
		} catch {
			/* keep existing */
		} finally {
			loading = false;
		}
		selectedDay = customDate;
	}

	async function confirm() {
		if (!slot || !name.trim()) {
			err = 'name and time required';
			return;
		}
		loading = true;
		err = null;
		try {
			const res = await fetch(`/api/scheduling/public/${data.slug}/book`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ eventTypeId, start: slot, name, email: email || null, phone: phone || null }),
			});
			if (res.status === 409) {
				err = m.sched_book_unavailable();
				step = 'time';
				await loadWindow();
				return;
			}
			if (!res.ok) throw new Error(String(res.status));
			const j = await res.json();
			doneStatus = j.status ?? 'accepted';
			step = 'done';
		} catch (e) {
			err = e instanceof Error ? e.message : 'error';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head><title>{data.title}</title></svelte:head>

<div class="wrap">
	<div class="head">
		<span class="head-icon"><CalendarClock size={22} /></span>
		<div>
			<h1 class="title">{data.title}</h1>
			{#if data.description}<p class="t-caption">{data.description}</p>{/if}
		</div>
	</div>

	{#if step !== 'done' && data.eventTypes.length > 0}
		<!-- Process stepper -->
		<ol class="stepper" aria-label="progress">
			{#each steps as s, i (s.k)}
				<li class="stp {i === currentIdx ? 'stp-now' : ''} {i < currentIdx ? 'stp-done' : ''}">
					<span class="stp-dot">{#if i < currentIdx}<Check size={13} />{:else}{i + 1}{/if}</span>
					<span class="stp-label">{s.label}</span>
				</li>
			{/each}
		</ol>
	{/if}

	{#if step === 'done'}
		<div class="card done">
			<span class="done-badge"><Check size={28} /></span>
			<h2 class="done-title">{doneStatus === 'pending' ? m.sched_book_success_pending() : m.sched_book_done_title()}</h2>
			<p class="t-caption done-note">
				{doneStatus === 'pending' ? m.sched_book_done_note_pending() : m.sched_book_done_note()}
			</p>
			<dl class="summary">
				<div><dt>{m.sched_book_step_service()}</dt><dd>{chosenService?.title} · {chosenService?.length} min</dd></div>
				<div><dt>{m.sched_book_when()}</dt><dd>{fmtDateTime(slot)}</dd></div>
				<div><dt>{m.sched_book_name()}</dt><dd>{name}</dd></div>
			</dl>
		</div>
	{:else if data.eventTypes.length === 0}
		<div class="card"><p class="t-caption">{m.sched_book_no_slots()}</p></div>
	{:else}
		<div class="card">
			<!-- Step: choose service -->
			{#if step === 'service'}
				<h2 class="step-h">{m.sched_book_choose_service()}</h2>
				<div class="flex flex-col gap-2">
					{#each data.eventTypes as e (e.id)}
						<button class="svc" onclick={() => pickService(e.id)}>
							<span class="font-medium">{e.title}</span>
							<span class="t-caption">{e.length} min</span>
						</button>
					{/each}
				</div>
			{/if}

			<!-- Step: pick time -->
			{#if step === 'time'}
				<h2 class="step-h">{m.sched_book_pick_time()}</h2>
				{#if chosenService}<p class="t-caption mb-3">{chosenService.title} · {chosenService.length} min</p>{/if}

				{#if loading && windowSlots.length === 0}
					<div class="loading"><span class="spinner"></span><span class="t-caption">{m.sched_book_loading()}</span></div>
				{:else}
					<!-- Quick day picker: next 5 days with availability + custom date -->
					<div class="days">
						{#each quickDays as key (key)}
							{@const d = fmtDayShort(key)}
							<button
								class="day {selectedDay === key && !showCustom ? 'day-on' : ''}"
								onclick={() => {
									showCustom = false;
									selectedDay = key;
									slot = '';
								}}
							>
								<span class="day-wd">{d.weekday}</span>
								<span class="day-num">{d.day}</span>
							</button>
						{/each}
						<button
							class="day day-custom {showCustom ? 'day-on' : ''}"
							onclick={() => {
								showCustom = true;
							}}
						>
							<span class="day-wd"><CalendarClock size={16} /></span>
							<span class="day-num">{m.sched_book_other_date()}</span>
						</button>
					</div>

					{#if showCustom}
						<input class="txt mt-3" type="date" bind:value={customDate} onchange={loadCustomDay} />
					{/if}

					{#if loading}
						<div class="loading mt-3"><span class="spinner"></span></div>
					{:else if daySlots.length === 0}
						<p class="t-caption mt-3">{m.sched_book_no_slots()}</p>
					{:else}
						<div class="slot-grid mt-3">
							{#each daySlots as s (s.start)}
								<button class="slot {slot === s.start ? 'slot-on' : ''}" onclick={() => (slot = s.start)}>
									{hhmm(s.start)}
								</button>
							{/each}
						</div>
					{/if}
				{/if}

				<div class="nav">
					{#if data.eventTypes.length > 1}
						<button class="btn-ghost" onclick={() => (step = 'service')}>
							<ArrowLeft size={16} />{m.sched_book_back()}
						</button>
					{/if}
					<button class="btn" disabled={!slot} onclick={() => (step = 'details')}>
						{m.sched_book_continue()}<ArrowRight size={16} />
					</button>
				</div>
			{/if}

			<!-- Step: details -->
			{#if step === 'details'}
				<h2 class="step-h">{m.sched_book_your_details()}</h2>
				<p class="t-caption mb-3">{chosenService?.title} · {fmtDateTime(slot)}</p>
				<label class="field"><span class="t-caption">{m.sched_book_name()}</span><input class="txt" bind:value={name} /></label>
				<label class="field"><span class="t-caption">{m.sched_book_email()}</span><input class="txt" type="email" bind:value={email} /></label>
				<label class="field"><span class="t-caption">{m.sched_book_phone()}</span><input class="txt" type="tel" bind:value={phone} /></label>
				{#if err}<p class="t-caption mt-1" style="color:var(--color-destructive)">{err}</p>{/if}
				<div class="nav">
					<button class="btn-ghost" onclick={() => (step = 'time')}>
						<ArrowLeft size={16} />{m.sched_book_back()}
					</button>
					<button class="btn" disabled={loading || !name.trim()} onclick={confirm}>
						{#if loading}<span class="spinner spinner-sm"></span>{:else}<Check size={16} />{/if}{m.sched_book_confirm()}
					</button>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.wrap {
		max-width: 520px;
		margin: 0 auto;
		padding: 2.5rem 1rem;
		min-height: 100vh;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1.25rem;
	}
	.head-icon {
		color: var(--accent);
		display: inline-flex;
	}
	.title {
		font-size: 1.4rem;
		font-weight: 600;
	}
	/* Stepper */
	.stepper {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1.25rem;
		list-style: none;
		padding: 0;
	}
	.stp {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex: 1;
		min-width: 0;
	}
	.stp:not(:last-child)::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--hairline);
	}
	.stp-dot {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 999px;
		border: 1px solid var(--hairline);
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-muted-foreground, #888);
		flex-shrink: 0;
	}
	.stp-label {
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #888);
		white-space: nowrap;
	}
	.stp-now .stp-dot {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--color-accent-foreground, #fff);
	}
	.stp-now .stp-label {
		color: var(--color-foreground, #fff);
		font-weight: 600;
	}
	.stp-done .stp-dot {
		background: color-mix(in srgb, var(--accent) 20%, transparent);
		border-color: var(--accent);
		color: var(--accent);
	}
	.card {
		border: 1px solid var(--hairline);
		border-radius: var(--radius-lg, 12px);
		background: var(--color-card);
		padding: 1.25rem;
	}
	.done {
		text-align: center;
		padding: 2rem 1.25rem;
	}
	.done-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 3.25rem;
		height: 3.25rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--accent) 18%, transparent);
		color: var(--accent);
		margin-bottom: 0.75rem;
	}
	.done-title {
		font-size: 1.15rem;
		font-weight: 600;
	}
	.done-note {
		margin-top: 0.25rem;
	}
	.summary {
		text-align: left;
		margin: 1.25rem auto 0;
		max-width: 320px;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		border-top: 1px solid var(--hairline);
		padding-top: 1rem;
	}
	.summary div {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
	}
	.summary dt {
		color: var(--color-muted-foreground, #888);
		font-size: 0.85rem;
	}
	.summary dd {
		font-size: 0.85rem;
		font-weight: 500;
		text-align: right;
	}
	.step-h {
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: 0.75rem;
	}
	.svc {
		display: flex;
		justify-content: space-between;
		align-items: center;
		border: 1px solid var(--hairline);
		border-radius: 8px;
		padding: 0.7rem 0.9rem;
		background: var(--color-card);
		text-align: left;
	}
	.svc:hover {
		border-color: var(--accent);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		margin-bottom: 0.6rem;
	}
	.txt {
		border: 1px solid var(--hairline);
		border-radius: 8px;
		padding: 0.5rem 0.6rem;
		background: var(--color-card);
		color: inherit;
		font-size: 0.9rem;
		width: 100%;
		/* Make the native date picker (and its calendar indicator) follow the
		   card's theme instead of rendering a black icon on a dark surface. */
		color-scheme: dark;
	}
	/* Quick-day picker */
	.days {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.5rem;
	}
	.day {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.15rem;
		border: 1px solid var(--hairline);
		border-radius: 8px;
		padding: 0.55rem 0.4rem;
		background: var(--color-card);
		min-height: 3.4rem;
		justify-content: center;
	}
	.day:hover {
		border-color: var(--accent);
	}
	.day-wd {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-muted-foreground, #888);
		display: inline-flex;
	}
	.day-num {
		font-size: 0.85rem;
		font-weight: 600;
	}
	.day-on {
		background: var(--accent);
		border-color: var(--accent);
	}
	.day-on .day-wd,
	.day-on .day-num {
		color: var(--color-accent-foreground, #fff);
	}
	.slot-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
		gap: 0.5rem;
		max-height: 240px;
		overflow: auto;
	}
	.slot {
		border: 1px solid var(--hairline);
		border-radius: 8px;
		padding: 0.5rem;
		font-size: 0.85rem;
		background: var(--color-card);
	}
	.slot:hover {
		border-color: var(--accent);
	}
	.slot-on {
		background: var(--accent);
		color: var(--color-accent-foreground, #fff);
		border-color: var(--accent);
	}
	/* Button row */
	.nav {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1.25rem;
	}
	.btn,
	.btn-ghost {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		border-radius: 8px;
		padding: 0.55rem 1rem;
		font-size: 0.9rem;
		font-weight: 500;
	}
	.btn {
		background: var(--accent);
		color: var(--color-accent-foreground, #fff);
		margin-left: auto;
	}
	.btn:disabled {
		opacity: 0.5;
	}
	.btn-ghost {
		border: 1px solid var(--hairline);
		background: var(--color-card);
		color: inherit;
	}
	.btn-ghost:hover {
		border-color: var(--accent);
	}
	/* Spinner */
	.loading {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.spinner {
		width: 1.1rem;
		height: 1.1rem;
		border: 2px solid var(--hairline);
		border-top-color: var(--accent);
		border-radius: 999px;
		animation: spin 0.7s linear infinite;
		display: inline-block;
	}
	.spinner-sm {
		width: 0.9rem;
		height: 0.9rem;
		border-top-color: var(--color-accent-foreground, #fff);
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
