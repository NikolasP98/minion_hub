<script lang="ts">
	import type { PageData } from './$types';
	import { goto, invalidate } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';
	import { ArrowLeft, Trash2, Plus, X, MoreVertical, Pencil, Check, Sparkles, RotateCw, ShoppingBag, CalendarClock, MessageCircle, Bookmark } from 'lucide-svelte';
	import { PageHeader, Button } from '$lib/components/ui';
	import EditableGrid from '$lib/components/dashboard/EditableGrid.svelte';
	import { isAdmin } from '$lib/state/features/user.svelte';
	import MathFormula from '$lib/components/ui/MathFormula.svelte';
	import ScoreBadge from '$lib/components/crm/ScoreBadge.svelte';
	import StagePill from '$lib/components/crm/StagePill.svelte';
	import CrmFunnel from '$lib/components/crm/CrmFunnel.svelte';
	import { financeFloorStage } from '$lib/components/crm/crm-funnel';
	import ContactChat from '$lib/components/crm/ContactChat.svelte';
	import CrmSimilarWins from '$lib/components/crm/CrmSimilarWins.svelte';
	import Connections from '$lib/components/crm/Connections.svelte';
	import ChannelBrandIcon from '$lib/components/channels/ChannelBrandIcon.svelte';
	import { contactLabel, isRecencyNever, identityValue, relativeTime } from '$lib/components/crm/crm-format';
	import { stageLabel } from '$lib/components/crm/crm-i18n';
	import { metaLabel, metaValue, metaDisplay, isEmailKey, metaEntries, isReservedMetaKey } from '$lib/components/crm/crm-meta';
	import { IdCard, Cake, Phone, Mail, MapPin, Stethoscope, Megaphone, Hash, User } from 'lucide-svelte';
	import { createBackNav } from '$lib/nav/back-nav.svelte';

	let { data }: { data: PageData } = $props();
	const back = createBackNav('/crm/customers', m.crm_back_to_contacts);
	const c = $derived(data.contact);
	const score = $derived(data.score);
	const stats = $derived(data.stats as Record<string, unknown> | null);
	const contactTags = $derived(data.contactTags);
	const autoTags = $derived(data.autoTags ?? []);
	const availableTags = $derived(
		data.allTags.filter((t) => !data.contactTags.some((ct) => ct.id === t.id)),
	);

	const fields = $derived((c.customFields ?? {}) as Record<string, unknown>);

	// ── Standard details ───────────────────────────────────────────────────────
	// A fixed set of core fields shown for EVERY customer (even when empty) so hub
	// users can spot and fill the gaps. Non-standard custom fields are listed
	// separately below, flagged as "Additional". `name` writes back to the display
	// name (header), `phone` to a `phone` identity (Identities list); the rest are
	// canonical custom_fields keys.
	type StdField = { id: string; label: () => string; icon: typeof User; kind: 'name' | 'phone' | 'cf'; keys: string[] };
	const STD: StdField[] = [
		{ id: 'name', label: m.crm_std_name, icon: User, kind: 'name', keys: [] },
		{ id: 'dni', label: m.crm_std_dni, icon: IdCard, kind: 'cf', keys: ['dni'] },
		{ id: 'phone', label: m.crm_std_phone, icon: Phone, kind: 'phone', keys: ['telefono', 'celular', 'movil', 'tel', 'phone'] },
		{ id: 'email', label: m.crm_std_email, icon: Mail, kind: 'cf', keys: ['email', 'correo'] },
		{ id: 'edad', label: m.crm_std_age, icon: Cake, kind: 'cf', keys: ['edad', 'fecha_nacimiento'] },
		{ id: 'sexo', label: m.crm_std_sex, icon: User, kind: 'cf', keys: ['sexo'] },
		{ id: 'distrito', label: m.crm_std_district, icon: MapPin, kind: 'cf', keys: ['distrito'] },
		{ id: 'motivo', label: m.crm_std_reason, icon: Stethoscope, kind: 'cf', keys: ['motivo'] },
		{ id: 'referencia', label: m.crm_std_referral, icon: Megaphone, kind: 'cf', keys: ['referencia'] },
	];
	const STD_ALIASES = new Set(STD.flatMap((f) => f.keys));

	function cfValue(keys: string[]): string {
		for (const k of keys) {
			const v = fields[k];
			if (v != null && String(v).trim() !== '') return String(v);
		}
		return '';
	}
	function stdValue(f: StdField): string {
		if (f.kind === 'name') return c.displayName ?? '';
		if (f.kind === 'phone') {
			const wa = data.identities.find((i) => i.channel === 'whatsapp');
			if (wa) return identityValue(wa.externalId, wa.handle);
			const ph = data.identities.find((i) => i.channel === 'phone');
			if (ph) return ph.externalId;
			return cfValue(f.keys);
		}
		return cfValue(f.keys);
	}
	// Non-standard, user-facing custom fields → the "Additional" group.
	const additional = $derived(
		metaEntries(fields).filter(([k]) => !STD_ALIASES.has(k.toLowerCase()) && !isReservedMetaKey(k)),
	);

	let editingDetails = $state(false);
	let stdDraft = $state<Record<string, string>>({});
	let addDraft = $state<[string, string][]>([]);
	let newKey = $state('');
	let newVal = $state('');

	function startEditDetails() {
		const d: Record<string, string> = {};
		for (const f of STD) d[f.id] = stdValue(f);
		stdDraft = d;
		addDraft = additional.map(([k, v]) => [k, metaValue(v) === '—' ? '' : String(v)]);
		newKey = '';
		newVal = '';
		editingDetails = true;
	}
	async function saveDetails() {
		// Rebuild custom_fields: preserve reserved + any current non-standard keys
		// we keep, write canonical standard keys, then the edited additional rows.
		const next: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(fields)) if (isReservedMetaKey(k)) next[k] = v;
		// standard cf fields → canonical key (clear stale aliases by simply not copying them)
		for (const f of STD) {
			if (f.kind === 'cf') {
				const val = (stdDraft[f.id] ?? '').trim();
				if (val) next[f.keys[0]] = val;
			}
		}
		// phone mirrored into custom_fields too (canonical 'telefono')
		const phone = (stdDraft.phone ?? '').trim();
		if (phone) next['telefono'] = phone;
		// additional rows (non-standard)
		for (const [k, v] of addDraft) {
			const key = k.trim();
			if (key && !isReservedMetaKey(key) && !STD_ALIASES.has(key.toLowerCase())) next[key] = v;
		}
		if (newKey.trim() && !isReservedMetaKey(newKey.trim()) && !STD_ALIASES.has(newKey.trim().toLowerCase()))
			next[newKey.trim()] = newVal;

		const body: Record<string, unknown> = { customFields: next, phone };
		const name = (stdDraft.name ?? '').trim();
		if (name !== (c.displayName ?? '')) body.displayName = name || null;
		await patch(body);
		editingDetails = false;
	}
	function removeAddRow(i: number) {
		addDraft = addDraft.filter((_, idx) => idx !== i);
	}

	const STAGES = ['New', 'Engaged', 'Active', 'Dormant', 'Churned'];
	let noteBody = $state('');
	let busy = $state(false);
	let menuOpen = $state(false);

	const texSymbolic = '\\text{Score} = 0.5\\,R + 0.3\\,F + 0.2\\,M';
	const texValues = $derived(
		score ? `= 0.5(${score.r_score}) + 0.3(${score.f_score}) + 0.2(${score.m_score}) = ${score.score}` : '',
	);

	async function patch(body: Record<string, unknown>) {
		busy = true;
		try {
			const res = await fetch(`/api/crm/contacts/${c.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			});
			if (res.ok) await invalidate('crm:contact');
		} finally {
			busy = false;
		}
	}

	async function setStage(e: Event) {
		const v = (e.currentTarget as HTMLSelectElement).value;
		await patch({ lifecycleOverride: v === 'auto' ? null : v });
	}
	async function addTag(tagId: string) {
		if (!tagId) return;
		await fetch(`/api/crm/contacts/${c.id}/tags`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ tagId }),
		});
		await invalidate('crm:contact');
	}
	async function removeTag(tagId: string) {
		await fetch(`/api/crm/contacts/${c.id}/tags?tagId=${tagId}`, { method: 'DELETE' });
		await invalidate('crm:contact');
	}
	async function addNote() {
		const body = noteBody.trim();
		if (!body) return;
		busy = true;
		try {
			const res = await fetch(`/api/crm/contacts/${c.id}/notes`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ body }),
			});
			if (res.ok) {
				noteBody = '';
				await invalidate('crm:contact');
			}
		} finally {
			busy = false;
		}
	}
	async function forget() {
		if (!confirm(m.crm_forget_confirm())) return;
		const res = await fetch(`/api/crm/contacts/${c.id}?hard=true`, { method: 'DELETE' });
		if (res.ok) await goto('/crm/customers');
	}

	// ── Journey map (milestones) ─────────────────────────────────────────────
	type Milestone = { id: string; type: string; label: string; at: string | null; detail?: string | null };
	const journey = $derived((data.journey ?? []) as Milestone[]); // already newest-first
	let analyzingJourney = $state(false);
	async function analyzeJourney() {
		if (analyzingJourney) return;
		analyzingJourney = true;
		try {
			const res = await fetch(`/api/crm/contacts/${c.id}/journey/analyze`, { method: 'POST' });
			if (res.ok) await invalidate('crm:contact');
		} finally {
			analyzingJourney = false;
		}
	}
	// ── Notes + channel messages (from the contact timeline) ──────────────────
	type TRow = { kind?: string; channel?: string | null; body?: string | null; occurred_at?: string };
	const timeline = $derived((data.timeline ?? []) as TRow[]);
	const notes = $derived(timeline.filter((r) => r.kind === 'note' && (r.body ?? '').trim().length > 0)); // newest-first
	// One tab per LINKED IDENTITY (channels never combine); no "All".
	let channelTab = $state('');
	$effect(() => {
		if (!channelTab && data.identities.length) channelTab = data.identities[0].channel;
	});
	const channelMsgs = $derived(timeline.filter((r) => r.kind === 'message' && r.channel === channelTab));

	// Near-realtime: refresh the contact timeline while the page is open and visible.
	// ponytail: 12s poll over Supabase realtime/WS — simplest live-update that needs no new infra.
	$effect(() => {
		const iv = setInterval(() => {
			if (!document.hidden) invalidate('crm:contact');
		}, 12000);
		return () => clearInterval(iv);
	});

	// ── Left-column layout (EditableGrid; one shared layout for the detail page) ─
	// Default widths exploit the wider (2:1) left column: details spans full,
	// the rest default to half (2 subcolumns). Users can re-layout per-card.
	const gridItems = $derived(
		[
			{ id: 'details', w: 4, h: 4 },
			data.connections?.length ? { id: 'connections', w: 2, h: 2 } : null,
			{ id: 'score', w: 2, h: 2 },
			{ id: 'lifecycle', w: 2, h: 2 },
			{ id: 'funnel', w: 2, h: 3 },
			{ id: 'identities', w: 2, h: 1 },
			data.finance ? { id: 'financials', w: 2, h: 2 } : null,
			data.finance ? { id: 'wins', w: 2, h: 2 } : null,
		].filter((x): x is { id: string; w: number; h: number } => x !== null),
	);
</script>

<svelte:head><title>{contactLabel(c.displayName)} — {m.crm_title()}</title></svelte:head>

{#snippet detailsCard()}
	<section class="card">
		<header class="card-h">
			<span>{m.crm_details()}</span>
			{#if !editingDetails}
				<div class="menu-wrap">
					<button class="kebab kebab-sm" onclick={() => (menuOpen = !menuOpen)} aria-label={m.crm_actions()} disabled={busy}>
						<MoreVertical size={15} />
					</button>
					{#if menuOpen}
						<button class="backdrop" aria-label="close" onclick={() => (menuOpen = false)}></button>
						<div class="menu">
							<button class="mi" onclick={() => { menuOpen = false; startEditDetails(); }}><Pencil size={14} /> {m.crm_edit_properties()}</button>
							<div class="msep"></div>
							<button class="mi danger" onclick={() => { menuOpen = false; forget(); }}><Trash2 size={14} /> {m.crm_forget()}</button>
						</div>
					{/if}
				</div>
			{/if}
		</header>
		{#if editingDetails}
			<div class="meta-edit">
				{#each STD as f (f.id)}
					{@const Icon = f.icon}
					<div class="std-edit-row">
						<span class="std-ic"><Icon size={14} /></span>
						<label class="std-edit-label" for={`std-${f.id}`}>{f.label()}</label>
						<input id={`std-${f.id}`} class="meta-val" bind:value={stdDraft[f.id]} placeholder={m.crm_field_empty()} />
					</div>
				{/each}
				<div class="add-sep">{m.crm_details_additional()}</div>
				{#each addDraft as row, i (i)}
					<div class="meta-row">
						<input class="meta-key" bind:value={row[0]} placeholder={m.crm_meta_key()} />
						<input class="meta-val" bind:value={row[1]} placeholder={m.crm_meta_value()} />
						<button class="icon-btn" aria-label={m.crm_delete()} onclick={() => removeAddRow(i)}><X size={13} /></button>
					</div>
				{/each}
				<div class="meta-row new">
					<input class="meta-key" bind:value={newKey} placeholder={m.crm_meta_new_key()} />
					<input class="meta-val" bind:value={newVal} placeholder={m.crm_meta_value()} />
					<span class="icon-btn ghost"><Plus size={13} /></span>
				</div>
				<div class="meta-actions">
					<Button variant="primary" size="sm" onclick={saveDetails} disabled={busy}><Check size={14} /> {m.crm_save()}</Button>
					<Button variant="ghost" size="sm" onclick={() => (editingDetails = false)}>{m.crm_cancel()}</Button>
				</div>
			</div>
		{:else}
			<ul class="meta">
				{#each STD as f (f.id)}
					{@const v = stdValue(f)}
					{@const Icon = f.icon}
					<li class="meta-item" class:empty={!v}>
						<span class="meta-ic"><Icon size={14} /></span>
						<span class="meta-k">{f.label()}</span>
						<span class="meta-v" title={v}>{v || m.crm_field_empty()}</span>
					</li>
				{/each}
			</ul>
			{#if additional.length > 0}
				<div class="add-sep">{m.crm_details_additional()}</div>
				<ul class="meta">
					{#each additional as [k, v] (k)}
						<li class="meta-item">
							<span class="meta-ic"><Hash size={14} /></span>
							<span class="meta-k">{metaLabel(k)}</span>
							{#if isEmailKey(k)}
								<a class="meta-v link" href={`mailto:${metaValue(v)}`} title={metaValue(v)}>{metaValue(v)}</a>
							{:else}
								<span class="meta-v" title={metaDisplay(k, v)}>{metaDisplay(k, v)}</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</section>
{/snippet}

{#snippet leftCell(idv: string)}
	{#if idv === 'connections'}
		{#if data.connections?.length}<Connections groups={data.connections} />{/if}
	{:else if idv === 'score'}
		<section class="card">
			<header class="card-h">
				<span>{m.crm_engagement_score()}</span>
				{#if score}
					<div class="score-hover">
						<ScoreBadge score={score.score} r={score.r_score} f={score.f_score} m={score.m_score} />
						<div class="formula-pop" role="tooltip">
							<div class="formula"><MathFormula tex={texSymbolic} /></div>
							<div class="formula sub"><MathFormula tex={texValues} /></div>
						</div>
					</div>
				{/if}
			</header>
			{#if score}
				<dl class="kv">
					<div><dt>{m.crm_recency()}</dt><dd>{isRecencyNever(score.last_days) ? m.crm_recency_never() : m.crm_recency_value({ days: score.last_days })}</dd></div>
					<div><dt>{m.crm_frequency()}</dt><dd>{m.crm_inbound_value({ count: score.inbound_msgs })}</dd></div>
					<div><dt>{m.crm_reciprocity()}</dt><dd>{Math.round(score.reciprocity * 100)}%</dd></div>
					<div><dt>{m.crm_channels()}</dt><dd>{score.channels_used}</dd></div>
				</dl>
			{:else}
				<p class="t-caption">{m.crm_no_score()}</p>
			{/if}
		</section>
	{:else if idv === 'lifecycle'}
		<section class="card">
			<header class="card-h"><span>{m.crm_lifecycle()}</span>{#if score}<StagePill stage={score.stage} overridden={!!c.lifecycleOverride} />{/if}</header>
			<label class="field">
				<span class="t-caption">{m.crm_stage_label()}</span>
				<select value={c.lifecycleOverride ?? 'auto'} onchange={setStage} disabled={busy} class="h-8 px-2 text-sm rounded-[var(--radius-md)] bg-bg3 border border-[var(--hairline)]">
					<option value="auto">{m.crm_stage_auto()}</option>
					{#each STAGES as s (s)}<option value={s}>{stageLabel(s)}</option>{/each}
				</select>
			</label>
			<div class="tags">
				{#each contactTags as t (t.id)}
					<span class="tag" style:--c={t.color ?? 'var(--color-accent)'}>
						{t.name}
						<button onclick={() => removeTag(t.id)} aria-label={m.crm_delete()}><X size={11} /></button>
					</span>
				{/each}
				{#each autoTags as t (t.id)}
					<span class="tag auto" style:--c={t.color ?? 'var(--color-accent)'} title={m.crm_auto_badge()}>
						<Sparkles size={10} />{t.name}
					</span>
				{/each}
				{#if availableTags.length > 0}
					<select class="addtag" onchange={(e) => { addTag((e.currentTarget as HTMLSelectElement).value); e.currentTarget.value = ''; }}>
						<option value="">{m.crm_add_tag()}</option>
						{#each availableTags as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
					</select>
				{/if}
			</div>
		</section>
	{:else if idv === 'funnel'}
		<CrmFunnel contactId={c.id} customFields={fields} inbound={score?.inbound_msgs ?? 0} financeFloor={financeFloorStage(data.finance)} />
	{:else if idv === 'details'}
		{@render detailsCard()}
	{:else if idv === 'identities'}
		<section class="card">
			<header class="card-h"><span>{m.crm_identities()}</span></header>
			<ul class="ids">
				{#each data.identities as id (id.id)}
					<li>
						<span class="chan"><ChannelBrandIcon channel={id.channel} size={14} />{id.channel}</span>
						<span class="ext">{identityValue(id.externalId, id.handle)}</span>
					</li>
				{:else}
					<li class="t-caption">{m.crm_no_identities()}</li>
				{/each}
			</ul>
		</section>
	{:else if idv === 'financials'}
		{#if data.finance}
			<section class="card">
				<header class="card-h"><span>{m.crm_financials_title()}</span></header>
				<dl class="kv">
					<div><dt>{m.crm_col_revenue()}</dt><dd>{data.finance.revenue.toLocaleString()}</dd></div>
					<div><dt>{m.crm_col_invoices()}</dt><dd>{data.finance.invoices}</dd></div>
					<div><dt>{m.crm_col_last_purchase()}</dt><dd>{data.finance.lastPurchaseAt ? relativeTime(data.finance.lastPurchaseAt) : '—'}</dd></div>
				</dl>
				{#if data.finance.recentInvoices.length > 0}
					<p class="fin-recent-h">{m.crm_financials_recent()}</p>
					<ul class="fin-list">
						{#each data.finance.recentInvoices as inv (inv.id)}
							<li class="fin-row">
								<a href="/finances/invoices/{inv.id}" class="fin-doc" title={inv.documentId ?? inv.id}>{inv.item ?? inv.documentId ?? inv.id}</a>
								<span class="fin-date t-caption">{inv.issuedAt ? relativeTime(inv.issuedAt) : '—'}</span>
								<span class="fin-total">{inv.total.toLocaleString()}</span>
								{#if inv.status}<span class="fin-status" data-status={inv.status}>{inv.status}</span>{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}
	{:else if idv === 'wins'}
		{#if data.finance}<CrmSimilarWins contactId={c.id} />{/if}
	{/if}
{/snippet}

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={contactLabel(c.displayName)} subtitle={c.source === 'manual' ? m.crm_manual_contact() : m.crm_harvested()}>
		{#snippet leading()}
			<button class="p-1 -ml-1 rounded hover:bg-white/[0.06]" onclick={back.go} aria-label={m.crm_back_to_contacts()}>
				<ArrowLeft size={16} />
			</button>
		{/snippet}
	</PageHeader>

	<!-- 2 columns at a 1:1 ratio: details (left, scrollable + layout-editable, whose
	     inner cards stack via a container query as the column narrows) | journey +
	     notes + channels (right, full height). Stacks on < lg. -->
	<div class="flex-1 min-h-0 p-4 grid gap-4 grid-cols-1 lg:grid-cols-2 lg:overflow-hidden overflow-auto">
		<div class="left-col min-w-0 lg:min-h-0 lg:overflow-auto">
			<EditableGrid id="crm-contact-detail-v2" items={gridItems} cols={4} rowHeight={96} canSetDefault={isAdmin.value}>
				{#snippet cell(idv)}{@render leftCell(idv)}{/snippet}
			</EditableGrid>
		</div>

		<div class="right-col min-w-0 flex flex-col gap-4 lg:min-h-0">
			<!-- Journey: AI-assisted milestone map, horizontal, newest → left. -->
			<section class="card">
				<header class="card-h">
					<span>{m.crm_journey_map()}</span>
					<button class="reanalyze" onclick={analyzeJourney} disabled={analyzingJourney} title={m.crm_journey_analyze()}>
						{#if analyzingJourney}<RotateCw size={13} class="animate-spin" />{:else}<Sparkles size={13} />{/if}
						<span>{analyzingJourney ? m.crm_journey_analyzing() : m.crm_journey_analyze()}</span>
					</button>
				</header>
				{#if journey.length > 0}
					<div class="jmap">
						{#each journey as ms (ms.id)}
							<div class="jms" data-type={ms.type}>
								<span class="jms-ic">
									{#if ms.type === 'purchase'}<ShoppingBag size={14} />
									{:else if ms.type === 'booking'}<CalendarClock size={14} />
									{:else if ms.type === 'reserve'}<Bookmark size={14} />
									{:else if ms.type === 'ai'}<Sparkles size={14} />
									{:else}<MessageCircle size={14} />{/if}
								</span>
								<span class="jms-label" title={ms.label}>{ms.label}</span>
								{#if ms.detail}<span class="jms-detail">{ms.detail}</span>{/if}
								<span class="jms-date">{ms.at ? relativeTime(ms.at) : ''}</span>
							</div>
						{/each}
					</div>
				{:else}
					<p class="t-caption">{m.crm_journey_empty()}</p>
				{/if}
			</section>

			<!-- Notes: the sole notes container, chat-like, horizontal, newest → left. -->
			<section class="card">
				<header class="card-h"><span>{m.crm_notes_title()}</span></header>
				<div class="note-row">
					<input bind:value={noteBody} placeholder={m.crm_note_placeholder()} class="flex-1 h-8 px-3 text-sm rounded-[var(--radius-md)] bg-bg3 border border-[var(--hairline)]" onkeydown={(e) => e.key === 'Enter' && addNote()} />
					<Button variant="secondary" size="sm" onclick={addNote} disabled={busy || !noteBody.trim()}><Plus size={14} /></Button>
				</div>
				{#if notes.length > 0}
					<div class="notes-strip">
						{#each notes as n (n.occurred_at)}
							<div class="note-card">
								<p class="note-text">{n.body}</p>
								<span class="note-time">{n.occurred_at ? relativeTime(n.occurred_at) : ''}</span>
							</div>
						{/each}
					</div>
				{:else}
					<p class="t-caption mt-2">{m.crm_notes_empty()}</p>
				{/if}
			</section>

			<!-- Channels: one tab per linked identity (icon only); messages per channel. -->
			<section class="card lg:flex-1 lg:min-h-0 flex flex-col">
				<header class="card-h">
					<span>{m.crm_messages_title()}</span>
					<span class="t-caption">{stats ? m.crm_journey_messages({ count: stats.message_count as number }) : ''}</span>
				</header>
				{#if data.identities.length > 0}
					<div class="jtabs">
						{#each data.identities as id (id.id)}
							<button class="jtab" class:on={channelTab === id.channel} onclick={() => (channelTab = id.channel)} title={id.channel} aria-label={id.channel}>
								<ChannelBrandIcon channel={id.channel} size={15} />
							</button>
						{/each}
					</div>
					<ContactChat
						rows={channelMsgs as never}
						contactId={c.id}
						channel={channelTab}
						canSend={data.identities.some((i) => i.channel === channelTab)}
					/>
				{:else}
					<p class="t-caption">{m.crm_no_channels()}</p>
				{/if}
			</section>
		</div>
	</div>
</div>

<style>
	.menu-wrap { position: relative; display: inline-flex; }
	.kebab { display: grid; place-items: center; width: 2rem; height: 2rem; border-radius: var(--radius-md); color: var(--color-foreground); }
	.kebab.kebab-sm { width: 1.6rem; height: 1.6rem; color: var(--color-muted-foreground); }
	.kebab:hover { background: rgba(255, 255, 255, 0.06); }
	.backdrop { position: fixed; inset: 0; z-index: 40; background: transparent; }
	.menu {
		position: absolute; top: calc(100% + 4px); right: 0; z-index: 41; min-width: 11rem;
		background: var(--color-card); border: 1px solid var(--hairline); border-radius: var(--radius-md);
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35); padding: 0.25rem;
	}
	.mi { display: flex; align-items: center; gap: 0.5rem; width: 100%; padding: 0.4rem 0.5rem; border-radius: var(--radius-sm, 6px); font-size: 0.84rem; text-align: left; color: var(--color-foreground); }
	.mi:hover { background: color-mix(in srgb, var(--color-accent) 10%, transparent); }
	.mi.danger { color: var(--color-destructive); }
	.mi.danger:hover { background: color-mix(in srgb, var(--color-destructive) 12%, transparent); }
	.msep { height: 1px; background: var(--hairline); margin: 0.2rem 0; }


	.score-hover { position: relative; display: inline-flex; }
	.formula-pop {
		position: absolute; top: calc(100% + 6px); right: 0; z-index: 30; width: 16rem;
		padding: 0.55rem 0.7rem; background: var(--color-card); border: 1px solid var(--hairline);
		border-radius: var(--radius-md); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
		opacity: 0; transform: translateY(-3px); pointer-events: none; transition: opacity 0.12s, transform 0.12s;
	}
	.score-hover:hover .formula-pop { opacity: 1; transform: translateY(0); }
	.card { border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); padding: 0.85rem 1rem; }
	.card-h { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; font-size: 0.78rem; font-weight: 600; color: var(--color-muted-foreground); text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 0.6rem; }
	.formula { padding: 0.2rem 0; }
	.formula.sub { color: var(--color-muted-foreground); font-size: 0.9em; }
	.kv { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem 1rem; margin-top: 0.75rem; }
	.kv dt { font-size: 0.7rem; color: var(--color-muted-foreground); }
	.kv dd { font-size: 0.9rem; font-weight: 600; font-variant-numeric: tabular-nums; }
	.field { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 0.75rem; }
	.tags { display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center; }
	.tag { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.74rem; color: var(--c); background: color-mix(in srgb, var(--c) 14%, transparent); border: 1px solid color-mix(in srgb, var(--c) 30%, transparent); }
	.tag button { display: grid; place-items: center; opacity: 0.7; }
	.tag button:hover { opacity: 1; }
	.tag.auto { border-style: dashed; opacity: 0.92; }
	.addtag { height: 1.6rem; font-size: 0.74rem; border-radius: 999px; background: var(--color-bg3); border: 1px dashed var(--hairline); padding: 0 0.4rem; }
	.ids { display: flex; flex-direction: column; gap: 0.3rem; }
	.ids li { display: flex; justify-content: space-between; gap: 0.5rem; font-size: 0.84rem; }
	.ids .chan { display: inline-flex; align-items: center; gap: 0.4rem; font-weight: 600; text-transform: capitalize; color: var(--color-muted-foreground); }
	.ids .ext { color: var(--color-muted-foreground); font-variant-numeric: tabular-nums; }
	.note-row { display: flex; gap: 0.5rem; }

	/* re-analyze button (mirrors CrmFunnel) */
	.reanalyze { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.7rem; font-weight: 500; text-transform: none; letter-spacing: 0; color: var(--color-accent); padding: 0.15rem 0.4rem; border-radius: var(--radius-md); }
	.reanalyze:hover { background: color-mix(in srgb, var(--color-accent) 10%, transparent); }
	.reanalyze:disabled { opacity: 0.6; }

	/* Journey map — horizontal milestone strip, newest (first) on the LEFT. */
	.jmap { display: flex; gap: 0.5rem; overflow-x: auto; padding: 0.1rem 0 0.4rem; scrollbar-width: thin; }
	.jms {
		flex: 0 0 auto; width: 9.5rem; min-height: 4.2rem; display: flex; flex-direction: column; gap: 0.2rem;
		padding: 0.5rem 0.6rem; border-radius: var(--radius-md); border: 1px solid var(--hairline);
		background: var(--color-bg3); position: relative;
	}
	.jms-ic { display: grid; place-items: center; width: 1.5rem; height: 1.5rem; border-radius: 999px; color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 12%, transparent); }
	.jms[data-type='purchase'] .jms-ic { color: var(--color-success, #22c55e); background: color-mix(in srgb, var(--color-success, #22c55e) 14%, transparent); }
	.jms[data-type='booking'] .jms-ic { color: var(--color-warning, #f59e0b); background: color-mix(in srgb, var(--color-warning, #f59e0b) 14%, transparent); }
	.jms[data-type='ai'] .jms-ic { color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 16%, transparent); }
	.jms-label { font-size: 0.78rem; font-weight: 600; line-height: 1.2; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
	.jms-detail { font-size: 0.7rem; color: var(--color-muted-foreground); font-variant-numeric: tabular-nums; }
	.jms-date { margin-top: auto; font-size: 0.64rem; color: var(--color-muted-foreground); }

	/* Notes — chat-like horizontal strip, newest (first) on the LEFT. */
	.notes-strip { display: flex; gap: 0.5rem; overflow-x: auto; padding: 0.6rem 0 0.2rem; scrollbar-width: thin; }
	.note-card {
		flex: 0 0 auto; width: 12rem; display: flex; flex-direction: column; gap: 0.3rem;
		padding: 0.5rem 0.6rem; border-radius: 0.7rem; border-bottom-left-radius: 0.2rem;
		background: var(--color-muted); border: 1px solid var(--hairline);
	}
	.note-text { font-size: 0.8rem; line-height: 1.3; white-space: pre-wrap; overflow-wrap: anywhere; }
	.note-time { font-size: 0.62rem; color: var(--color-muted-foreground); }

	/* channel tabs (icon-only; one per linked identity) */
	.jtabs { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-bottom: 0.6rem; }
	.jtab {
		display: inline-grid; place-items: center; width: 2rem; height: 2rem;
		border-radius: var(--radius-md); border: 1px solid var(--hairline);
		color: var(--color-muted-foreground); background: var(--color-bg3);
	}
	.jtab:hover { color: var(--color-foreground); }
	.jtab.on { color: var(--color-accent); border-color: color-mix(in srgb, var(--color-accent) 55%, transparent); background: color-mix(in srgb, var(--color-accent) 12%, transparent); }

	/* custom-field metadata */
	.icon-btn { display: grid; place-items: center; width: 1.6rem; height: 1.6rem; border-radius: var(--radius-md); color: var(--color-muted-foreground); flex-shrink: 0; }
	.icon-btn:hover { background: rgba(255, 255, 255, 0.06); color: var(--color-foreground); }
	.icon-btn.ghost { opacity: 0.4; }
	.meta { display: flex; flex-direction: column; }
	.meta-item { display: grid; grid-template-columns: 1.1rem minmax(4.5rem, max-content) 1fr; align-items: center; gap: 0.55rem; padding: 0.42rem 0; }
	.meta-item + .meta-item { border-top: 1px solid var(--hairline); }
	.meta-item.empty .meta-v { color: var(--color-muted-foreground); opacity: 0.5; font-style: italic; }
	.meta-ic { display: grid; place-items: center; color: var(--color-muted-foreground); opacity: 0.85; }
	.meta-k { font-size: 0.76rem; color: var(--color-muted-foreground); }
	.meta-v { min-width: 0; text-align: right; font-size: 0.86rem; font-weight: 500; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.meta-v.link { color: var(--color-accent); }
	.meta-v.link:hover { text-decoration: underline; }
	.add-sep { font-size: 0.66rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-muted-foreground); opacity: 0.7; margin: 0.7rem 0 0.35rem; padding-top: 0.5rem; border-top: 1px dashed var(--hairline); }
	.meta-edit { display: flex; flex-direction: column; gap: 0.4rem; }
	.std-edit-row { display: grid; grid-template-columns: 1.1rem minmax(4rem, max-content) 1fr; align-items: center; gap: 0.5rem; }
	.std-ic { display: grid; place-items: center; color: var(--color-muted-foreground); }
	.std-edit-label { font-size: 0.76rem; color: var(--color-muted-foreground); }
	.meta-row { display: flex; align-items: center; gap: 0.4rem; }
	.meta-key, .meta-val { height: 1.8rem; padding: 0 0.5rem; font-size: 0.82rem; border-radius: var(--radius-md); background: var(--color-bg3); border: 1px solid var(--hairline); }
	.meta-key { width: 8rem; flex-shrink: 0; text-transform: capitalize; }
	.meta-val { flex: 1; min-width: 0; }
	.meta-row.new { opacity: 0.85; }
	.meta-actions { display: flex; gap: 0.5rem; margin-top: 0.3rem; }

	/* Financials card */
	.fin-recent-h { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: var(--color-muted-foreground); margin: 0.6rem 0 0.35rem; }
	.fin-list { display: flex; flex-direction: column; gap: 0.1rem; }
	.fin-row { display: grid; grid-template-columns: 1fr auto auto auto; align-items: center; gap: 0.5rem; padding: 0.3rem 0; font-size: 0.82rem; border-top: 1px solid var(--hairline); }
	.fin-doc { color: var(--color-accent); font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.fin-doc:hover { text-decoration: underline; }
	.fin-date { color: var(--color-muted-foreground); }
	.fin-total { font-variant-numeric: tabular-nums; font-weight: 500; }
	.fin-status { padding: 0.1rem 0.45rem; border-radius: 999px; font-size: 0.68rem; font-weight: 600; text-transform: capitalize; background: color-mix(in srgb, var(--color-muted-foreground) 15%, transparent); color: var(--color-muted-foreground); }
	.fin-status[data-status='paid'] { background: color-mix(in srgb, var(--color-success, #22c55e) 16%, transparent); color: var(--color-success, #22c55e); }
	.fin-status[data-status='partial'], .fin-status[data-status='pending'] { background: color-mix(in srgb, var(--color-warning, #f59e0b) 16%, transparent); color: var(--color-warning, #f59e0b); }
	.fin-status[data-status='void'] { background: color-mix(in srgb, var(--color-destructive, #ef4444) 14%, transparent); color: var(--color-destructive, #ef4444); }
</style>
