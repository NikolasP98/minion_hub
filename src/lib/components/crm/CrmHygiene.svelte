<script lang="ts">
	import { invalidate } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';
	import { SvelteSet } from 'svelte/reactivity';
	import {
		Sparkles, Check, GitMerge, Users, Wand2, Crown, Minus, Loader2,
		CaseSensitive, CaseLower, CaseUpper, Space, SeparatorHorizontal,
		Smile, Brackets, Asterisk, AtSign, TextQuote, CircleSlash, Tag,
	} from 'lucide-svelte';
	import { Button } from '$lib/components/ui';
	import { contactLabel } from '$lib/components/crm/crm-format';
	import CrmMergeModal from '$lib/components/crm/CrmMergeModal.svelte';
	import { applyContactMerge, type MergeField } from '$lib/components/crm/crm-merge';

	type Fix = {
		contactId: string;
		current: string | null;
		proposed: string | null;
		issues: string[];
		needsReview: boolean;
	};
	type ContactIdentity = { channel: string; value: string };
	type DupContact = { id: string; name: string | null; dni?: string | null; phone?: string | null; messages: number; identities?: ContactIdentity[] };
	type DupGroup = { key: string; reason: string; contacts: DupContact[]; confidence: number };
	type Blank = { id: string; name: string | null; dni?: string | null; phone?: string | null; messages: number; identities?: ContactIdentity[] };

	let { fixes, groups, blanks = [] }: { fixes: Fix[]; groups: DupGroup[]; blanks?: Blank[] } = $props();

	// ── Identity Cleanup rows (local editable state) ──
	type Row = {
		contactId: string;
		current: string | null;
		value: string; // name to apply (editable, agent can adjust)
		issues: string[];
		needsReview: boolean;
		agentAction?: 'keep' | 'adjust' | 'flag';
		agentNote?: string;
		done?: boolean; // applied this session — stays visible (green) until reload, not re-counted
	};
	// Seed editable rows once from the prop (a fresh load re-runs this module).
	// svelte-ignore state_referenced_locally
	let rows = $state<Row[]>(
		fixes.map((f) => ({
			contactId: f.contactId,
			current: f.current,
			value: f.proposed ?? '',
			issues: f.issues,
			needsReview: f.needsReview,
		})),
	);

	let reviewing = $state(false);
	let applyingBatch = $state(false);
	const pending = new SvelteSet<string>(); // contactIds with an apply in flight (per-row)

	// ── Selection: per-row by default; batch mode once anything is selected ──
	const selected = new SvelteSet<string>();
	let anchor = $state<number | null>(null); // last clicked index, for shift-range
	const batchMode = $derived(selected.size > 0);
	const selectableCount = $derived(rows.filter((r) => !r.done).length);
	const allSelected = $derived(selectableCount > 0 && selected.size === selectableCount);
	const someSelected = $derived(selected.size > 0 && !allSelected);
	const canApply = (r: Row) => !r.done && !!r.value.trim() && r.value.trim() !== (r.current ?? '');
	const applyCount = $derived(rows.filter((r) => selected.has(r.contactId) && canApply(r)).length);

	function toggleAll() {
		if (allSelected) selected.clear();
		else for (const r of rows) if (!r.done) selected.add(r.contactId);
	}
	// Excel-style: plain click (in batch mode) = single; ctrl = toggle one; shift = range from anchor.
	// Done rows are inert — never selectable.
	function rowSelect(e: MouseEvent, i: number) {
		e.preventDefault(); // don't text-select on shift-click
		if (rows[i].done) return;
		const id = rows[i].contactId;
		if (e.shiftKey) {
			const a = anchor ?? i;
			const [lo, hi] = a <= i ? [a, i] : [i, a];
			for (let k = lo; k <= hi; k++) if (!rows[k].done) selected.add(rows[k].contactId);
			if (anchor === null) anchor = a;
		} else if (e.ctrlKey || e.metaKey) {
			if (selected.has(id)) selected.delete(id);
			else selected.add(id);
			anchor = i;
		} else if (batchMode) {
			selected.clear();
			selected.add(id);
			anchor = i;
		} else {
			anchor = i; // per-row mode: plain click is a no-op for selection
		}
	}

	async function applyRows(ids: string[], batch = false) {
		const want = new Set(ids);
		const acting = rows.filter((r) => want.has(r.contactId) && canApply(r));
		if (acting.length === 0) return;
		const fixesToApply = acting.map((r) => ({ contactId: r.contactId, name: r.value.trim(), before: r.current }));
		const actingIds = new Set(acting.map((r) => r.contactId));
		// Per-row in-flight is tracked per id so one apply never disables the rest.
		if (batch) applyingBatch = true;
		else for (const id of actingIds) pending.add(id);
		try {
			const res = await fetch('/api/crm/cleanup/standardize', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ fixes: fixesToApply }),
			});
			if (res.ok) {
				// Mark done in place (green, disabled) — the list never jumps mid-review.
				// They won't return on the next reload (display_name is updated server-side).
				rows = rows.map((r) => (actingIds.has(r.contactId) ? { ...r, done: true } : r));
				for (const id of actingIds) selected.delete(id);
			}
		} finally {
			if (batch) applyingBatch = false;
			else for (const id of actingIds) pending.delete(id);
		}
	}
	const applyAll = () => applyRows([...selected], true);

	async function runReview() {
		reviewing = true;
		try {
			const items = rows.map((r) => ({ id: r.contactId, current: r.current, proposed: r.value }));
			const res = await fetch('/api/crm/cleanup/review', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ items }),
			});
			if (!res.ok) return;
			const { results } = await res.json();
			const byId = new Map(results.map((x: { id: string }) => [x.id, x]));
			rows = rows.map((r) => {
				const v = byId.get(r.contactId) as
					| { name: string; action: 'keep' | 'adjust' | 'flag'; note: string }
					| undefined;
				if (!v) return r;
				return {
					...r,
					value: v.action === 'flag' ? '' : v.name || r.value,
					agentAction: v.action,
					agentNote: v.note,
				};
			});
		} finally {
			reviewing = false;
		}
	}

	// ── Needs a name (blank / 1-char contacts, manual) ──
	type BlankRow = Blank & { value: string; done?: boolean };
	// svelte-ignore state_referenced_locally
	let blankRows = $state<BlankRow[]>(blanks.map((b) => ({ ...b, value: '' })));
	const blankPending = new SvelteSet<string>();

	async function applyBlank(b: BlankRow) {
		const name = b.value.trim();
		if (!name || b.done) return;
		blankPending.add(b.id);
		try {
			const res = await fetch('/api/crm/cleanup/standardize', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ fixes: [{ contactId: b.id, name, before: b.name }] }),
			});
			if (res.ok) blankRows = blankRows.map((r) => (r.id === b.id ? { ...r, done: true } : r));
		} finally {
			blankPending.delete(b.id);
		}
	}

	// ── Duplicates ──
	// survivor chosen per group key; defaults to the member with the most history.
	let chosen = $state<Record<string, string>>({});
	let merging = $state<string | null>(null);
	function survivorId(g: DupGroup): string {
		return chosen[g.key] || [...g.contacts].sort((a, b) => b.messages - a.messages)[0]?.id || '';
	}
	const pickSurvivor = (g: DupGroup, id: string) => (chosen = { ...chosen, [g.key]: id });

	// Merge → custom survivor-picker modal (was a native confirm()).
	let mergeOpen = $state(false);
	let pendingGroup = $state<DupGroup | null>(null);
	let mergeSurvivor = $state('');
	let mergeErr = $state<string | null>(null);
	const mergeContacts = $derived(
		(pendingGroup?.contacts ?? []).map((c) => ({
			id: c.id,
			name: contactLabel(c.name),
			subtitle: m.crm_msgs_n({ count: c.messages }),
		})),
	);
	// Resolvable fields for this duplicate group: name + DNI + phone (the values the
	// group surfaces). The modal shows only the ones that actually conflict.
	const mergeFields = $derived.by<MergeField[]>(() => {
		const cs = pendingGroup?.contacts ?? [];
		const field = (key: string, label: string, get: (c: DupContact) => string | null | undefined): MergeField => ({
			key,
			label,
			values: cs.map((c) => ({ contactId: c.id, value: (get(c) ?? '').toString().trim() })).filter((v) => v.value),
		});
		// name + DNI only — phone identities already union server-side on merge, and
		// its custom_fields key is provider-specific, so we don't risk writing a wrong one.
		return [
			field('display_name', m.crm_col_contact(), (c) => c.name),
			field('dni', 'DNI', (c) => c.dni),
		].filter((f) => f.values.length > 0);
	});

	function openMerge(g: DupGroup) {
		pendingGroup = g;
		mergeSurvivor = survivorId(g);
		mergeErr = null;
		mergeOpen = true;
	}

	async function runMerge(resolved: Record<string, string>) {
		const g = pendingGroup;
		if (!g || !mergeSurvivor) return;
		const loserIds = g.contacts.map((c) => c.id).filter((id) => id !== mergeSurvivor);
		if (loserIds.length === 0) return;
		merging = g.key;
		mergeErr = null;
		try {
			await applyContactMerge(mergeSurvivor, loserIds, resolved);
			pickSurvivor(g, mergeSurvivor); // keep the inline picker in sync
			mergeOpen = false;
			pendingGroup = null;
			await invalidate('crm:cleanup');
		} catch {
			mergeErr = m.crm_bulk_failed();
		} finally {
			merging = null;
		}
	}

	function issueLabel(iss: string): string {
		switch (iss) {
			case 'email_as_name': return m.crm_issue_email_as_name();
			case 'lowercase': return m.crm_issue_lowercase();
			case 'uppercase': return m.crm_issue_uppercase();
			case 'whitespace': return m.crm_issue_whitespace();
			case 'casing': return m.crm_issue_casing();
			case 'too_long': return m.crm_issue_too_long();
			case 'empty': return m.crm_issue_empty();
			case 'emoji': return m.crm_issue_emoji();
			case 'wrapped': return m.crm_issue_wrapped();
			case 'spacing': return m.crm_issue_spacing();
			case 'symbols': return m.crm_issue_symbols();
			default: return iss;
		}
	}
	function issueIcon(iss: string) {
		switch (iss) {
			case 'casing': return CaseSensitive;
			case 'lowercase': return CaseLower;
			case 'uppercase': return CaseUpper;
			case 'whitespace': return Space;
			case 'spacing': return SeparatorHorizontal;
			case 'emoji': return Smile;
			case 'wrapped': return Brackets;
			case 'symbols': return Asterisk;
			case 'email_as_name': return AtSign;
			case 'too_long': return TextQuote;
			case 'empty': return CircleSlash;
			default: return Tag;
		}
	}
	function actionLabel(a: string): string {
		return a === 'keep' ? m.crm_action_keep() : a === 'adjust' ? m.crm_action_adjust() : a === 'flag' ? m.crm_action_flag() : a;
	}
	const aiTitle = (r: Row) =>
		`${m.crm_ai_label()}: ${actionLabel(r.agentAction ?? '')}${r.agentNote ? ' — ' + r.agentNote : ''}`;
</script>

<div class="flex flex-col gap-6 max-w-5xl">
	<!-- Identity Cleanup -->
	<section class="card">
		<header class="sec-h">
			<div class="flex items-center gap-2">
				<button
					class="selall"
					role="checkbox"
					aria-checked={allSelected ? 'true' : someSelected ? 'mixed' : 'false'}
					title={m.crm_select_all()}
					onclick={toggleAll}
					disabled={rows.length === 0}
				>
					{#if allSelected}<Check size={11} strokeWidth={3} />{:else if someSelected}<Minus size={11} strokeWidth={3} />{:else}<Check size={11} class="ghost" />{/if}
				</button>
				<Wand2 size={16} class="text-accent" /><span>{m.crm_standardize_names()} ({rows.length})</span>
			</div>
			<div class="flex items-center gap-2">
				<Button variant="outline" size="sm" onclick={runReview} disabled={reviewing || rows.length === 0}>
					<Sparkles size={14} class={reviewing ? 'animate-pulse' : ''} />
					{reviewing ? m.crm_reviewing() : m.crm_ai_review()}
				</Button>
				{#if batchMode}
					<Button variant="primary" size="sm" onclick={applyAll} disabled={applyingBatch || applyCount === 0}>
						<Check size={14} /> {m.crm_apply()} {applyCount}
					</Button>
				{/if}
			</div>
		</header>

		{#if rows.length === 0}
			<p class="t-caption py-3">{m.crm_all_clean()}</p>
		{:else}
			<p class="t-caption mb-2">{m.crm_standardize_hint()}</p>
			<div class="rows" class:batch={batchMode}>
				{#each rows as r, i (r.contactId)}
					{@const sel = selected.has(r.contactId)}
					{@const selPrev = i > 0 && selected.has(rows[i - 1].contactId)}
					{@const selNext = i < rows.length - 1 && selected.has(rows[i + 1].contactId)}
					<div class="row" class:flagged={r.agentAction === 'flag' && !r.done} class:done={r.done} class:sel class:sel-first={sel && !selPrev} class:sel-last={sel && !selNext}>
						<button type="button" class="asis" onmousedown={(e) => rowSelect(e, i)} onclick={(e) => e.preventDefault()}>
							<span class="cur" title={r.current ?? ''}>{r.current || m.crm_blank()}</span>
							<span class="findings">
								{#each r.issues as iss (iss)}
									{@const Icon = issueIcon(iss)}
									<span class="fi" title={issueLabel(iss)}><Icon size={13} /></span>
								{/each}
								{#if r.agentAction}<span class="fi ai" class:flag={r.agentAction === 'flag'} title={aiTitle(r)}><Sparkles size={13} /></span>{/if}
							</span>
						</button>
						<div class="arrow">→</div>
						<input bind:value={r.value} class="prop" placeholder={m.crm_clear()} disabled={r.done} />
						{#if r.done}
							<span class="row-done" title={m.crm_applied()}><Check size={15} /></span>
						{:else if !batchMode}
							<button class="row-apply" title={m.crm_apply_row()} onclick={() => applyRows([r.contactId])} disabled={pending.has(r.contactId) || !canApply(r)}>
								{#if pending.has(r.contactId)}<Loader2 size={15} class="animate-spin" />{:else}<Check size={15} />{/if}
							</button>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Needs a name (blank / 1-char, manual) -->
	{#if blankRows.length > 0}
		<section class="card">
			<header class="sec-h">
				<div class="flex items-center gap-2"><CircleSlash size={16} class="text-accent" /><span>{m.crm_blanks_title()} ({blankRows.length})</span></div>
			</header>
			<p class="t-caption mb-2">{m.crm_blanks_hint()}</p>
			<div class="rows">
				{#each blankRows as b (b.id)}
					<div class="brow" class:done={b.done}>
						<div class="bmeta">
							<span class="cur" title={b.name ?? ''}>{b.name || m.crm_blank()}</span>
							<div class="dup-meta">
								{#if b.dni}<span class="t-caption">DNI {b.dni}</span>{/if}
								{#if b.phone}<span class="t-caption">📞 {b.phone}</span>{/if}
								{#each b.identities ?? [] as id (id.channel + id.value)}<span class="t-caption ident">{id.channel}: {id.value}</span>{/each}
								<span class="t-caption">{m.crm_msgs_n({ count: b.messages })}</span>
							</div>
						</div>
						<input
							bind:value={b.value}
							class="prop"
							placeholder={m.crm_blanks_placeholder()}
							disabled={b.done}
							onkeydown={(e) => e.key === 'Enter' && applyBlank(b)}
						/>
						{#if b.done}
							<span class="row-done" title={m.crm_applied()}><Check size={15} /></span>
						{:else}
							<button class="row-apply" title={m.crm_apply_row()} onclick={() => applyBlank(b)} disabled={blankPending.has(b.id) || !b.value.trim()}>
								{#if blankPending.has(b.id)}<Loader2 size={15} class="animate-spin" />{:else}<Check size={15} />{/if}
							</button>
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Duplicates -->
	<section class="card">
		<header class="sec-h">
			<div class="flex items-center gap-2"><Users size={16} class="text-accent" /><span>{m.crm_possible_duplicates()} ({groups.length})</span></div>
		</header>
		{#if groups.length === 0}
			<p class="t-caption py-3">{m.crm_no_duplicates()}</p>
		{:else}
			<p class="t-caption mb-2">{m.crm_duplicates_hint()}</p>
			<div class="flex flex-col gap-3">
				{#each groups as g (g.key)}
					{@const weak = g.confidence < 0.4}
					{@const sid = survivorId(g)}
					<div class="group">
						<div class="group-h">
							<span class="reason">{g.reason === 'dni' ? `DNI ${g.key}` : m.crm_dup_same_name()}</span>
							{#if g.confidence >= 0.7}<span class="badge strong">{m.crm_dup_strong()}</span>{:else if weak}<span class="badge soft">{m.crm_dup_weak()}</span>{/if}
							<Button variant={weak ? 'outline' : 'secondary'} size="sm" class="ml-auto" onclick={() => openMerge(g)} disabled={merging === g.key}>
								<GitMerge size={14} /> {merging === g.key ? m.crm_merging() : m.crm_merge()}
							</Button>
						</div>
						{#each g.contacts as c (c.id)}
							{@const primary = sid === c.id}
							<label class="dup" class:primary>
								<input type="radio" name={`surv-${g.key}`} value={c.id} checked={primary} onchange={() => pickSurvivor(g, c.id)} />
								{#if primary}<Crown size={14} class="text-success" />{:else}<GitMerge size={13} class="text-muted-foreground" />{/if}
								<div class="dup-body">
									<div class="dup-line">
										<span class="dup-name">{contactLabel(c.name)}</span>
										{#if primary}<span class="keep">{m.crm_dup_primary()}</span>{:else}<span class="folds">{m.crm_dup_folds()}</span>{/if}
										<span class="ml-auto t-caption">{m.crm_msgs_n({ count: c.messages })}</span>
									</div>
									<div class="dup-meta">
										{#if c.dni}<span class="t-caption">DNI {c.dni}</span>{/if}
										{#if c.phone}<span class="t-caption">📞 {c.phone}</span>{/if}
										{#each c.identities ?? [] as id (id.channel + id.value)}<span class="t-caption ident">{id.channel}: {id.value}</span>{/each}
										{#if !c.dni && !c.phone && (c.identities ?? []).length === 0}<span class="t-caption italic">{m.crm_blank()}</span>{/if}
									</div>
								</div>
							</label>
						{/each}
						<p class="summary t-caption">{m.crm_dup_merge_summary({ count: g.contacts.length - 1 })}</p>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>

<CrmMergeModal
	bind:open={mergeOpen}
	contacts={mergeContacts}
	fields={mergeFields}
	bind:survivorId={mergeSurvivor}
	busy={merging !== null}
	error={mergeErr}
	onConfirm={runMerge}
/>

<style>
	.card { border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); padding: 0.85rem 1rem; }
	.sec-h { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; font-weight: 600; margin-bottom: 0.5rem; }

	/* round tri-state select-all */
	.selall { width: 17px; height: 17px; border-radius: 999px; border: 1.5px solid var(--color-accent); display: grid; place-items: center; background: transparent; color: var(--color-accent); cursor: pointer; padding: 0; flex-shrink: 0; }
	.selall[aria-checked='true'], .selall[aria-checked='mixed'] { background: var(--color-accent); color: var(--color-bg); }
	.selall:disabled { opacity: 0.4; cursor: default; }
	.selall :global(.ghost) { opacity: 0.4; }

	.rows { display: flex; flex-direction: column; }
	/* 3 aligned columns — as-is + findings | arrow | to-be | (per-row action) */
	.row { display: grid; grid-template-columns: minmax(0, 1fr) 1.75rem minmax(0, 1fr) auto; align-items: center; gap: 0.5rem; padding: 0.3rem 0.5rem; border-top: 1px solid transparent; }
	.row + .row { border-top-color: var(--hairline); }
	.row.flagged { opacity: 0.6; }
	/* merged Excel-like selection: continuous fill, rounded only at the ends of a run */
	.row.sel { background: color-mix(in srgb, var(--color-accent) 13%, transparent); border-top-color: transparent; }
	.row.sel-first { border-top-left-radius: var(--radius-md); border-top-right-radius: var(--radius-md); }
	.row.sel-last { border-bottom-left-radius: var(--radius-md); border-bottom-right-radius: var(--radius-md); }

	.asis { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; min-width: 0; background: none; border: none; padding: 0; margin: 0; font: inherit; color: inherit; text-align: left; cursor: default; user-select: none; }
	.rows.batch .asis { cursor: pointer; }
	.cur { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.findings { display: flex; align-items: center; gap: 0.2rem; flex-shrink: 0; }
	.fi { display: inline-grid; place-items: center; color: var(--color-warning); }
	.fi.ai { color: var(--color-accent); }
	.fi.ai.flag { color: var(--color-destructive); }
	.arrow { color: var(--color-muted-foreground); text-align: center; }
	.prop { height: 1.9rem; width: 100%; padding: 0 0.5rem; font-size: 0.85rem; border-radius: var(--radius-md); background: var(--color-bg3); border: 1px solid var(--hairline); }
	.row-apply { display: grid; place-items: center; width: 1.9rem; height: 1.9rem; border-radius: var(--radius-md); border: 1px solid var(--hairline); background: var(--color-bg3); color: var(--color-muted-foreground); cursor: pointer; }
	.row-apply:hover:not(:disabled) { color: var(--color-success); border-color: color-mix(in srgb, var(--color-success) 40%, var(--hairline)); }
	.row-apply:disabled { opacity: 0.4; cursor: default; }
	.row-done { display: grid; place-items: center; width: 1.9rem; height: 1.9rem; border-radius: var(--radius-md); color: var(--color-success); }
	/* applied this session — green, stays put until reload */
	.row.done, .brow.done { background: color-mix(in srgb, var(--color-success) 10%, transparent); }
	.row.done .cur, .brow.done .cur { color: var(--color-success); }
	.row.done .prop, .brow.done .prop { border-color: color-mix(in srgb, var(--color-success) 30%, var(--hairline)); opacity: 0.85; }

	/* Needs-a-name rows: metadata | name input | action */
	.brow { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) auto; align-items: center; gap: 0.5rem; padding: 0.3rem 0.5rem; border-top: 1px solid transparent; }
	.brow + .brow { border-top-color: var(--hairline); }
	.bmeta { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }

	.group { border: 1px solid var(--hairline); border-radius: var(--radius-md); padding: 0.5rem 0.7rem; }
	.group-h { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.3rem; }
	.reason { font-size: 0.72rem; font-weight: 600; color: var(--color-muted-foreground); text-transform: uppercase; letter-spacing: 0.03em; }
	.badge { font-size: 0.62rem; padding: 0.05rem 0.4rem; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.03em; }
	.badge.strong { background: color-mix(in srgb, var(--color-success) 16%, transparent); color: var(--color-success); }
	.badge.soft { background: color-mix(in srgb, var(--color-warning) 18%, transparent); color: var(--color-warning); }
	.dup { display: flex; align-items: flex-start; gap: 0.55rem; padding: 0.35rem 0.4rem; border-radius: var(--radius-md); font-size: 0.86rem; cursor: pointer; }
	.dup.primary { background: color-mix(in srgb, var(--color-success) 8%, transparent); }
	.dup:not(.primary) { opacity: 0.72; }
	.dup-body { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; flex: 1; }
	.dup-line { display: flex; align-items: center; gap: 0.5rem; }
	.dup-meta { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
	.ident { padding: 0.02rem 0.35rem; border-radius: var(--radius-sm); background: var(--color-bg3); }
	.dup-name { font-weight: 500; }
	.keep { font-size: 0.64rem; padding: 0.05rem 0.4rem; border-radius: 999px; background: color-mix(in srgb, var(--color-success) 18%, transparent); color: var(--color-success); }
	.folds { font-size: 0.64rem; color: var(--color-muted-foreground); }
	.summary { margin: 0.35rem 0 0; opacity: 0.75; }
</style>
