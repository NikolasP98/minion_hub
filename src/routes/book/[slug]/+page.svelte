<script lang="ts">
	import type { PageData } from './$types';
	import { CalendarClock, Check } from 'lucide-svelte';
	import * as m from '$lib/paraglide/messages';

	let { data }: { data: PageData } = $props();

	type Step = 'service' | 'time' | 'details' | 'done';
	// svelte-ignore state_referenced_locally
	let step = $state<Step>(data.eventTypes.length === 1 ? 'time' : 'service');
	// svelte-ignore state_referenced_locally
	let eventTypeId = $state(data.eventTypes.length === 1 ? data.eventTypes[0].id : '');
	let date = $state(new Date().toISOString().slice(0, 10));
	let slots = $state<Array<{ start: string; end: string }>>([]);
	let slot = $state('');
	let loading = $state(false);
	let name = $state('');
	let email = $state('');
	let phone = $state('');
	let err = $state<string | null>(null);
	let doneStatus = $state<string>('accepted');

	const chosenService = $derived(data.eventTypes.find((e) => e.id === eventTypeId));

	function pickService(id: string) {
		eventTypeId = id;
		step = 'time';
		void loadSlots();
	}

	async function loadSlots() {
		if (!eventTypeId) return;
		loading = true;
		err = null;
		slot = '';
		const from = new Date(`${date}T00:00:00`);
		const to = new Date(from.getTime() + 86_400_000);
		try {
			const res = await fetch(
				`/api/scheduling/public/${data.slug}/slots?eventTypeId=${eventTypeId}&from=${from.toISOString()}&to=${to.toISOString()}`,
			);
			slots = res.ok ? ((await res.json()).slots ?? []) : [];
		} catch {
			slots = [];
		} finally {
			loading = false;
		}
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
				await loadSlots();
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

	function hhmm(iso: string): string {
		return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	}
</script>

<svelte:head><title>{data.title}</title></svelte:head>

<div class="wrap">
	<div class="head">
		<CalendarClock size={22} class="text-accent" />
		<div>
			<h1 class="title">{data.title}</h1>
			{#if data.description}<p class="t-caption">{data.description}</p>{/if}
		</div>
	</div>

	{#if step === 'done'}
		<div class="card done">
			<Check size={40} class="text-accent" />
			<p class="mt-2 font-medium">
				{doneStatus === 'pending' ? m.sched_book_success_pending() : m.sched_book_success()}
			</p>
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
				{#if chosenService}<p class="t-caption mb-2">{chosenService.title} · {chosenService.length} min</p>{/if}
				<input class="txt mb-3" type="date" bind:value={date} onchange={loadSlots} />
				{#if loading}
					<p class="t-caption">…</p>
				{:else if slots.length === 0}
					<p class="t-caption">{m.sched_book_no_slots()}</p>
				{:else}
					<div class="slot-grid">
						{#each slots as s (s.start)}
							<button class="slot {slot === s.start ? 'slot-on' : ''}" onclick={() => (slot = s.start)}>
								{hhmm(s.start)}
							</button>
						{/each}
					</div>
				{/if}
				<div class="flex gap-2 mt-4">
					{#if data.eventTypes.length > 1}
						<button class="btn-ghost" onclick={() => (step = 'service')}>←</button>
					{/if}
					<button class="btn" disabled={!slot} onclick={() => (step = 'details')}>{m.sched_book_pick_time()} →</button>
				</div>
			{/if}

			<!-- Step: details -->
			{#if step === 'details'}
				<h2 class="step-h">{m.sched_book_your_details()}</h2>
				<p class="t-caption mb-3">{chosenService?.title} · {new Date(slot).toLocaleString()}</p>
				<label class="field"><span class="t-caption">{m.sched_book_name()}</span><input class="txt" bind:value={name} /></label>
				<label class="field"><span class="t-caption">{m.sched_book_email()}</span><input class="txt" type="email" bind:value={email} /></label>
				<label class="field"><span class="t-caption">{m.sched_book_phone()}</span><input class="txt" type="tel" bind:value={phone} /></label>
				{#if err}<p class="t-caption mt-1" style="color:var(--color-destructive)">{err}</p>{/if}
				<div class="flex gap-2 mt-4">
					<button class="btn-ghost" onclick={() => (step = 'time')}>←</button>
					<button class="btn" disabled={loading || !name.trim()} onclick={confirm}>{m.sched_book_confirm()}</button>
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
		margin-bottom: 1.5rem;
	}
	.title {
		font-size: 1.4rem;
		font-weight: 600;
	}
	.card {
		border: 1px solid var(--hairline);
		border-radius: var(--radius-lg, 12px);
		background: var(--color-card);
		padding: 1.25rem;
	}
	.done {
		text-align: center;
		padding: 2.5rem 1.25rem;
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
		font-size: 0.9rem;
		width: 100%;
	}
	.slot-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
		gap: 0.5rem;
		max-height: 280px;
		overflow: auto;
	}
	.slot {
		border: 1px solid var(--hairline);
		border-radius: 8px;
		padding: 0.5rem;
		font-size: 0.85rem;
		background: var(--color-card);
	}
	.slot-on {
		background: var(--accent);
		color: var(--color-accent-foreground, #fff);
		border-color: var(--accent);
	}
	.btn {
		background: var(--accent);
		color: var(--color-accent-foreground, #fff);
		border-radius: 8px;
		padding: 0.5rem 1rem;
		font-size: 0.9rem;
		font-weight: 500;
	}
	.btn:disabled {
		opacity: 0.5;
	}
	.btn-ghost {
		border: 1px solid var(--hairline);
		border-radius: 8px;
		padding: 0.5rem 0.8rem;
		background: var(--color-card);
	}
</style>
