<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { untrack } from 'svelte';
	import { ArrowRight, Check, GitFork } from 'lucide-svelte';
	import { Button, Modal } from '$lib/components/ui';
	import type { MergeContact, MergeField } from '$lib/components/crm/crm-merge';

	// Shared "merge contacts" resolver. Two decisions:
	//   1. Survivor — which record survives (base id; keeps merged history/identities).
	//   2. Per-field conflicts — for any scalar field whose selected contacts hold
	//      different values, pick which value the merged record keeps.
	// The chosen survivor is accent-framed ("keeps everything"), losers are dimmed +
	// struck ("merged in, then removed"); `onConfirm` receives the resolved field map.
	let {
		open = $bindable(false),
		contacts,
		fields = [],
		survivorId = $bindable(''),
		busy = false,
		error = null,
		onConfirm,
	}: {
		open?: boolean;
		contacts: MergeContact[];
		/** Resolvable fields (each with per-contact values). Conflicts = 2+ distinct. */
		fields?: MergeField[];
		survivorId?: string;
		busy?: boolean;
		error?: string | null;
		/** Called with { fieldKey → chosen value } for fields resolved away from the survivor's own. */
		onConfirm: (resolved: Record<string, string>) => void;
	} = $props();

	const survivor = $derived(contacts.find((c) => c.id === survivorId) ?? null);

	// Per-field user overrides (default is the survivor's own value). Reset when the
	// contact set changes (a fresh merge).
	let overrides = $state<Record<string, string>>({});
	$effect(() => {
		contacts;
		untrack(() => (overrides = {}));
	});

	const survivorValue = (f: MergeField) => f.values.find((v) => v.contactId === survivorId)?.value ?? '';
	const distinctValues = (f: MergeField) => [...new Set(f.values.map((v) => v.value))];
	const conflicts = $derived(fields.filter((f) => distinctValues(f).length >= 2));
	// Show every field that has any value — matching fields render read-only,
	// conflicting ones get pickers — so the merge details are always visible.
	const shownFields = $derived(fields.filter((f) => f.values.length > 0));
	const chosen = (f: MergeField) => overrides[f.key] ?? (survivorValue(f) || distinctValues(f)[0] || '');
	function pick(f: MergeField, value: string) {
		overrides = { ...overrides, [f.key]: value };
	}

	function resolvedPayload(): Record<string, string> {
		const out: Record<string, string> = {};
		for (const f of fields) {
			const distinct = distinctValues(f);
			// 2+ values → the user's pick; single value → preserve it on the survivor.
			const eff = distinct.length >= 2 ? chosen(f) : (distinct[0] ?? '');
			if (eff && eff !== survivorValue(f)) out[f.key] = eff;
		}
		return out;
	}
</script>

<Modal bind:open title={m.crm_bulk_merge_title()}>
	<div class="merge-scroll">
		<p class="merge-heading">{m.crm_merge_pick_heading()}</p>
		<div class="merge-list">
			{#each contacts as c (c.id)}
				{@const isSurvivor = survivorId === c.id}
				<button type="button" class="merge-row" class:survivor={isSurvivor} class:loser={!isSurvivor} onclick={() => (survivorId = c.id)}>
					<span class="radio" class:on={isSurvivor}>{#if isSurvivor}<Check size={11} />{/if}</span>
					<span class="m-info">
						<span class="m-name">{c.name}</span>
						{#if c.subtitle}<span class="m-stats">{c.subtitle}</span>{/if}
					</span>
					{#if isSurvivor}
						<span class="m-tag keeps">{m.crm_merge_keeps()}</span>
					{:else}
						<span class="m-tag removed">{m.crm_merge_removed()}</span>
					{/if}
				</button>
			{/each}
		</div>

		{#if shownFields.length}
			<div class="resolve">
				<p class="resolve-h"><GitFork size={12} /> {conflicts.length ? m.crm_merge_resolve_heading() : m.crm_merge_fields_heading()}</p>
				{#each shownFields as f (f.key)}
					{@const vals = distinctValues(f)}
					{@const val = chosen(f)}
					<div class="field">
						<span class="f-label">{f.label}</span>
						{#if vals.length >= 2}
							<div class="f-vals">
								{#each vals as v (v)}
									<button type="button" class="f-chip" class:on={val === v} onclick={() => pick(f, v)}>
										{#if val === v}<Check size={10} class="fc-ic" />{/if}
										<span class="fc-v">{v}</span>
										{#if v === survivorValue(f)}<span class="fc-base">{m.crm_merge_base()}</span>{/if}
									</button>
								{/each}
							</div>
						{:else}
							<span class="f-single">{vals[0]}</span>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		{#if survivor}
			<p class="merge-summary">
				<ArrowRight size={13} class="ms-ico" />
				{m.crm_merge_summary({ others: contacts.length - 1, name: survivor.name })}
			</p>
		{/if}
		{#if error}<p class="err-msg">{error}</p>{/if}
	</div>
	{#snippet footer()}
		<Button variant="outline" size="sm" onclick={() => (open = false)}>{m.common_cancel()}</Button>
		<Button variant="primary" size="sm" onclick={() => onConfirm(resolvedPayload())} disabled={busy || !survivorId || contacts.length < 2}>{m.crm_bulk_merge_btn()}</Button>
	{/snippet}
</Modal>

<style>
	.merge-scroll { max-height: min(62vh, 34rem); overflow: auto; margin: -0.15rem; padding: 0.15rem; }
	.merge-heading { font-size: 0.78rem; font-weight: 600; color: var(--color-muted-foreground); margin-bottom: 0.5rem; }
	.merge-list { display: flex; flex-direction: column; gap: 0.35rem; }
	.merge-row {
		display: flex; align-items: center; gap: 0.6rem; width: 100%; text-align: left;
		padding: 0.55rem 0.65rem; border-radius: var(--radius-md); border: 1px solid var(--hairline);
		background: var(--color-bg3); cursor: pointer;
		transition: border-color 0.12s, background-color 0.12s, opacity 0.12s;
	}
	.merge-row:hover { border-color: color-mix(in srgb, var(--color-accent) 40%, var(--hairline)); }
	.merge-row.survivor { border-color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 12%, transparent); }
	.merge-row.loser { opacity: 0.62; }
	.merge-row.loser:hover { opacity: 0.85; }
	.merge-row.loser .m-name { text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--color-destructive) 70%, transparent); }
	.radio { display: grid; place-items: center; width: 1.1rem; height: 1.1rem; flex-shrink: 0; border-radius: 999px; border: 1.5px solid var(--color-muted-foreground); color: var(--color-accent-foreground, #000); }
	.radio.on { background: var(--color-accent); border-color: var(--color-accent); }
	.m-info { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; flex: 1; }
	.m-name { font-size: 0.86rem; font-weight: 600; color: var(--color-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.m-stats { font-size: 0.7rem; color: var(--color-muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.m-tag { flex-shrink: 0; font-size: 0.64rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; padding: 0.15rem 0.45rem; border-radius: 999px; white-space: nowrap; }
	.m-tag.keeps { color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 18%, transparent); }
	.m-tag.removed { color: var(--color-destructive); background: color-mix(in srgb, var(--color-destructive) 14%, transparent); }

	/* ── Per-field conflict resolver ─────────────────────────────────────── */
	.resolve { margin-top: 0.85rem; border-top: 1px solid var(--hairline); padding-top: 0.65rem; }
	.resolve-h { display: flex; align-items: center; gap: 0.35rem; font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: var(--color-muted-foreground); margin-bottom: 0.5rem; }
	.field { display: grid; grid-template-columns: 6.5rem 1fr; align-items: start; gap: 0.5rem; padding: 0.3rem 0; }
	.field + .field { border-top: 1px solid color-mix(in srgb, var(--hairline) 55%, transparent); }
	.f-label { font-size: 0.76rem; font-weight: 600; color: var(--color-muted-foreground); padding-top: 0.3rem; overflow: hidden; text-overflow: ellipsis; }
	.f-vals { display: flex; flex-wrap: wrap; gap: 0.35rem; }
	.f-chip {
		display: inline-flex; align-items: center; gap: 0.3rem; max-width: 100%;
		padding: 0.28rem 0.55rem; font-size: 0.8rem; border-radius: var(--radius-sm);
		border: 1px solid var(--hairline); background: var(--color-bg3); color: var(--color-foreground); cursor: pointer;
		transition: border-color 0.12s, background-color 0.12s;
	}
	.f-chip:hover { border-color: color-mix(in srgb, var(--color-accent) 45%, var(--hairline)); }
	.f-chip.on { border-color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 15%, transparent); color: var(--color-accent); }
	:global(.f-chip .fc-ic) { flex-shrink: 0; }
	.fc-v { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.fc-base { font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em; color: var(--color-muted-foreground); opacity: 0.7; }
	.f-single { padding-top: 0.3rem; font-size: 0.82rem; color: var(--color-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	.merge-summary { display: flex; align-items: flex-start; gap: 0.4rem; margin-top: 0.75rem; font-size: 0.78rem; color: var(--color-muted-foreground); line-height: 1.4; }
	:global(.merge-summary .ms-ico) { color: var(--color-accent); flex-shrink: 0; margin-top: 0.15rem; }
	.err-msg { font-size: 0.8rem; color: var(--color-destructive); margin-top: 0.5rem; }
</style>
