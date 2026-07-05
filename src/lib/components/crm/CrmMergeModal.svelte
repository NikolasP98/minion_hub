<script lang="ts" module>
	/** A contact shown in the merge picker. `stats` is a pre-formatted subtitle. */
	export type MergeContact = { id: string; name: string; stats?: string };
</script>

<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { ArrowRight, Check } from 'lucide-svelte';
	import { Button, Modal } from '$lib/components/ui';

	// Shared "merge contacts" confirmation: a survivor picker that makes the data
	// flow unmistakable — the chosen contact is accent-framed ("keeps everything")
	// and the rest are dimmed + struck ("merged in, then removed"). Used by the CRM
	// customers bulk-merge kebab and the settings→hygiene duplicate groups.
	let {
		open = $bindable(false),
		contacts,
		survivorId = $bindable(''),
		busy = false,
		error = null,
		onConfirm,
	}: {
		open?: boolean;
		contacts: MergeContact[];
		/** Bindable — the picked survivor (parent seeds a sensible default). */
		survivorId?: string;
		busy?: boolean;
		error?: string | null;
		onConfirm: () => void;
	} = $props();

	const survivor = $derived(contacts.find((c) => c.id === survivorId) ?? null);
</script>

<Modal bind:open title={m.crm_bulk_merge_title()}>
	<p class="merge-heading">{m.crm_merge_pick_heading()}</p>
	<div class="merge-list">
		{#each contacts as c (c.id)}
			{@const isSurvivor = survivorId === c.id}
			<button type="button" class="merge-row" class:survivor={isSurvivor} class:loser={!isSurvivor} onclick={() => (survivorId = c.id)}>
				<span class="radio" class:on={isSurvivor}>{#if isSurvivor}<Check size={11} />{/if}</span>
				<span class="m-info">
					<span class="m-name">{c.name}</span>
					{#if c.stats}<span class="m-stats">{c.stats}</span>{/if}
				</span>
				{#if isSurvivor}
					<span class="m-tag keeps">{m.crm_merge_keeps()}</span>
				{:else}
					<span class="m-tag removed">{m.crm_merge_removed()}</span>
				{/if}
			</button>
		{/each}
	</div>
	{#if survivor}
		<p class="merge-summary">
			<ArrowRight size={13} class="ms-ico" />
			{m.crm_merge_summary({ others: contacts.length - 1, name: survivor.name })}
		</p>
	{/if}
	{#if error}<p class="err-msg">{error}</p>{/if}
	{#snippet footer()}
		<Button variant="outline" size="sm" onclick={() => (open = false)}>{m.common_cancel()}</Button>
		<Button variant="primary" size="sm" onclick={onConfirm} disabled={busy || !survivorId || contacts.length < 2}>{m.crm_bulk_merge_btn()}</Button>
	{/snippet}
</Modal>

<style>
	.merge-heading { font-size: 0.78rem; font-weight: 600; color: var(--color-muted-foreground); margin-bottom: 0.5rem; }
	.merge-list { display: flex; flex-direction: column; gap: 0.35rem; max-height: 18rem; overflow: auto; }
	.merge-row {
		display: flex; align-items: center; gap: 0.6rem; width: 100%; text-align: left;
		padding: 0.55rem 0.65rem; border-radius: var(--radius-md); border: 1px solid var(--hairline);
		background: var(--color-bg3); cursor: pointer;
		transition: border-color 0.12s, background-color 0.12s, opacity 0.12s;
	}
	.merge-row:hover { border-color: color-mix(in srgb, var(--color-accent) 40%, var(--hairline)); }
	/* Survivor: prominent, accent-framed — "everything lands here". */
	.merge-row.survivor { border-color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 12%, transparent); }
	/* Losers: dimmed + struck name — visibly the ones being crushed. */
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
	.merge-summary { display: flex; align-items: flex-start; gap: 0.4rem; margin-top: 0.75rem; font-size: 0.78rem; color: var(--color-muted-foreground); line-height: 1.4; }
	:global(.merge-summary .ms-ico) { color: var(--color-accent); flex-shrink: 0; margin-top: 0.15rem; }
	.err-msg { font-size: 0.8rem; color: var(--color-destructive); margin-top: 0.5rem; }
</style>
