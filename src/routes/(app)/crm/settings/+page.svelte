<script lang="ts">
	import type { PageData } from './$types';
	import { invalidate } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';
	import { ArrowLeft, Plus, Trash2, Tag as TagIcon } from 'lucide-svelte';
	import { PageHeader, Button } from '$lib/components/ui';

	let { data }: { data: PageData } = $props();
	const tags = $derived(data.tags);

	// Auto-tag rule fields (must match RULE_FIELDS in crm-scoring.ts).
	const FIELDS = [
		{ v: 'score', label: () => m.crm_field_score() },
		{ v: 'last_days', label: () => m.crm_field_last_days() },
		{ v: 'total_msgs', label: () => m.crm_field_total_msgs() },
		{ v: 'inbound_msgs', label: () => m.crm_field_inbound_msgs() },
		{ v: 'channels_used', label: () => m.crm_field_channels_used() },
		{ v: 'reciprocity', label: () => m.crm_field_reciprocity() },
		{ v: 'stage', label: () => m.crm_field_stage() },
	];
	const OPS = ['>=', '>', '=', '<=', '<', '!='];
	const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4'];

	let name = $state('');
	let color = $state(COLORS[0]);
	let kind = $state<'manual' | 'auto'>('manual');
	let field = $state('score');
	let op = $state('>=');
	let value = $state('80');
	let busy = $state(false);
	let err = $state('');

	function ruleValue(): number | string {
		// stage is a string field; everything else numeric.
		return field === 'stage' ? value : Number(value);
	}

	async function createTag() {
		if (!name.trim()) return;
		busy = true;
		err = '';
		try {
			const body: Record<string, unknown> = { name: name.trim(), color, kind };
			if (kind === 'auto') body.rule = { field, op, value: ruleValue() };
			const res = await fetch('/api/crm/tags', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			});
			if (res.ok) {
				name = '';
				await invalidate('crm:tags');
			} else {
				const j = await res.json().catch(() => ({}));
				err = j.message ?? 'Error';
			}
		} finally {
			busy = false;
		}
	}

	async function deleteTag(id: string) {
		await fetch(`/api/crm/tags/${id}`, { method: 'DELETE' });
		await invalidate('crm:tags');
	}

	function ruleSummary(rule: unknown): string {
		if (!rule || typeof rule !== 'object') return '';
		const r = rule as { field?: string; op?: string; value?: unknown };
		if (!r.field) return '';
		return `${r.field} ${r.op} ${r.value}`;
	}
</script>

<svelte:head><title>{m.crm_tags_title()} — {m.crm_title()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.crm_tags_title()} subtitle={m.crm_tags_subtitle()}>
		{#snippet leading()}
			<a href="/crm" class="p-1 -ml-1 rounded hover:bg-white/[0.06] inline-flex" aria-label={m.crm_back_to_contacts()}>
				<ArrowLeft size={16} />
			</a>
		{/snippet}
	</PageHeader>

	<div class="flex-1 min-h-0 overflow-auto p-4 grid gap-4 lg:grid-cols-[1fr_1.2fr] max-w-4xl">
		<!-- Create -->
		<section class="card">
			<header class="card-h"><span>{m.crm_new_tag()}</span></header>
			<label class="field">
				<span class="t-caption">{m.crm_tag_name()}</span>
				<input bind:value={name} class="inp" placeholder={m.crm_tag_name()} />
			</label>

			<label class="field">
				<span class="t-caption">{m.crm_tag_color()}</span>
				<div class="swatches">
					{#each COLORS as c (c)}
						<button type="button" class="swatch" class:sel={color === c} style:background={c} onclick={() => (color = c)} aria-label={c}></button>
					{/each}
				</div>
			</label>

			<label class="field">
				<span class="t-caption">{m.crm_tag_type()}</span>
				<select bind:value={kind} class="inp">
					<option value="manual">{m.crm_tag_kind_manual()}</option>
					<option value="auto">{m.crm_tag_kind_auto()}</option>
				</select>
			</label>

			{#if kind === 'auto'}
				<div class="rule">
					<span class="t-caption">{m.crm_auto_rule()}</span>
					<div class="rule-row">
						<select bind:value={field} class="inp">
							{#each FIELDS as f (f.v)}<option value={f.v}>{f.label()}</option>{/each}
						</select>
						<select bind:value={op} class="inp w-16">
							{#each OPS as o (o)}<option value={o}>{o}</option>{/each}
						</select>
						<input bind:value class="inp w-24" placeholder={m.crm_rule_value()} />
					</div>
				</div>
			{/if}

			{#if err}<p class="err">{err}</p>{/if}
			<Button variant="primary" size="sm" onclick={createTag} disabled={busy || !name.trim()}>
				<Plus size={14} /> {m.crm_create()}
			</Button>
		</section>

		<!-- List -->
		<section class="card">
			<header class="card-h"><span>{m.crm_manage_tags()}</span></header>
			{#if tags.length === 0}
				<p class="t-caption">{m.crm_no_tags()}</p>
			{:else}
				<ul class="taglist">
					{#each tags as t (t.id)}
						<li>
							<span class="chip" style:--c={t.color ?? 'var(--color-accent)'}>
								<TagIcon size={11} />{t.name}
							</span>
							{#if t.kind === 'auto'}
								<span class="auto">{m.crm_auto_badge()}: {ruleSummary(t.rule)}</span>
							{/if}
							<button class="del" onclick={() => deleteTag(t.id)} aria-label={m.crm_delete()}><Trash2 size={13} /></button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>
</div>

<style>
	.card {
		border: 1px solid var(--hairline);
		border-radius: var(--radius-lg);
		background: var(--color-card);
		padding: 0.85rem 1rem;
	}
	.card-h {
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--color-muted-foreground);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		margin-bottom: 0.7rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 0.7rem;
	}
	.inp {
		height: 2rem;
		padding: 0 0.6rem;
		font-size: 0.85rem;
		border-radius: var(--radius-md);
		background: var(--color-bg3);
		border: 1px solid var(--hairline);
	}
	.swatches {
		display: flex;
		gap: 0.4rem;
	}
	.swatch {
		width: 22px;
		height: 22px;
		border-radius: 999px;
		border: 2px solid transparent;
	}
	.swatch.sel {
		border-color: var(--color-foreground);
	}
	.rule {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin-bottom: 0.7rem;
		padding: 0.6rem;
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-accent) 6%, transparent);
	}
	.rule-row {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.err {
		color: var(--color-destructive);
		font-size: 0.8rem;
		margin-bottom: 0.5rem;
	}
	.taglist {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}
	.taglist li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.12rem 0.55rem;
		border-radius: 999px;
		font-size: 0.78rem;
		color: var(--c);
		background: color-mix(in srgb, var(--c) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--c) 30%, transparent);
	}
	.auto {
		font-size: 0.72rem;
		color: var(--color-muted-foreground);
		font-family: var(--font-mono, monospace);
	}
	.del {
		margin-left: auto;
		opacity: 0.6;
		display: grid;
		place-items: center;
	}
	.del:hover {
		opacity: 1;
		color: var(--color-destructive);
	}
</style>
