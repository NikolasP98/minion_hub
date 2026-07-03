<script lang="ts">
	import type { PageData } from './$types';
	import { CalendarClock, Plus, Check, X, UserX, ClipboardList } from 'lucide-svelte';
	import { invalidate, goto } from '$app/navigation';
	import { PageHeader, Card, Button, Badge, EmptyState, Modal } from '$lib/components/ui';
	import * as m from '$lib/paraglide/messages';
	import ScopeBanner from '$lib/components/crm/ScopeBanner.svelte';
	import { canAct } from '$lib/access/can.svelte';

	let { data }: { data: PageData } = $props();

	const resourceName = (id: string) => data.resources.find((r) => r.id === id)?.name ?? '—';
	const eventTitle = (id: string) => data.eventTypes.find((e) => e.id === id)?.title ?? '—';

	const STATUS_LABEL: Record<string, () => string> = {
		accepted: () => m.sched_status_accepted(),
		pending: () => m.sched_status_pending(),
		cancelled: () => m.sched_status_cancelled(),
		rejected: () => m.sched_status_rejected(),
		completed: () => m.sched_status_completed(),
		no_show: () => m.sched_status_no_show(),
	};

	function fmt(d: string | Date): string {
		const dt = typeof d === 'string' ? new Date(d) : d;
		return dt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}

	async function setStatus(id: string, status: string) {
		await fetch(`/api/scheduling/bookings/${id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ status }),
		});
		await invalidate('scheduling:data');
	}

	// Booking → Sales Order: map this appointment into a commitment-to-bill and
	// jump to the Sales view. Idempotent server-side (one order per booking).
	let orderBusy = $state<string | null>(null);
	async function createOrder(id: string) {
		orderBusy = id;
		try {
			const res = await fetch(`/api/scheduling/bookings/${id}/order`, { method: 'POST' });
			if (res.ok) await goto('/sales');
		} finally {
			orderBusy = null;
		}
	}

	// ── New appointment modal ── (opened pre-bound from the Connections "+New")
	// svelte-ignore state_referenced_locally
	let showNew = $state(data.openNew ?? false);
	let nbEventType = $state('');
	let nbDate = $state(new Date().toISOString().slice(0, 10));
	let nbSlots = $state<Array<{ start: string; end: string }>>([]);
	let nbSlot = $state('');
	// svelte-ignore state_referenced_locally
	let nbName = $state(data.contactName ?? '');
	let nbPhone = $state('');
	let nbLoading = $state(false);
	let nbErr = $state<string | null>(null);

	// Optional link to an existing CRM contact (better traceability than phone-match).
	// svelte-ignore state_referenced_locally
	let nbContactId = $state<string | null>(data.contactId ?? null);
	// svelte-ignore state_referenced_locally
	let nbSearch = $state(data.contactName ?? '');
	let nbResults = $state<Array<{ id: string; name: string }>>([]);
	async function searchContacts() {
		nbContactId = null; // typing a new query unpicks any prior choice
		const q = nbSearch.trim();
		if (q.length < 2) {
			nbResults = [];
			return;
		}
		const res = await fetch(`/api/crm/contacts?search=${encodeURIComponent(q)}&limit=8`);
		const j = res.ok ? await res.json() : { contacts: [] };
		nbResults = (j.contacts ?? []).map((c: { contact_id: string; display_name: string | null }) => ({ id: c.contact_id, name: c.display_name || '—' }));
	}
	async function pickContact(c: { id: string; name: string }) {
		nbContactId = c.id;
		nbName = c.name;
		nbSearch = c.name;
		nbResults = [];
		// fetch_from: pull the contact's phone/email and fill only what's empty.
		try {
			const res = await fetch(`/api/crm/contacts/${c.id}/prefill`);
			if (res.ok) {
				const p = await res.json();
				if (!nbPhone && p.phone) nbPhone = p.phone;
				if (!nbName && p.name) nbName = p.name;
			}
		} catch {
			/* prefill is best-effort */
		}
	}

	async function loadSlots() {
		if (!nbEventType || !nbDate) return;
		nbLoading = true;
		nbErr = null;
		nbSlot = '';
		const from = new Date(`${nbDate}T00:00:00`);
		const to = new Date(from.getTime() + 86_400_000);
		try {
			const res = await fetch(
				`/api/scheduling/slots?eventTypeId=${nbEventType}&from=${from.toISOString()}&to=${to.toISOString()}`,
			);
			if (res.ok) {
				const j = await res.json();
				nbSlots = j.slots ?? [];
			} else nbSlots = [];
		} finally {
			nbLoading = false;
		}
	}

	async function book() {
		if (!nbEventType || !nbSlot || !nbName.trim()) {
			nbErr = 'service, time and name required';
			return;
		}
		nbLoading = true;
		nbErr = null;
		try {
			const res = await fetch('/api/scheduling/bookings', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ eventTypeId: nbEventType, start: nbSlot, attendeeName: nbName, attendeePhone: nbPhone || null, crmContactId: nbContactId }),
			});
			if (res.status === 409) {
				nbErr = m.sched_book_unavailable();
				await loadSlots();
				return;
			}
			if (!res.ok) throw new Error(String(res.status));
			showNew = false;
			nbName = '';
			nbPhone = '';
			nbSlot = '';
			nbContactId = null;
			nbSearch = '';
			nbResults = [];
			await invalidate('scheduling:data');
		} catch (e) {
			nbErr = e instanceof Error ? e.message : 'error';
		} finally {
			nbLoading = false;
		}
	}
</script>

<svelte:head><title>{m.sched_bookings_title()} · {m.nav_scheduling()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.sched_bookings_title()} subtitle={m.sched_dashboard_subtitle()}>
		{#snippet leading()}
			<CalendarClock size={16} class="text-accent shrink-0" />
		{/snippet}
		{#snippet actions()}
			<Button
				size="sm"
				onclick={() => (showNew = true)}
				disabled={data.eventTypes.length === 0 || !canAct('scheduling', 'edit')}
				title={canAct('scheduling', 'edit') ? undefined : m.no_permission()}
			>
				<Plus size={14} /> {m.sched_bookings_title()}
			</Button>
		{/snippet}
	</PageHeader>

	<div class="flex-1 min-h-0 overflow-auto p-4">
		{#if data.contactName}<div class="mb-3"><ScopeBanner name={data.contactName} contactId={data.contactId} noun="bookings" /></div>{/if}
		{#if data.bookings.length === 0}
			<EmptyState title={m.sched_empty_bookings()} />
		{:else}
			<div class="flex flex-col gap-2">
				{#each data.bookings as b (b.id)}
					<Card padding="md">
						<div class="flex items-center gap-3 flex-wrap">
							<div class="flex-1 min-w-[180px]">
								<div class="font-medium">{eventTitle(b.eventTypeId)}</div>
								<div class="t-caption">{fmt(b.startTime)} · {resourceName(b.resourceId)}</div>
							</div>
							<div class="min-w-[120px]">
								<div class="text-sm">{b.attendeeName ?? '—'}</div>
								<div class="t-caption">{b.attendeePhone ?? ''}</div>
							</div>
							<Badge>{(STATUS_LABEL[b.status] ?? (() => b.status))()}</Badge>
							<div class="flex gap-1">
								{#if b.status === 'accepted' || b.status === 'pending'}
									<button
										class="act"
										title={canAct('scheduling', 'edit') ? m.sched_mark_complete() : m.no_permission()}
										disabled={!canAct('scheduling', 'edit')}
										onclick={() => setStatus(b.id, 'completed')}
									>
										<Check size={15} />
									</button>
									<button
										class="act"
										title={canAct('scheduling', 'edit') ? m.sched_mark_noShow() : m.no_permission()}
										disabled={!canAct('scheduling', 'edit')}
										onclick={() => setStatus(b.id, 'no_show')}
									>
										<UserX size={15} />
									</button>
									<button
										class="act del"
										title={canAct('scheduling', 'edit') ? m.sched_cancel_booking() : m.no_permission()}
										disabled={!canAct('scheduling', 'edit')}
										onclick={() => setStatus(b.id, 'cancelled')}
									>
										<X size={15} />
									</button>
								{/if}
								{#if b.status !== 'cancelled' && b.status !== 'rejected'}
									<button
										class="act"
										title={canAct('scheduling', 'edit') ? 'Create sales order' : m.no_permission()}
										disabled={orderBusy === b.id || !canAct('scheduling', 'edit')}
										onclick={() => createOrder(b.id)}
									>
										<ClipboardList size={15} />
									</button>
								{/if}
							</div>
						</div>
					</Card>
				{/each}
			</div>
		{/if}
	</div>
</div>

<Modal bind:open={showNew} title={m.sched_bookings_title()} onclose={() => (showNew = false)}>
	<div class="flex flex-col gap-3">
			<label class="field">
				<span class="t-caption">{m.sched_book_choose_service()}</span>
				<select class="txt" bind:value={nbEventType} onchange={loadSlots}>
					<option value="">—</option>
					{#each data.eventTypes as e (e.id)}
						<option value={e.id}>{e.title}</option>
					{/each}
				</select>
			</label>
			<label class="field">
				<span class="t-caption">{m.sched_book_pick_time()}</span>
				<input class="txt" type="date" bind:value={nbDate} onchange={loadSlots} />
			</label>
			{#if nbLoading}
				<p class="t-caption">…</p>
			{:else if nbEventType && nbSlots.length === 0}
				<p class="t-caption">{m.sched_book_no_slots()}</p>
			{:else if nbSlots.length}
				<div class="slot-grid">
					{#each nbSlots as s (s.start)}
						<button
							type="button"
							class="slot {nbSlot === s.start ? 'slot-on' : ''}"
							onclick={() => (nbSlot = s.start)}
						>
							{new Date(s.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
						</button>
					{/each}
				</div>
			{/if}
			<div class="field">
				<span class="t-caption">{m.sched_book_find_client()}</span>
				<div class="search-wrap">
					<input class="txt" bind:value={nbSearch} oninput={searchContacts} placeholder={m.sched_book_find_client_ph()} />
					{#if nbContactId}<span class="linked">✓ {m.sched_book_linked()}</span>{/if}
					{#if nbResults.length}
						<div class="results">
							{#each nbResults as c (c.id)}
								<button type="button" class="result" onclick={() => pickContact(c)}>{c.name}</button>
							{/each}
						</div>
					{/if}
				</div>
			</div>
			<label class="field">
				<span class="t-caption">{m.sched_book_name()}</span>
				<input class="txt" bind:value={nbName} />
			</label>
			{#if !nbContactId}
				<label class="field">
					<span class="t-caption">{m.sched_book_phone()}</span>
					<input class="txt" bind:value={nbPhone} />
				</label>
			{/if}
			{#if nbErr}<p class="t-caption" style="color:var(--color-destructive)">{nbErr}</p>{/if}
		<div class="flex gap-2">
			<Button
				onclick={book}
				disabled={nbLoading || !nbSlot || !nbName.trim() || !canAct('scheduling', 'edit')}
				title={canAct('scheduling', 'edit') ? undefined : m.no_permission()}
			>{m.sched_book_confirm()}</Button>
			<Button variant="ghost" onclick={() => (showNew = false)}>{m.sched_cancel()}</Button>
		</div>
	</div>
</Modal>

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
	.slot-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
		gap: 0.4rem;
		max-height: 200px;
		overflow: auto;
	}
	.slot {
		border: 1px solid var(--hairline);
		border-radius: 6px;
		padding: 0.3rem;
		font-size: 0.8rem;
		background: var(--color-card);
	}
	.slot-on {
		background: var(--accent);
		color: var(--color-accent-foreground, #fff);
		border-color: var(--accent);
	}
	.search-wrap {
		position: relative;
	}
	.linked {
		font-size: 0.72rem;
		color: var(--accent);
	}
	.results {
		position: absolute;
		z-index: 10;
		left: 0;
		right: 0;
		top: 100%;
		margin-top: 2px;
		background: var(--color-card);
		border: 1px solid var(--hairline);
		border-radius: 8px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
		max-height: 180px;
		overflow: auto;
	}
	.result {
		display: block;
		width: 100%;
		text-align: left;
		padding: 0.4rem 0.6rem;
		font-size: 0.85rem;
	}
	.result:hover {
		background: var(--hairline);
	}
	.act {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--color-muted-foreground);
		border-radius: 6px;
		padding: 0.25rem;
	}
	.act:hover {
		background: var(--hairline);
	}
	.act.del:hover {
		color: var(--color-destructive);
	}
</style>
