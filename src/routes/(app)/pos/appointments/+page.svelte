<script lang="ts">
	import type { PageData } from './$types';
	import { CalendarDays, Plus, Check, X, UserX } from 'lucide-svelte';
	import { invalidate } from '$app/navigation';
	import { PageHeader, Card, Button, Badge, EmptyState, Modal } from '$lib/components/ui';
	import * as m from '$lib/paraglide/messages';
	import ConsumptionGauge from '$lib/components/stock/ConsumptionGauge.svelte';
	import { gaugeMax } from '$lib/components/stock/stock-ui';
	import { canAct } from '$lib/access/can.svelte';
	import { formatMoney } from '$lib/utils/format';

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

	function fmtTime(d: string | Date): string {
		const dt = typeof d === 'string' ? new Date(d) : d;
		return dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	}
	function fmtDay(d: string | Date): string {
		const dt = typeof d === 'string' ? new Date(d) : d;
		return dt.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
	}
	function dayKey(d: string | Date): string {
		const dt = typeof d === 'string' ? new Date(d) : d;
		return dt.toDateString();
	}

	async function setStatus(id: string, status: string) {
		await fetch(`/api/scheduling/bookings/${id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ status }),
		});
		await invalidate('pos:appointments');
	}

	const accrualBySource = $derived(new Map(data.accrualSummaries.map((s) => [s.sourceId, s])));

	// ── Today / +7d client filter ──
	let range = $state<'today' | 'week'>('today');
	const todayKey = new Date().toDateString();
	const visibleBookings = $derived(
		[...data.bookings]
			.filter((b) => range === 'week' || dayKey(b.startTime) === todayKey)
			.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()),
	);
	// Day-bucketed groups, in chronological order — the reference scheduling
	// bookings page renders a flat list; a front-desk view groups by day.
	const groups = $derived.by(() => {
		const map = new Map<string, { label: string; rows: typeof visibleBookings }>();
		for (const b of visibleBookings) {
			const key = dayKey(b.startTime);
			if (!map.has(key)) map.set(key, { label: fmtDay(b.startTime), rows: [] });
			map.get(key)!.rows.push(b);
		}
		return [...map.values()];
	});

	// ── Complete dialog (copied verbatim from scheduling/bookings) ──
	type ConsumptionLine = {
		itemId: string;
		itemName: string;
		uom: string;
		qty: number;
		qtyConsumption: number;
		consumptionUom: string | null;
		unitsPerStockUom: number | null;
		subunitsPerStockUom: number | null;
		diagramEnabled: boolean;
		available: number;
		committedOther: number;
		atp: number;
	};
	let completeFor = $state<string | null>(null); // booking id
	let cdLines = $state<ConsumptionLine[]>([]);
	let cdBusy = $state(false);
	let stockWarnings = $state<Record<string, string>>({}); // bookingId → message

	async function openComplete(id: string) {
		const summary = accrualBySource.get(id);
		if (!summary || summary.open === 0) {
			await completeBooking(id, null); // no accruals → one-click complete
			return;
		}
		const res = await fetch(`/api/stock/accruals?source=booking&sourceId=${id}&status=open`);
		const j = res.ok ? await res.json() : { accruals: [] };
		cdLines = (j.accruals ?? []).map((a: Record<string, unknown>) => ({
			itemId: a.itemId as string,
			itemName: a.itemName as string,
			uom: a.itemUom as string,
			qty: Number(a.qty),
			qtyConsumption: Number(a.qtyConsumption),
			consumptionUom: (a.consumptionUom as string | null) ?? null,
			unitsPerStockUom: a.unitsPerStockUom == null ? null : Number(a.unitsPerStockUom),
			subunitsPerStockUom: a.subunitsPerStockUom == null ? null : Number(a.subunitsPerStockUom),
			diagramEnabled: Boolean(a.diagramEnabled),
			available: 0,
			committedOther: 0,
			atp: 0,
		}));
		completeFor = id;
	}

	async function completeBooking(id: string, lines: ConsumptionLine[] | null) {
		cdBusy = true;
		try {
			// positive-filter, same principle as book(): a gauge dragged to 0 must not
			// block the whole completion — drop non-positive lines, or send null.
			const positiveLines = lines?.filter((l) => l.qtyConsumption > 0) ?? null;
			const res = await fetch(`/api/scheduling/bookings/${id}/complete`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					lines: positiveLines?.length ? positiveLines.map((l) => ({ itemId: l.itemId, qty: l.qty, qtyConsumption: l.qtyConsumption })) : null,
				}),
			});
			if (!res.ok) {
				stockWarnings = { ...stockWarnings, [id]: `complete failed (${res.status})` };
				completeFor = null;
				return;
			}
			const j = await res.json();
			if (j?.stockWarning) stockWarnings = { ...stockWarnings, [id]: j.stockWarning.message as string };
			else {
				const next = { ...stockWarnings };
				delete next[id];
				stockWarnings = next;
			}
			completeFor = null;
			await invalidate('pos:appointments');
		} finally {
			cdBusy = false;
		}
	}

	// ── New appointment modal (copied from scheduling/bookings + walk-in extras) ──
	let showNew = $state(false);
	let nbEventType = $state('');
	let nbDate = $state(new Date().toISOString().slice(0, 10));
	let nbSlots = $state<Array<{ start: string; end: string }>>([]);
	let nbSlot = $state('');
	let nbName = $state('');
	let nbPhone = $state('');
	let nbLoading = $state(false);
	let nbErr = $state<string | null>(null);

	let nbContactId = $state<string | null>(null);
	let nbSearch = $state('');
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

	let nbLines = $state<ConsumptionLine[]>([]);
	let nbHasMapping = $state(false);
	let nbGen = 0; // generation token: guards against a stale fetch overwriting a newer selection

	function setLineConsumption(l: ConsumptionLine, qtyConsumption: number) {
		l.qtyConsumption = qtyConsumption;
		l.qty = l.unitsPerStockUom ? qtyConsumption / l.unitsPerStockUom : qtyConsumption;
	}

	async function loadConsumption() {
		const gen = ++nbGen;
		nbLines = [];
		nbHasMapping = false;
		const et = data.eventTypes.find((e) => e.id === nbEventType);
		if (!et?.productId || !data.stockEnabled || !canAct('stock', 'view')) return;
		try {
			const res = await fetch('/api/stock/accruals/preview', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ finProductId: et.productId, quantity: 1 }),
			});
			if (!res.ok) return; // no warehouse / stock off — block simply stays hidden
			const j = await res.json();
			if (gen !== nbGen) return; // a newer selection superseded this fetch
			nbHasMapping = j.preview.hasMapping;
			nbLines = j.preview.lines;
		} catch {
			/* preview is best-effort */
		}
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

	// ── Walk-in extras (Task 8): force a specific staff member, optionally
	// booking off-grid with an exact typed start. ──
	let nbForceResourceId = $state(''); // '' = "anyone"
	let nbOverrideChecked = $state(false);
	let nbOverrideTime = $state(''); // HH:MM
	const overrideActive = $derived(Boolean(nbForceResourceId) && nbOverrideChecked);

	async function book() {
		// Override path needs a typed time instead of a picked slot; the normal
		// path still needs a picked slot.
		if (!nbEventType || !nbName.trim() || (overrideActive ? !nbOverrideTime : !nbSlot)) {
			nbErr = 'service, time and name required';
			return;
		}
		nbLoading = true;
		nbErr = null;
		try {
			// server requires qtyConsumption > 0 per line; a gauge dragged to 0 (or a typed
			// negative) must not fail the whole booking — drop non-positive lines instead.
			const positiveLines = nbHasMapping ? nbLines.filter((l) => l.qtyConsumption > 0) : [];
			const start = overrideActive ? new Date(`${nbDate}T${nbOverrideTime}:00`).toISOString() : nbSlot;
			const res = await fetch('/api/scheduling/bookings', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					eventTypeId: nbEventType,
					start,
					attendeeName: nbName,
					attendeePhone: nbPhone || null,
					crmContactId: nbContactId,
					forceResourceId: nbForceResourceId || undefined,
					// BOTH staff-forced AND the checkbox are required — never send this
					// from just a forced resource pick.
					overrideConflicts: overrideActive ? true : undefined,
					consumption: positiveLines.length
						? positiveLines.map((l) => ({ itemId: l.itemId, qtyConsumption: l.qtyConsumption }))
						: null,
				}),
			});
			if (res.status === 409) {
				nbErr = m.sched_book_unavailable();
				if (!overrideActive) await loadSlots();
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
			nbLines = [];
			nbHasMapping = false;
			nbForceResourceId = '';
			nbOverrideChecked = false;
			nbOverrideTime = '';
			await invalidate('pos:appointments');
		} catch (e) {
			nbErr = e instanceof Error ? e.message : 'error';
		} finally {
			nbLoading = false;
		}
	}
</script>

<svelte:head><title>{m.pos_nav_appointments()} · {m.nav_pos()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.pos_nav_appointments()}>
		{#snippet leading()}
			<CalendarDays size={16} class="text-accent shrink-0" />
		{/snippet}
		{#snippet actions()}
			<div class="range-toggle">
				<button type="button" class="range-btn {range === 'today' ? 'range-on' : ''}" onclick={() => (range = 'today')}>{m.pos_appt_today()}</button>
				<button type="button" class="range-btn {range === 'week' ? 'range-on' : ''}" onclick={() => (range = 'week')}>{m.pos_appt_week()}</button>
			</div>
			<Button
				size="sm"
				onclick={() => (showNew = true)}
				disabled={data.eventTypes.length === 0 || !canAct('scheduling', 'edit')}
				title={canAct('scheduling', 'edit') ? undefined : m.no_permission()}
			>
				<Plus size={14} /> {m.pos_appt_new()}
			</Button>
		{/snippet}
	</PageHeader>

	<div class="flex-1 min-h-0 overflow-auto p-4">
		{#if visibleBookings.length === 0}
			<EmptyState title={m.sched_empty_bookings()} />
		{:else}
			<div class="flex flex-col gap-4">
				{#each groups as g (g.label)}
					<div>
						<div class="t-caption mb-1.5 capitalize">{g.label}</div>
						<div class="flex flex-col gap-2">
							{#each g.rows as b (b.id)}
								<Card padding="md">
									<div class="flex items-center gap-3 flex-wrap">
										<div class="min-w-[70px] font-medium">{fmtTime(b.startTime)}</div>
										<div class="flex-1 min-w-[180px]">
											<div class="font-medium">{eventTitle(b.eventTypeId)}</div>
											<div class="t-caption">{resourceName(b.resourceId)}</div>
										</div>
										<div class="min-w-[120px]">
											<div class="text-sm">{b.attendeeName ?? '—'}</div>
											<div class="t-caption">{b.attendeePhone ?? ''}</div>
										</div>
										<Badge>{(STATUS_LABEL[b.status] ?? (() => b.status))()}</Badge>
										{#if accrualBySource.get(b.id)}
											{@const acc = accrualBySource.get(b.id)!}
											{#if acc.open > 0}
												<Badge variant="semantic" value="warning">{m.sched_stock_committed({ value: formatMoney(acc.estValue) })}</Badge>
											{:else if acc.realized > 0}
												<a href={acc.realizedEntryId ? `/stock/entries/${acc.realizedEntryId}` : '/stock'} class="no-underline">
													<Badge variant="semantic" value="success">{m.sched_stock_realized({ value: formatMoney(acc.realizedValue) })}</Badge>
												</a>
											{:else}
												<Badge>{m.sched_stock_released()}</Badge>
											{/if}
										{/if}
										{#if stockWarnings[b.id]}
											<span class="t-caption" style="color:var(--color-destructive)">
												{stockWarnings[b.id]}
												<button class="underline" onclick={() => completeBooking(b.id, null)}>{m.sched_stock_retry_post()}</button>
											</span>
										{/if}
										<!-- PATCH/complete live under /api/scheduling → gated centrally by
										     scheduling:edit, not pos:edit — gate on that capability here too. -->
										{#if b.status === 'accepted' || b.status === 'pending'}
											<div class="flex gap-1">
												<button
													class="act"
													title={canAct('scheduling', 'edit') ? m.sched_mark_complete() : m.no_permission()}
													disabled={!canAct('scheduling', 'edit')}
													onclick={() => openComplete(b.id)}
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
											</div>
										{/if}
									</div>
								</Card>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<Modal bind:open={showNew} title={m.pos_appt_new()} onclose={() => (showNew = false)}>
	<div class="flex flex-col gap-3">
			<label class="field">
				<span class="t-caption">{m.sched_book_choose_service()}</span>
				<select class="txt" bind:value={nbEventType} onchange={() => { loadSlots(); loadConsumption(); }}>
					<option value="">—</option>
					{#each data.eventTypes as e (e.id)}
						<option value={e.id}>{e.title}</option>
					{/each}
				</select>
			</label>
			<label class="field">
				<span class="t-caption">{m.sched_nav_resources()}</span>
				<select class="txt" bind:value={nbForceResourceId}>
					<option value="">{m.pos_appt_staff_any()}</option>
					{#each data.resources as r (r.id)}
						<option value={r.id}>{r.name}</option>
					{/each}
				</select>
			</label>
			<label class="field">
				<span class="t-caption">{m.sched_book_pick_time()}</span>
				<input class="txt" type="date" bind:value={nbDate} onchange={loadSlots} />
			</label>
			{#if nbLoading}
				<p class="t-caption">…</p>
			{:else if nbEventType && nbSlots.length === 0 && !overrideActive}
				<p class="t-caption">{m.sched_book_no_slots()}</p>
			{:else if nbSlots.length && !overrideActive}
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
			{#if nbForceResourceId && canAct('scheduling', 'edit')}
				<div class="field override-box">
					<label class="check-row">
						<input type="checkbox" bind:checked={nbOverrideChecked} />
						<span class="t-caption">{m.pos_walkin_override()}</span>
					</label>
					{#if nbOverrideChecked}
						<input class="txt" type="time" bind:value={nbOverrideTime} />
					{/if}
				</div>
			{/if}
			{#if nbHasMapping && nbLines.length}
				<div class="field">
					<span class="t-caption">{m.sched_stock_consumption()}</span>
					<div class="flex flex-col gap-2">
						{#each nbLines as l (l.itemId)}
							{@const gMax = l.diagramEnabled ? gaugeMax({ uom: l.uom, unitsPerStockUom: l.unitsPerStockUom, subunitsPerStockUom: l.subunitsPerStockUom }) : 0}
							<div class="flex items-center gap-3 flex-wrap">
								<span class="text-sm min-w-[120px]">{l.itemName}</span>
								{#if gMax > 0}
									<ConsumptionGauge
										max={gMax}
										unit={l.consumptionUom ?? l.uom}
										bind:value={() => l.qtyConsumption ?? 0, (v) => setLineConsumption(l, v)}
									/>
								{:else}
									<input
										class="txt"
										style="max-width: 90px"
										type="number"
										min="0"
										step="any"
										value={l.qtyConsumption}
										oninput={(e) => setLineConsumption(l, Number(e.currentTarget.value) || 0)}
									/>
									<span class="t-caption">{l.consumptionUom ?? l.uom}</span>
								{/if}
								{#if l.qty > l.atp}
									<span class="t-caption" style="color:var(--color-destructive)">{m.sched_stock_atp_warn({ atp: String(l.atp), uom: l.uom })}</span>
								{/if}
							</div>
						{/each}
					</div>
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
				disabled={nbLoading || (overrideActive ? !nbOverrideTime : !nbSlot) || !nbName.trim() || !canAct('scheduling', 'edit')}
				title={canAct('scheduling', 'edit') ? undefined : m.no_permission()}
			>{m.sched_book_confirm()}</Button>
			<Button variant="ghost" onclick={() => (showNew = false)}>{m.sched_cancel()}</Button>
		</div>
	</div>
</Modal>

<Modal open={completeFor !== null} title={m.sched_complete_title()} onclose={() => (completeFor = null)}>
	<div class="flex flex-col gap-3">
		<p class="t-caption">{m.sched_complete_hint()}</p>
		{#each cdLines as l (l.itemId)}
			{@const gMax = l.diagramEnabled ? gaugeMax({ uom: l.uom, unitsPerStockUom: l.unitsPerStockUom, subunitsPerStockUom: l.subunitsPerStockUom }) : 0}
			<div class="flex items-center gap-3 flex-wrap">
				<span class="text-sm min-w-[120px]">{l.itemName}</span>
				{#if gMax > 0}
					<ConsumptionGauge
						max={gMax}
						unit={l.consumptionUom ?? l.uom}
						bind:value={() => l.qtyConsumption ?? 0, (v) => setLineConsumption(l, v)}
					/>
				{:else}
					<input
						class="txt"
						style="max-width: 90px"
						type="number"
						min="0"
						step="any"
						value={l.qtyConsumption}
						oninput={(e) => setLineConsumption(l, Number(e.currentTarget.value) || 0)}
					/>
					<span class="t-caption">{l.consumptionUom ?? l.uom}</span>
				{/if}
			</div>
		{/each}
		<div class="flex gap-2">
			<Button disabled={cdBusy} onclick={() => completeFor && completeBooking(completeFor, cdLines)}>{m.sched_complete_confirm()}</Button>
			<Button variant="ghost" onclick={() => (completeFor = null)}>{m.sched_cancel()}</Button>
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
	.range-toggle {
		display: inline-flex;
		border: 1px solid var(--hairline);
		border-radius: 8px;
		overflow: hidden;
	}
	.range-btn {
		padding: 0.35rem 0.7rem;
		font-size: 0.8rem;
		background: var(--color-card);
		color: var(--color-muted-foreground);
	}
	.range-btn:not(:last-child) {
		border-right: 1px solid var(--hairline);
	}
	.range-on {
		background: var(--accent);
		color: var(--color-accent-foreground, #fff);
	}
	.override-box {
		border: 1px dashed var(--hairline);
		border-radius: 8px;
		padding: 0.5rem;
		gap: 0.4rem;
	}
	.check-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
</style>
