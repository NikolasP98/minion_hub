<script lang="ts">
	import type { PageData } from './$types';
	import { goto, invalidate } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';
	import { ArrowLeft, Trash2, Plus, X, MoreVertical, Pencil, Check } from 'lucide-svelte';
	import { PageHeader, Button } from '$lib/components/ui';
	import MathFormula from '$lib/components/ui/MathFormula.svelte';
	import ScoreBadge from '$lib/components/crm/ScoreBadge.svelte';
	import StagePill from '$lib/components/crm/StagePill.svelte';
	import JourneyTimeline from '$lib/components/crm/JourneyTimeline.svelte';
	import { contactLabel } from '$lib/components/crm/crm-format';
	import { stageLabel } from '$lib/components/crm/crm-i18n';

	let { data }: { data: PageData } = $props();
	const c = $derived(data.contact);
	const score = $derived(data.score);
	const stats = $derived(data.stats as Record<string, unknown> | null);
	const contactTags = $derived(data.contactTags);
	const availableTags = $derived(
		data.allTags.filter((t) => !data.contactTags.some((ct) => ct.id === t.id)),
	);

	const STAGES = ['New', 'Engaged', 'Active', 'Dormant', 'Churned'];
	let noteBody = $state('');
	let busy = $state(false);
	let menuOpen = $state(false);
	let editing = $state(false);
	let editName = $state('');

	function startEdit() {
		menuOpen = false;
		editName = c.displayName ?? '';
		editing = true;
	}
	async function saveName() {
		const name = editName.trim();
		await patch({ displayName: name || null });
		editing = false;
	}

	const texSymbolic = '\\text{Score} = 0.5\\,R + 0.3\\,F + 0.2\\,M';
	const texValues = $derived(
		score
			? `= 0.5(${score.r_score}) + 0.3(${score.f_score}) + 0.2(${score.m_score}) = ${score.score}`
			: '',
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
		if (res.ok) await goto('/crm');
	}
</script>

<svelte:head><title>{contactLabel(c.displayName)} — {m.crm_title()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={contactLabel(c.displayName)} subtitle={c.source === 'manual' ? m.crm_manual_contact() : m.crm_harvested()}>
		{#snippet leading()}
			<button class="p-1 -ml-1 rounded hover:bg-white/[0.06]" onclick={() => goto('/crm')} aria-label={m.crm_back_to_contacts()}>
				<ArrowLeft size={16} />
			</button>
		{/snippet}
		{#snippet actions()}
			<div class="menu-wrap">
				<button class="kebab" onclick={() => (menuOpen = !menuOpen)} aria-label="Actions" disabled={busy}>
					<MoreVertical size={18} />
				</button>
				{#if menuOpen}
					<button class="backdrop" aria-label="close" onclick={() => (menuOpen = false)}></button>
					<div class="menu">
						<button class="mi" onclick={startEdit}><Pencil size={14} /> Edit name</button>
						<div class="msep"></div>
						<button class="mi danger" onclick={() => { menuOpen = false; forget(); }}><Trash2 size={14} /> {m.crm_forget()}</button>
					</div>
				{/if}
			</div>
		{/snippet}
	</PageHeader>

	{#if editing}
		<div class="edit-bar">
			<Pencil size={14} class="text-muted-foreground" />
			<input
				bind:value={editName}
				class="edit-input"
				placeholder="Contact name"
				onkeydown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') (editing = false); }}
			/>
			<Button variant="primary" size="sm" onclick={saveName} disabled={busy}><Check size={14} /> Save</Button>
			<Button variant="ghost" size="sm" onclick={() => (editing = false)}>Cancel</Button>
		</div>
	{/if}

	<div class="flex-1 min-h-0 overflow-auto p-4 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
		<!-- Left: identity, score, tags -->
		<div class="flex flex-col gap-4">
			<!-- Score breakdown -->
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
						<div><dt>{m.crm_recency()}</dt><dd>{m.crm_recency_value({ days: score.last_days })}</dd></div>
						<div><dt>{m.crm_frequency()}</dt><dd>{m.crm_inbound_value({ count: score.inbound_msgs })}</dd></div>
						<div><dt>{m.crm_reciprocity()}</dt><dd>{Math.round(score.reciprocity * 100)}%</dd></div>
						<div><dt>{m.crm_channels()}</dt><dd>{score.channels_used}</dd></div>
					</dl>
				{:else}
					<p class="t-caption">{m.crm_no_score()}</p>
				{/if}
			</section>

			<!-- Lifecycle + tags -->
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
					{#if availableTags.length > 0}
						<select class="addtag" onchange={(e) => { addTag((e.currentTarget as HTMLSelectElement).value); e.currentTarget.value = ''; }}>
							<option value="">{m.crm_add_tag()}</option>
							{#each availableTags as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
						</select>
					{/if}
				</div>
			</section>

			<!-- Identities -->
			<section class="card">
				<header class="card-h"><span>{m.crm_identities()}</span></header>
				<ul class="ids">
					{#each data.identities as id (id.id)}
						<li><span class="chan">{id.channel}</span><span class="ext">{id.handle ?? id.externalId}</span></li>
					{:else}
						<li class="t-caption">{m.crm_no_identities()}</li>
					{/each}
				</ul>
			</section>
		</div>

		<!-- Right: journey timeline + notes -->
		<div class="flex flex-col gap-4 min-h-0">
			<section class="card">
				<header class="card-h">
					<span>{m.crm_add_note()}</span>
				</header>
				<div class="note-row">
					<input bind:value={noteBody} placeholder={m.crm_note_placeholder()} class="flex-1 h-8 px-3 text-sm rounded-[var(--radius-md)] bg-bg3 border border-[var(--hairline)]" onkeydown={(e) => e.key === 'Enter' && addNote()} />
					<Button variant="secondary" size="sm" onclick={addNote} disabled={busy || !noteBody.trim()}><Plus size={14} /></Button>
				</div>
			</section>

			<section class="card flex-1 min-h-0 flex flex-col">
				<header class="card-h">
					<span>{m.crm_journey()}</span>
					<span class="t-caption">{stats ? m.crm_journey_messages({ count: stats.message_count as number }) : ''}</span>
				</header>
				<div class="flex-1 min-h-0 overflow-auto">
					<JourneyTimeline rows={data.timeline as never} />
				</div>
			</section>
		</div>
	</div>
</div>

<style>
	/* kebab menu */
	.menu-wrap { position: relative; display: inline-flex; }
	.kebab { display: grid; place-items: center; width: 2rem; height: 2rem; border-radius: var(--radius-md); color: var(--color-foreground); }
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
	/* inline name editor */
	.edit-bar { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 1rem; border-bottom: 1px solid var(--hairline); background: color-mix(in srgb, var(--color-accent) 5%, transparent); }
	.edit-input { flex: 1; max-width: 28rem; height: 2rem; padding: 0 0.6rem; font-size: 0.9rem; border-radius: var(--radius-md); background: var(--color-bg3); border: 1px solid var(--hairline); }
	/* formula on hover of the score */
	.score-hover { position: relative; display: inline-flex; }
	.formula-pop {
		position: absolute; top: calc(100% + 6px); right: 0; z-index: 30; width: 16rem;
		padding: 0.55rem 0.7rem; background: var(--color-card); border: 1px solid var(--hairline);
		border-radius: var(--radius-md); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
		opacity: 0; transform: translateY(-3px); pointer-events: none; transition: opacity 0.12s, transform 0.12s;
	}
	.score-hover:hover .formula-pop { opacity: 1; transform: translateY(0); }
	.card {
		border: 1px solid var(--hairline);
		border-radius: var(--radius-lg);
		background: var(--color-card);
		padding: 0.85rem 1rem;
	}
	.card-h {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--color-muted-foreground);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		margin-bottom: 0.6rem;
	}
	.formula {
		padding: 0.2rem 0;
	}
	.formula.sub {
		color: var(--color-muted-foreground);
		font-size: 0.9em;
	}
	.kv {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.4rem 1rem;
		margin-top: 0.75rem;
	}
	.kv dt {
		font-size: 0.7rem;
		color: var(--color-muted-foreground);
	}
	.kv dd {
		font-size: 0.9rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 0.75rem;
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: center;
	}
	.tag {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		font-size: 0.74rem;
		color: var(--c);
		background: color-mix(in srgb, var(--c) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--c) 30%, transparent);
	}
	.tag button {
		display: grid;
		place-items: center;
		opacity: 0.7;
	}
	.tag button:hover {
		opacity: 1;
	}
	.addtag {
		height: 1.6rem;
		font-size: 0.74rem;
		border-radius: 999px;
		background: var(--color-bg3);
		border: 1px dashed var(--hairline);
		padding: 0 0.4rem;
	}
	.ids {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.ids li {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.84rem;
	}
	.ids .chan {
		font-weight: 600;
		text-transform: capitalize;
	}
	.ids .ext {
		color: var(--color-muted-foreground);
		font-variant-numeric: tabular-nums;
	}
	.note-row {
		display: flex;
		gap: 0.5rem;
	}
</style>
