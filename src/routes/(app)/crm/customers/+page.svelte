<script lang="ts">
	import type { PageData } from './$types';
	import { goto } from '$app/navigation';
	import { invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
	import { Contact, RefreshCw, ArrowUp, ArrowDown, X } from 'lucide-svelte';
	import { PageHeader, Button, Modal } from '$lib/components/ui';
	import ScoreCell from '$lib/components/crm/ScoreCell.svelte';
	import StagePill from '$lib/components/crm/StagePill.svelte';
	import FunnelStagePill from '$lib/components/crm/FunnelStagePill.svelte';
	import ChannelBrandIcon from '$lib/components/channels/ChannelBrandIcon.svelte';
	import Highlight from '$lib/components/crm/Highlight.svelte';
	import { relativeTime, contactLabel, temperatureOf, identityValue } from '$lib/components/crm/crm-format';
	import { stageLabel, funnelStageLabel } from '$lib/components/crm/crm-i18n';
	import { FUNNEL_ORDER, effectiveFunnelStage, maxFunnelStage, financeFloorStage } from '$lib/components/crm/crm-funnel';
	import { collectMetaKeys, metaLabel, metaDisplay } from '$lib/components/crm/crm-meta';
	import { canAct } from '$lib/access/can.svelte';
	import DataTable from '$lib/components/data-table/DataTable.svelte';
	import type { DataColumn } from '$lib/components/data-table/DataTable.svelte';
	import CrmMergeResolver from '$lib/components/crm/CrmMergeResolver.svelte';
	import { applyContactMerge, type MergeField, type MergeResolution } from '$lib/components/crm/crm-merge';

	let { data }: { data: PageData } = $props();
	const contacts = $derived(data.contacts);
	const tags = $derived(data.tags);
	type Row = (typeof contacts)[number];

	// ── Finance bridge (present only when CRM + Finances are both enabled) ──────
	type ContactFin = { revenue: number; invoices: number; lastPurchaseAt: string | null; purchased: boolean; reservedOnly: boolean; loyal: boolean };
	const finOf = (c: Row) => (c as { finance?: ContactFin | null }).finance ?? null;
	const reservedOnly = (c: Row) => finOf(c)?.reservedOnly === true;
	// Effective funnel stage = chat-derived stage advanced by the finance floor.
	const funnelOf = (c: Row) =>
		maxFunnelStage(effectiveFunnelStage(c.custom_fields, { inbound: c.inbound_msgs }), financeFloorStage(finOf(c)));

	// ── Filter options ──────────────────────────────────────────────────────────
	const metaKeys = $derived(collectMetaKeys(contacts));
	const STAGES = ['New', 'Engaged', 'Active', 'Dormant', 'Churned'];
	const stageOptions = STAGES.map((s) => ({ value: s, label: stageLabel(s) }));
	const funnelOptions = FUNNEL_ORDER.map((id) => ({ value: id, label: funnelStageLabel(id) }));
	const channelOptions = $derived.by(() => {
		const s = new Set<string>();
		for (const c of contacts) for (const ch of c.channels ?? []) s.add(ch);
		return [...s].sort().map((ch) => ({ value: ch, label: ch.charAt(0).toUpperCase() + ch.slice(1) }));
	});

	// ── Page-owned filters (tag / reserved / awaiting / score / temp) ──────────
	// Header enum filters (stage/funnel/channel) are seeded into DataTable via
	// `initialFilters`; these toggles/chips pre-filter the data set instead.
	const qp = page.url.searchParams;
	const qpArr = (k: string) => (qp.get(k) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
	let tagId = $state('');
	let reservedFilter = $state(qp.get('reserved') === '1');
	let awaitingFilter = $state(qp.get('awaiting') === '1');
	let scoreMin = $state<number | null>(qp.has('scoreMin') ? Number(qp.get('scoreMin')) : null);
	let scoreMax = $state<number | null>(qp.has('scoreMax') ? Number(qp.get('scoreMax')) : null);
	let tempFilter = $state<string>(qp.get('temp') ?? '');
	const scoreActive = $derived(scoreMin != null || scoreMax != null);
	const initialFilters = { stage: qpArr('stage'), funnel: qpArr('funnel'), channel: qpArr('channel') };

	const filtered = $derived.by(() => {
		let list = contacts;
		if (tagId) list = list.filter((c) => c.tag_ids?.includes(tagId) || c.auto_tag_ids?.includes(tagId));
		if (reservedFilter) list = list.filter(reservedOnly);
		if (awaitingFilter) list = list.filter((c) => c.awaiting_reply);
		if (scoreMin != null) list = list.filter((c) => c.score >= scoreMin!);
		if (scoreMax != null) list = list.filter((c) => c.score <= scoreMax!);
		if (tempFilter) list = list.filter((c) => temperatureOf(c.score) === tempFilter);
		return list;
	});

	// ── Sort comparators ──────────────────────────────────────────────────────
	const name = (c: Row) => (c.display_name ?? '￿').toLowerCase();
	const byName = (a: Row, b: Row) => (name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : 0);
	const t = (c: Row) => (c.last_contact_at ? Date.parse(c.last_contact_at) : -Infinity);
	const rev = (c: Row) => finOf(c)?.revenue ?? -Infinity;
	const inv = (c: Row) => finOf(c)?.invoices ?? -Infinity;
	const lastBuy = (c: Row) => { const at = finOf(c)?.lastPurchaseAt; return at ? Date.parse(at) : -Infinity; };

	// ── Columns (base + dynamic meta + conditional finance) ────────────────────
	const columns = $derived.by<DataColumn<Row>[]>(() => {
		const cols: DataColumn<Row>[] = [
			{ key: 'name', label: m.crm_col_contact(), custom: true, accessor: (c) => contactLabel(c.display_name), exportValue: (c) => contactLabel(c.display_name), sortFn: byName, width: 240 },
			{ key: 'score', label: m.crm_col_score(), custom: true, accessor: (c) => c.score, sortFn: (a, b) => a.score - b.score, width: 120 },
			{ key: 'stage', label: m.crm_col_stage(), custom: true, accessor: (c) => c.stage, exportValue: (c) => stageLabel(c.stage), filter: { options: () => stageOptions, match: (c) => c.stage } },
			{ key: 'funnel', label: m.crm_funnel_col(), custom: true, accessor: (c) => { const f = funnelOf(c); return f ? funnelStageLabel(f) : ''; }, exportValue: (c) => { const f = funnelOf(c); return f ? funnelStageLabel(f) : ''; }, filter: { options: () => funnelOptions, match: (c) => funnelOf(c) ?? '' } },
		];
		for (const k of metaKeys)
			cols.push({ key: `meta:${k}`, label: metaLabel(k), custom: true, defaultHidden: true, accessor: (c) => metaDisplay(k, c.custom_fields?.[k]) });
		if (data.financeEnabled) {
			cols.push({ key: 'revenue', label: m.crm_col_revenue(), align: 'right', custom: true, accessor: (c) => finOf(c)?.revenue ?? null, exportValue: (c) => finOf(c)?.revenue ?? '', sortFn: (a, b) => rev(a) - rev(b), width: 120 });
			cols.push({ key: 'invoices', label: m.crm_col_invoices(), align: 'right', custom: true, accessor: (c) => finOf(c)?.invoices ?? null, exportValue: (c) => finOf(c)?.invoices ?? '', sortFn: (a, b) => inv(a) - inv(b), width: 96 });
			cols.push({ key: 'lastPurchase', label: m.crm_col_last_purchase(), align: 'right', custom: true, accessor: (c) => finOf(c)?.lastPurchaseAt ?? null, exportValue: (c) => finOf(c)?.lastPurchaseAt ?? '', sortFn: (a, b) => lastBuy(a) - lastBuy(b), width: 120 });
		}
		cols.push({ key: 'channels', label: m.crm_col_channels(), align: 'right', custom: true, accessor: (c) => (c.channels ?? []).join(', '), exportValue: (c) => (c.channels ?? []).join(', '), filter: { options: () => channelOptions, match: (c) => c.channels ?? [], icon: true, align: 'right' }, width: 120 });
		cols.push({ key: 'msgs', label: m.crm_col_msgs(), align: 'right', custom: true, accessor: (c) => c.total_msgs, exportable: false, sortFn: (a, b) => a.total_msgs - b.total_msgs, width: 100 });
		cols.push({ key: 'inbound', label: m.crm_export_inbound(), align: 'right', defaultHidden: true, accessor: (c) => c.inbound_msgs });
		cols.push({ key: 'outbound', label: m.crm_export_outbound(), align: 'right', defaultHidden: true, accessor: (c) => c.total_msgs - c.inbound_msgs });
		cols.push({ key: 'recent', label: m.crm_col_last_contact(), align: 'right', custom: true, accessor: (c) => c.last_contact_at, exportValue: (c) => c.last_contact_at ?? '', sortFn: (a, b) => t(a) - t(b), width: 120 });
		return cols;
	});

	// ── Actions ────────────────────────────────────────────────────────────────
	let syncing = $state(false);
	let creating = $state(false);
	let searchQuery = $state('');

	async function syncNow() {
		syncing = true;
		try {
			const res = await fetch('/api/crm/contacts/sync', { method: 'POST' });
			if (res.ok) await invalidate('crm:contacts');
		} finally {
			syncing = false;
		}
	}
	async function newContact() {
		creating = true;
		try {
			const res = await fetch('/api/crm/contacts', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ displayName: m.crm_new_contact() }),
			});
			if (res.ok) {
				const { contact } = await res.json();
				await goto(`/crm/${contact.id}`);
			}
		} finally {
			creating = false;
		}
	}

	// ── Bulk actions (kebab) — Merge (CRM-only, 2+) + Delete, both confirmed ──
	let selected = $state<Set<string>>(new Set());
	let bulkBusy = $state(false);
	let bulkErr = $state<string | null>(null);
	// Merge → shared column-per-candidate conflict resolver.
	let mergeOpen = $state(false);
	let mergeRows = $state<Row[]>([]);
	const mergeContacts = $derived(
		mergeRows.map((r) => {
			const fin = finOf(r);
			const subtitle = [
				m.crm_merge_msgs({ n: r.total_msgs }),
				fin && fin.revenue > 0 ? fin.revenue.toLocaleString() : null,
			].filter(Boolean).join(' · ');
			return {
				id: r.contact_id,
				name: contactLabel(r.display_name),
				subtitle,
				messages: r.total_msgs,
				// Per-identity channel + native id (phone / user id), formatted for display.
				identities: (r.identities ?? []).map((i) => ({ channel: i.channel, value: identityValue(i.externalId, i.handle) })),
			};
		}),
	);
	// Resolvable fields: the name + every custom_fields key present across the
	// selected contacts (dni / phone / email / …). The modal only surfaces the ones
	// that actually conflict (2+ distinct values).
	const mergeFields = $derived.by<MergeField[]>(() => {
		const fields: MergeField[] = [];
		const nameVals = mergeRows
			.map((r) => ({ contactId: r.contact_id, value: (r.display_name ?? '').trim() }))
			.filter((v) => v.value);
		if (nameVals.length) fields.push({ key: 'display_name', label: m.crm_col_contact(), values: nameVals });
		const keys = new Set<string>();
		for (const r of mergeRows) for (const k of Object.keys(r.custom_fields ?? {})) keys.add(k);
		for (const k of keys) {
			const vals = mergeRows
				.map((r) => ({ contactId: r.contact_id, value: String(r.custom_fields?.[k] ?? '').trim() }))
				.filter((v) => v.value);
			if (vals.length) fields.push({ key: k, label: metaLabel(k), values: vals });
		}
		return fields;
	});
	// Delete → simple confirm modal.
	let deleteOpen = $state(false);
	let deleteIds = $state<string[]>([]);

	const bulkActions = $derived.by(() => {
		if (!canAct('crm', 'edit')) return [];
		const acts: { label: string; danger?: boolean; onSelect: (ids: Set<string>, rows: Row[]) => void }[] = [];
		if (selected.size >= 2)
			acts.push({
				label: m.crm_bulk_merge_action(),
				onSelect: (_ids, rows) => {
					mergeRows = rows;
					bulkErr = null;
					mergeOpen = true;
				},
			});
		acts.push({
			label: m.crm_bulk_delete_action({ n: selected.size }),
			danger: true,
			onSelect: (ids) => { deleteIds = [...ids]; bulkErr = null; deleteOpen = true; },
		});
		return acts;
	});

	async function runMerge(res: MergeResolution) {
		if (!res.survivorId || res.loserIds.length === 0) return;
		bulkBusy = true;
		bulkErr = null;
		try {
			await applyContactMerge(res.survivorId, res.loserIds, res.resolved);
			selected = new Set();
			mergeOpen = false;
			await invalidate('crm:contacts');
		} catch {
			bulkErr = m.crm_bulk_failed();
		} finally {
			bulkBusy = false;
		}
	}
	async function runDelete() {
		bulkBusy = true;
		bulkErr = null;
		try {
			const res = await Promise.all(deleteIds.map((id) => fetch(`/api/crm/contacts/${id}`, { method: 'DELETE' })));
			if (res.some((r) => !r.ok)) throw new Error('delete');
			selected = new Set();
			deleteOpen = false;
			await invalidate('crm:contacts');
		} catch {
			bulkErr = m.crm_bulk_failed();
		} finally {
			bulkBusy = false;
		}
	}
</script>

<svelte:head><title>{m.crm_nav_customers()} — {m.crm_title()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.crm_nav_customers()} subtitle={m.crm_subtitle()}>
		{#snippet leading()}<Contact size={16} class="text-accent shrink-0" />{/snippet}
	</PageHeader>

	<DataTable
		class="flex-1 min-h-0"
		{columns}
		data={filtered}
		getRowId={(c) => c.contact_id}
		searchPlaceholder={m.crm_search_placeholder()}
		searchFields={(c) => contactLabel(c.display_name)}
		bind:search={searchQuery}
		{initialFilters}
		initialSort={{ key: 'score', dir: 'desc' }}
		selectable
		bind:selectedIds={selected}
		{bulkActions}
		exportable={canAct('crm', 'export')}
		exportName="customers"
		storageKey={`crm-customers:${data.orgId ?? 'default'}`}
		onRowClick={(c) => goto(`/crm/${c.contact_id}`)}
		addLabel={m.crm_new_contact()}
		onAdd={newContact}
		addDisabled={creating || !canAct('crm', 'edit')}
		emptyMessage={m.crm_empty_title()}
	>
		{#snippet toolbar()}
			<select bind:value={tagId} class="h-7 px-2 text-xs rounded-[var(--radius-sm)] bg-bg3 border border-[var(--hairline)]">
				<option value="">{m.crm_all_tags()}</option>
				{#each tags as tg (tg.id)}<option value={tg.id}>{tg.name}</option>{/each}
			</select>
			{#if data.financeEnabled}
				<button class="res-toggle" class:active={reservedFilter} onclick={() => (reservedFilter = !reservedFilter)} title={m.crm_reserved_only()}>
					{m.crm_reserved_badge()}
				</button>
			{/if}
			<button class="await-toggle" class:active={awaitingFilter} onclick={() => (awaitingFilter = !awaitingFilter)} title={m.crm_awaiting_hint()}>
				{m.crm_awaiting_filter()}
			</button>
			{#if scoreActive}
				<button class="chip" onclick={() => { scoreMin = null; scoreMax = null; }} title={m.crm_filter_clear()}>
					{m.crm_filter_score({ min: scoreMin ?? 0, max: scoreMax ?? 100 })} <X size={11} />
				</button>
			{/if}
			{#if tempFilter}
				<button class="chip" onclick={() => (tempFilter = '')} title={m.crm_filter_clear()}>
					{m.crm_filter_temp({ temp: tempFilter })} <X size={11} />
				</button>
			{/if}
		{/snippet}

		{#snippet actions()}
			<Button variant="outline" size="sm" onclick={syncNow} disabled={syncing || !canAct('crm', 'edit')} title={canAct('crm', 'edit') ? undefined : m.no_permission()}>
				<RefreshCw size={14} class={syncing ? 'animate-spin' : ''} />
				{syncing ? m.crm_syncing() : m.crm_sync_now()}
			</Button>
		{/snippet}

		{#snippet cell(c: Row, col: DataColumn<Row>)}
			{#if col.key === 'name'}
				<div class="font-medium truncate max-w-[24rem]" title={contactLabel(c.display_name)}>
					<Highlight text={contactLabel(c.display_name)} query={searchQuery} />
				</div>
				{#if c.source === 'manual'}<span class="t-caption">{m.crm_source_manual()}</span>{/if}
			{:else if col.key === 'score'}
				<ScoreCell score={c.score} r={c.r_score} f={c.f_score} m={c.m_score} />
			{:else if col.key === 'stage'}
				<StagePill stage={c.stage} overridden={false} />
			{:else if col.key === 'funnel'}
				<div class="flex items-center gap-1">
					<FunnelStagePill stage={funnelOf(c)} />
					{#if reservedOnly(c)}<span class="res-pill" title={m.crm_reserved_only()}>{m.crm_reserved_badge()}</span>{/if}
				</div>
			{:else if col.key.startsWith('meta:')}
				{@const v = metaDisplay(col.key.slice(5), c.custom_fields?.[col.key.slice(5)])}
				<span class="meta-cell" title={v}>{v || '—'}</span>
			{:else if col.key === 'revenue'}
				<span class="t-caption tabular-nums">{finOf(c) ? finOf(c)!.revenue.toLocaleString() : '—'}</span>
			{:else if col.key === 'invoices'}
				<span class="t-caption tabular-nums">{finOf(c) ? finOf(c)!.invoices : '—'}</span>
			{:else if col.key === 'lastPurchase'}
				<span class="t-caption">{finOf(c)?.lastPurchaseAt ? relativeTime(finOf(c)!.lastPurchaseAt!) : '—'}</span>
			{:else if col.key === 'channels'}
				{#if c.channels && c.channels.length > 0}
					<div class="flex items-center justify-end gap-1.5 text-muted-foreground">
						{#each c.channels as ch (ch)}<ChannelBrandIcon channel={ch} size={15} />{/each}
					</div>
				{:else}
					<div class="text-right text-muted-foreground">—</div>
				{/if}
			{:else if col.key === 'msgs'}
				<div class="msgs">
					{#if c.awaiting_reply}<span class="await-dot" title={m.crm_awaiting_hint()}></span>{/if}
					<span class="m-in" title={m.crm_inbound_value({ count: c.inbound_msgs })}><ArrowDown size={11} />{c.inbound_msgs}</span>
					<span class="m-out" title={m.crm_outbound_value({ count: c.total_msgs - c.inbound_msgs })}><ArrowUp size={11} />{c.total_msgs - c.inbound_msgs}</span>
				</div>
			{:else if col.key === 'recent'}
				<span class="t-caption">{relativeTime(c.last_contact_at)}</span>
			{/if}
		{/snippet}

		{#snippet filterOptionIcon(v)}<ChannelBrandIcon channel={v} size={14} />{/snippet}
	</DataTable>
</div>

<CrmMergeResolver bind:open={mergeOpen} contacts={mergeContacts} fields={mergeFields} busy={bulkBusy} error={bulkErr} onConfirm={runMerge} />

<Modal bind:open={deleteOpen} title={m.crm_bulk_delete_title()}>
	<p class="t-body">{m.crm_bulk_delete_confirm({ n: deleteIds.length })}</p>
	{#if bulkErr}<p class="err-msg">{bulkErr}</p>{/if}
	{#snippet footer()}
		<Button variant="outline" size="sm" onclick={() => (deleteOpen = false)}>{m.common_cancel()}</Button>
		<Button variant="danger" size="sm" onclick={runDelete} disabled={bulkBusy}>{m.crm_bulk_delete_btn()}</Button>
	{/snippet}
</Modal>

<style>
	.err-msg { font-size: 0.8rem; color: var(--color-destructive); margin-top: 0.5rem; }
	.res-toggle {
		display: inline-flex; align-items: center; height: 1.5rem; padding: 0 0.55rem;
		font-size: 0.72rem; font-weight: 600; border-radius: 999px;
		border: 1px solid var(--color-warning); color: var(--color-warning);
		background: transparent; cursor: pointer; white-space: nowrap;
		transition: background-color var(--duration-fast) var(--ease-standard);
	}
	.res-toggle:hover { background: color-mix(in srgb, var(--color-warning) 12%, transparent); }
	.res-toggle.active { background: color-mix(in srgb, var(--color-warning) 20%, transparent); }
	.res-pill {
		display: inline-flex; align-items: center; padding: 0.05rem 0.4rem;
		font-size: 0.66rem; font-weight: 600; border-radius: 999px;
		color: var(--color-warning); background: color-mix(in srgb, var(--color-warning) 15%, transparent);
		white-space: nowrap;
	}
	.await-toggle {
		display: inline-flex; align-items: center; height: 1.5rem; padding: 0 0.55rem;
		font-size: 0.72rem; font-weight: 600; border-radius: 999px;
		border: 1px solid var(--color-accent); color: var(--color-accent);
		background: transparent; cursor: pointer; white-space: nowrap;
		transition: background-color var(--duration-fast) var(--ease-standard);
	}
	.await-toggle:hover { background: color-mix(in srgb, var(--color-accent) 12%, transparent); }
	.await-toggle.active { background: color-mix(in srgb, var(--color-accent) 20%, transparent); }
	.await-dot {
		width: 0.45rem; height: 0.45rem; border-radius: 999px; flex-shrink: 0;
		background: var(--color-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 25%, transparent);
	}
	.chip {
		display: inline-flex; align-items: center; gap: 0.3rem; height: 1.5rem; padding: 0 0.45rem 0 0.55rem;
		font-size: 0.72rem; font-weight: 600; border-radius: 999px;
		border: 1px solid var(--color-accent); color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
		white-space: nowrap; text-transform: capitalize;
	}
	.chip:hover { background: color-mix(in srgb, var(--color-accent) 24%, transparent); }
	.msgs { display: flex; align-items: center; justify-content: flex-end; gap: 0.6rem; font-variant-numeric: tabular-nums; }
	.m-in { display: inline-flex; align-items: center; gap: 0.1rem; color: var(--color-emerald, var(--color-success)); }
	.m-out { display: inline-flex; align-items: center; gap: 0.1rem; color: var(--color-muted-foreground); }
	.meta-cell { display: inline-block; max-width: 14rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-muted-foreground); }
</style>
