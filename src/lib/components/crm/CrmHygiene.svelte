<script lang="ts">
	import { invalidate } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';
	import { Sparkles, Check, GitMerge, Users, Wand2 } from 'lucide-svelte';
	import { Button } from '$lib/components/ui';
	import { contactLabel } from '$lib/components/crm/crm-format';

	type Fix = {
		contactId: string;
		current: string | null;
		proposed: string | null;
		issues: string[];
		needsReview: boolean;
	};
	type DupContact = { id: string; name: string | null; dni?: string | null; phone?: string | null; messages: number };
	type DupGroup = { key: string; reason: string; contacts: DupContact[] };

	let { fixes, groups }: { fixes: Fix[]; groups: DupGroup[] } = $props();

	// ── Standardization rows (local editable state) ──
	type Row = {
		contactId: string;
		current: string | null;
		value: string; // name to apply (editable, agent can adjust)
		issues: string[];
		needsReview: boolean;
		apply: boolean;
		agentAction?: 'keep' | 'adjust' | 'flag';
		agentNote?: string;
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
			apply: !f.needsReview && (f.proposed ?? '') !== '', // auto-select clear fixes
		})),
	);

	let reviewing = $state(false);
	let applying = $state(false);
	const selectedCount = $derived(rows.filter((r) => r.apply && r.value.trim()).length);

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
					apply: v.action !== 'flag' && !!(v.name || r.value).trim(),
				};
			});
		} finally {
			reviewing = false;
		}
	}

	async function applyAll() {
		applying = true;
		try {
			const fixesToApply = rows
				.filter((r) => r.apply && r.value.trim() && r.value.trim() !== (r.current ?? ''))
				.map((r) => ({ contactId: r.contactId, name: r.value.trim() }));
			if (fixesToApply.length === 0) return;
			const res = await fetch('/api/crm/cleanup/standardize', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ fixes: fixesToApply }),
			});
			if (res.ok) {
				await invalidate('crm:cleanup');
				rows = rows.filter((r) => !(r.apply && r.value.trim()));
			}
		} finally {
			applying = false;
		}
	}

	// ── Duplicates ──
	let survivor = $state<Record<number, string>>({});
	let merging = $state<number | null>(null);
	// default survivor = the member with the most messages (most history)
	$effect(() => {
		const next: Record<number, string> = {};
		groups.forEach((g, i) => {
			if (survivor[i] && g.contacts.some((c) => c.id === survivor[i])) next[i] = survivor[i];
			else next[i] = [...g.contacts].sort((a, b) => b.messages - a.messages)[0]?.id ?? '';
		});
		survivor = next;
	});

	async function mergeGroup(gi: number) {
		const g = groups[gi];
		const survivorId = survivor[gi];
		if (!survivorId) return;
		const loserIds = g.contacts.map((c) => c.id).filter((id) => id !== survivorId);
		if (loserIds.length === 0) return;
		if (
			!confirm(
				m.crm_merge_confirm({
					count: loserIds.length,
					name: contactLabel(g.contacts.find((c) => c.id === survivorId)?.name),
				}),
			)
		)
			return;
		merging = gi;
		try {
			const res = await fetch('/api/crm/cleanup/duplicates', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ survivorId, loserIds }),
			});
			if (res.ok) await invalidate('crm:cleanup');
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
			default: return iss;
		}
	}
	function actionLabel(a: string): string {
		return a === 'keep' ? m.crm_action_keep() : a === 'adjust' ? m.crm_action_adjust() : a === 'flag' ? m.crm_action_flag() : a;
	}
</script>

<div class="flex flex-col gap-6 max-w-5xl">
	<!-- Standardization -->
	<section class="card">
		<header class="sec-h">
			<div class="flex items-center gap-2"><Wand2 size={16} class="text-accent" /><span>{m.crm_standardize_names()} ({rows.length})</span></div>
			<div class="flex items-center gap-2">
				<Button variant="outline" size="sm" onclick={runReview} disabled={reviewing || rows.length === 0}>
					<Sparkles size={14} class={reviewing ? 'animate-pulse' : ''} />
					{reviewing ? m.crm_reviewing() : m.crm_ai_review()}
				</Button>
				<Button variant="primary" size="sm" onclick={applyAll} disabled={applying || selectedCount === 0}>
					<Check size={14} /> {m.crm_apply()} {selectedCount}
				</Button>
			</div>
		</header>

		{#if rows.length === 0}
			<p class="t-caption py-3">{m.crm_all_clean()}</p>
		{:else}
			<p class="t-caption mb-2">{m.crm_standardize_hint()}</p>
			<div class="rows">
				{#each rows as r (r.contactId)}
					<div class="row" class:flagged={r.agentAction === 'flag'}>
						<input type="checkbox" bind:checked={r.apply} class="chk" />
						<div class="names">
							<div class="cur" title={r.current ?? ''}>{r.current || m.crm_blank()}</div>
							<div class="arrow">→</div>
							<input bind:value={r.value} class="prop" placeholder={m.crm_clear()} />
						</div>
						<div class="meta">
							{#each r.issues as iss (iss)}<span class="tag">{issueLabel(iss)}</span>{/each}
							{#if r.agentAction}<span class="tag ai" class:flag={r.agentAction === 'flag'}>{m.crm_ai_label()}: {actionLabel(r.agentAction)}</span>{/if}
							{#if r.agentNote}<span class="note" title={r.agentNote}>{r.agentNote}</span>{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

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
				{#each groups as g, gi (g.key)}
					<div class="group">
						<div class="group-h">
							<span class="reason">{g.reason === 'dni' ? `DNI ${g.key}` : m.crm_dup_same_name()}</span>
							<Button variant="secondary" size="sm" onclick={() => mergeGroup(gi)} disabled={merging === gi}>
								<GitMerge size={14} /> {merging === gi ? m.crm_merging() : m.crm_merge()}
							</Button>
						</div>
						{#each g.contacts as c (c.id)}
							<label class="dup">
								<input type="radio" name={`surv-${gi}`} value={c.id} checked={survivor[gi] === c.id} onchange={() => (survivor = { ...survivor, [gi]: c.id })} />
								<span class="dup-name">{contactLabel(c.name)}</span>
								{#if c.dni}<span class="t-caption">DNI {c.dni}</span>{/if}
								{#if c.phone}<span class="t-caption">{c.phone}</span>{/if}
								<span class="ml-auto t-caption">{m.crm_msgs_n({ count: c.messages })}</span>
								{#if survivor[gi] === c.id}<span class="keep">{m.crm_keep()}</span>{/if}
							</label>
						{/each}
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>

<style>
	.card { border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); padding: 0.85rem 1rem; }
	.sec-h { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; font-weight: 600; margin-bottom: 0.5rem; }
	.rows { display: flex; flex-direction: column; }
	.row { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 0.6rem; padding: 0.35rem 0; border-top: 1px solid var(--hairline); }
	.row.flagged { opacity: 0.6; }
	.chk { width: 15px; height: 15px; }
	.names { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 0.5rem; min-width: 0; }
	.cur { color: var(--color-muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.arrow { color: var(--color-muted-foreground); }
	.prop { height: 1.9rem; padding: 0 0.5rem; font-size: 0.85rem; border-radius: var(--radius-md); background: var(--color-bg3); border: 1px solid var(--hairline); }
	.meta { display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap; justify-content: flex-end; }
	.tag { font-size: 0.66rem; padding: 0.05rem 0.4rem; border-radius: 999px; background: color-mix(in srgb, var(--color-warning) 16%, transparent); color: var(--color-warning); white-space: nowrap; }
	.tag.ai { background: color-mix(in srgb, var(--color-accent) 16%, transparent); color: var(--color-accent); }
	.tag.ai.flag { background: color-mix(in srgb, var(--color-destructive) 16%, transparent); color: var(--color-destructive); }
	.note { font-size: 0.66rem; color: var(--color-muted-foreground); max-width: 14rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.group { border: 1px solid var(--hairline); border-radius: var(--radius-md); padding: 0.5rem 0.7rem; }
	.group-h { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.3rem; }
	.reason { font-size: 0.72rem; font-weight: 600; color: var(--color-muted-foreground); text-transform: uppercase; letter-spacing: 0.03em; }
	.dup { display: flex; align-items: center; gap: 0.55rem; padding: 0.25rem 0; font-size: 0.86rem; cursor: pointer; }
	.dup-name { font-weight: 500; }
	.keep { font-size: 0.66rem; padding: 0.05rem 0.4rem; border-radius: 999px; background: color-mix(in srgb, var(--color-success) 18%, transparent); color: var(--color-success); }
</style>
