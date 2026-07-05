<script lang="ts">
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { Check, GitMerge, Crown, TriangleAlert } from 'lucide-svelte';
	import { Button, DraggableDialog } from '$lib/components/ui';
	import ChannelBrandIcon from '$lib/components/channels/ChannelBrandIcon.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { MergeContact, MergeField, MergeResolution } from '$lib/components/crm/crm-merge';

	// Column-per-candidate merge conflict resolver. Every selected contact is a
	// column; every field a row. The user picks a value per field (or types one),
	// assembling a "merged result". Under the hood one record must anchor history
	// (FK integrity for messages/identities/tags) — the most-active INCLUDED
	// candidate is that anchor; the rest fold in; EXCLUDED candidates stay separate.
	// Channels always union onto the result (display-only, flagged when they clash).
	let {
		open = $bindable(false),
		contacts,
		fields = [],
		busy = false,
		error = null,
		onConfirm,
	}: {
		open?: boolean;
		contacts: MergeContact[];
		fields?: MergeField[];
		busy?: boolean;
		error?: string | null;
		onConfirm: (resolution: MergeResolution) => void;
	} = $props();

	// ── Candidate inclusion (deselect wrongly-grouped) + per-field picks ─────────
	const included = new SvelteSet<string>();
	let picks = $state<Record<string, string>>({});
	// Fresh candidate set → include all, drop picks. (A new merge reuses this modal.)
	$effect(() => {
		contacts;
		untrack(() => {
			included.clear();
			for (const c of contacts) included.add(c.id);
			picks = {};
		});
	});

	const includedList = $derived(contacts.filter((c) => included.has(c.id)));
	// Anchor = most-active included candidate — it keeps its id, so all history stays.
	const anchorId = $derived(
		[...includedList].sort((a, b) => (b.messages ?? 0) - (a.messages ?? 0))[0]?.id ?? '',
	);
	const excludedCount = $derived(contacts.length - includedList.length);
	const anchorName = $derived(contacts.find((c) => c.id === anchorId)?.name ?? '');

	// fieldKey → (contactId → value)
	const fieldMap = $derived.by(() => {
		const map = new Map<string, Map<string, string>>();
		for (const f of fields) {
			const inner = new Map<string, string>();
			for (const v of f.values) if (v.value) inner.set(v.contactId, v.value);
			map.set(f.key, inner);
		}
		return map;
	});
	const valueOf = (key: string, cid: string) => fieldMap.get(key)?.get(cid) ?? '';

	// Default result for a field: anchor's own value, else the first included value.
	function defaultValue(key: string): string {
		const a = valueOf(key, anchorId);
		if (a) return a;
		for (const c of includedList) {
			const v = valueOf(key, c.id);
			if (v) return v;
		}
		return '';
	}
	const effective = (key: string) => picks[key] ?? defaultValue(key);
	const pick = (key: string, value: string) => (picks = { ...picks, [key]: value });

	function distinct(key: string): number {
		const s = new Set<string>();
		for (const c of includedList) {
			const v = valueOf(key, c.id);
			if (v) s.add(v);
		}
		return s.size;
	}
	const isConflict = (key: string) => distinct(key) >= 2;

	// Only rows that some INCLUDED candidate actually has a value for.
	const shownFields = $derived(fields.filter((f) => includedList.some((c) => valueOf(f.key, c.id))));

	// ── Channels (union across included; clash = same channel, ≥2 values) ────────
	const unionChannels = $derived.by(() => {
		const by = new Map<string, Set<string>>();
		for (const c of includedList)
			for (const id of c.identities ?? []) {
				if (!id.channel) continue;
				(by.get(id.channel) ?? by.set(id.channel, new Set<string>()).get(id.channel)!).add(id.value || id.channel);
			}
		return [...by.entries()];
	});
	const hasChannels = $derived(contacts.some((c) => (c.identities ?? []).length > 0));

	function toggleInclude(id: string) {
		if (included.has(id)) {
			if (included.size <= 1) return; // keep at least one
			included.delete(id);
		} else included.add(id);
	}

	const canMerge = $derived(includedList.length >= 2 && !!anchorId);

	function confirm() {
		if (!canMerge) return;
		const survivorId = anchorId;
		const loserIds = includedList.filter((c) => c.id !== survivorId).map((c) => c.id);
		const resolved: Record<string, string> = {};
		for (const f of fields) {
			const eff = effective(f.key).trim();
			const anchorVal = valueOf(f.key, survivorId).trim();
			if (eff && eff !== anchorVal) resolved[f.key] = eff; // only carry real changes
		}
		onConfirm({ survivorId, loserIds, resolved });
	}

	// ── Draggable/resizable window shell ─────────────────────────────────────────
	let winX = $state(0);
	let winY = $state(0);
	let fullscreen = $state(false);
	let placed = $state(false);
	$effect(() => {
		if (open && !placed) {
			const w = 900;
			const h = 560;
			winX = Math.max(12, Math.round((window.innerWidth - w) / 2));
			winY = Math.max(12, Math.round((window.innerHeight - h) / 2));
			placed = true;
		} else if (!open) {
			placed = false;
			fullscreen = false;
		}
	});
</script>

{#if open}
	<DraggableDialog
		title={m.crm_bulk_merge_title()}
		z={0}
		{fullscreen}
		x={winX}
		y={winY}
		resizable
		width="min(900px,94vw)"
		height="min(560px,86vh)"
		onfocus={() => {}}
		onclose={() => (open = false)}
		ontogglefullscreen={() => (fullscreen = !fullscreen)}
		onmove={(x, y) => {
			winX = x;
			winY = y;
		}}
	>
		<div class="rz">
			<div class="rz-scroll">
				<table class="rz-table" style={`--cand-count:${contacts.length}`}>
					<thead>
						<tr>
							<th class="rz-corner">{m.crm_merge_field_col()}</th>
							<th class="rz-result-h">
								<Crown size={12} /> {m.crm_merge_result()}
							</th>
							{#each contacts as c (c.id)}
								{@const inc = included.has(c.id)}
								{@const isAnchor = inc && c.id === anchorId}
								<th class="rz-cand" class:excluded={!inc} class:anchor={isAnchor}>
									<button
										type="button"
										class="chk"
										role="checkbox"
										aria-checked={inc}
										title={m.crm_merge_include()}
										onclick={() => toggleInclude(c.id)}
									>
										{#if inc}<Check size={11} strokeWidth={3} />{/if}
									</button>
									<span class="cand-info">
										<span class="cand-name" title={c.name}>{c.name}</span>
										{#if c.subtitle}<span class="cand-sub" title={c.subtitle}>{c.subtitle}</span>{/if}
									</span>
									{#if isAnchor}<span class="anchor-tag">{m.crm_merge_anchor()}</span>{/if}
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each shownFields as f (f.key)}
							{@const conflict = isConflict(f.key)}
							{@const eff = effective(f.key)}
							<tr class:conflict>
								<th class="rz-label">
									<span class="lbl" title={f.label}>{f.label}</span>
									{#if conflict}<TriangleAlert size={11} class="cf-ic" />{/if}
								</th>
								<td class="rz-result">
									<input
										class="res-in"
										value={eff}
										oninput={(e) => pick(f.key, (e.currentTarget as HTMLInputElement).value)}
										placeholder="—"
									/>
								</td>
								{#each contacts as c (c.id)}
									{@const inc = included.has(c.id)}
									{@const v = valueOf(f.key, c.id)}
									<td class="rz-cell" class:excluded={!inc}>
										{#if v}
											<button
												type="button"
												class="cellpick"
												class:on={inc && eff === v}
												disabled={!inc}
												title={v}
												onclick={() => pick(f.key, v)}
											>
												<span class="cv">{v}</span>
												{#if inc && eff === v}<Check size={11} class="cp-ic" />{/if}
											</button>
										{:else}
											<span class="cell-empty">—</span>
										{/if}
									</td>
								{/each}
							</tr>
						{/each}

						{#if hasChannels}
							<tr class="chan-row">
								<th class="rz-label"><span class="lbl">{m.crm_merge_channels()}</span></th>
								<td class="rz-result">
									<div class="chips">
										{#each unionChannels as [ch, vals] (ch)}
											{#each [...vals] as v (v)}
												<span class="chip" class:clash={vals.size >= 2} title={`${ch}: ${v}`}>
													<ChannelBrandIcon channel={ch} size={12} /><span class="chip-v">{v}</span>
												</span>
											{/each}
										{/each}
										{#if unionChannels.length === 0}<span class="cell-empty">—</span>{/if}
									</div>
								</td>
								{#each contacts as c (c.id)}
									{@const inc = included.has(c.id)}
									<td class="rz-cell" class:excluded={!inc}>
										<div class="chips">
											{#each c.identities ?? [] as id (id.channel + id.value)}
												<span class="chip" title={`${id.channel}: ${id.value}`}>
													<ChannelBrandIcon channel={id.channel} size={12} /><span class="chip-v">{id.value}</span>
												</span>
											{/each}
											{#if (c.identities ?? []).length === 0}<span class="cell-empty">—</span>{/if}
										</div>
									</td>
								{/each}
							</tr>
						{/if}
					</tbody>
				</table>
			</div>

			<footer class="rz-foot">
				<div class="notes">
					{#if canMerge}
						<p class="note"><GitMerge size={12} /> {m.crm_merge_anchor_note({ name: anchorName })}</p>
					{:else}
						<p class="note warn"><TriangleAlert size={12} /> {m.crm_merge_need_two()}</p>
					{/if}
					{#if excludedCount > 0}<p class="note dim">{m.crm_merge_excluded_note({ n: excludedCount })}</p>{/if}
					{#if error}<p class="note err">{error}</p>{/if}
				</div>
				<div class="acts">
					<Button variant="outline" size="sm" onclick={() => (open = false)}>{m.common_cancel()}</Button>
					<Button variant="primary" size="sm" onclick={confirm} disabled={busy || !canMerge}>
						<GitMerge size={14} /> {m.crm_bulk_merge_btn()}
					</Button>
				</div>
			</footer>
		</div>
	</DraggableDialog>
{/if}

<style>
	.rz { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--color-card); }
	.rz-scroll { flex: 1; min-height: 0; overflow: auto; }

	.rz-table { border-collapse: separate; border-spacing: 0; width: max-content; min-width: 100%; font-size: 0.82rem; }
	.rz-table th, .rz-table td { border-bottom: 1px solid var(--hairline); vertical-align: top; }

	/* sticky header row + sticky first column */
	thead th { position: sticky; top: 0; z-index: 3; background: var(--color-card); border-bottom: 1px solid var(--hairline); }
	.rz-label, .rz-corner { position: sticky; left: 0; z-index: 2; background: var(--color-card); }
	.rz-corner { z-index: 4; }

	.rz-corner { width: 8.5rem; padding: 0.5rem 0.6rem; font-size: 0.66rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-muted-foreground); text-align: left; }
	.rz-result-h { min-width: 12rem; padding: 0.5rem 0.6rem; text-align: left; color: var(--color-accent); font-weight: 700; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.03em; white-space: nowrap; }
	.rz-result-h :global(svg) { display: inline; vertical-align: -2px; margin-right: 0.2rem; }

	.rz-cand { min-width: 11rem; max-width: 16rem; padding: 0.5rem 0.6rem; text-align: left; }
	.rz-cand { display: table-cell; }
	.rz-cand .chk { float: left; margin: 0.05rem 0.4rem 0 0; width: 1rem; height: 1rem; display: grid; place-items: center; border-radius: 999px; border: 1.5px solid var(--color-muted-foreground); background: transparent; color: var(--color-bg); cursor: pointer; padding: 0; }
	.rz-cand .chk[aria-checked='true'] { background: var(--color-accent); border-color: var(--color-accent); }
	.cand-info { display: block; min-width: 0; overflow: hidden; }
	.cand-name { display: block; font-weight: 600; color: var(--color-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.cand-sub { display: block; font-size: 0.68rem; color: var(--color-muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.anchor-tag { display: inline-block; margin-top: 0.25rem; font-size: 0.58rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: var(--color-success); background: color-mix(in srgb, var(--color-success) 16%, transparent); padding: 0.05rem 0.35rem; border-radius: 999px; }
	.rz-cand.anchor { background: color-mix(in srgb, var(--color-success) 7%, var(--color-card)); }
	.rz-cand.excluded { opacity: 0.45; }
	.rz-cand.excluded .cand-name { text-decoration: line-through; }

	.rz-label { width: 8.5rem; padding: 0.4rem 0.6rem; text-align: left; }
	.rz-label .lbl { font-size: 0.72rem; font-weight: 600; color: var(--color-muted-foreground); display: inline-block; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
	.rz-label :global(.cf-ic) { color: var(--color-warning); vertical-align: -1px; margin-left: 0.25rem; }
	tr.conflict .rz-label, tr.conflict .rz-result { background: color-mix(in srgb, var(--color-warning) 7%, transparent); }

	.rz-result { padding: 0.3rem 0.4rem; background: color-mix(in srgb, var(--color-accent) 5%, transparent); }
	.res-in { width: 100%; min-width: 10rem; height: 1.8rem; padding: 0 0.45rem; font-size: 0.82rem; border-radius: var(--radius-sm); background: var(--color-bg3); border: 1px solid color-mix(in srgb, var(--color-accent) 30%, var(--hairline)); color: var(--color-foreground); }
	.res-in:focus { outline: none; border-color: var(--color-accent); }

	.rz-cell { padding: 0.3rem 0.4rem; }
	.rz-cell.excluded { opacity: 0.4; }
	.cellpick { display: flex; align-items: center; gap: 0.3rem; width: 100%; max-width: 15rem; padding: 0.28rem 0.45rem; text-align: left; font-size: 0.8rem; border-radius: var(--radius-sm); border: 1px solid var(--hairline); background: var(--color-bg3); color: var(--color-foreground); cursor: pointer; transition: border-color 0.12s, background-color 0.12s; }
	.cellpick:hover:not(:disabled) { border-color: color-mix(in srgb, var(--color-accent) 45%, var(--hairline)); }
	.cellpick.on { border-color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 14%, transparent); color: var(--color-accent); }
	.cellpick:disabled { cursor: default; }
	.cv { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
	.cellpick :global(.cp-ic) { flex-shrink: 0; }
	.cell-empty { color: var(--color-muted-foreground); opacity: 0.5; padding-left: 0.45rem; }

	.chips { display: flex; flex-wrap: wrap; gap: 0.25rem; }
	.chip { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.1rem 0.4rem; font-size: 0.72rem; border-radius: var(--radius-sm); background: var(--color-bg3); border: 1px solid var(--hairline); max-width: 12rem; }
	.chip.clash { border-color: color-mix(in srgb, var(--color-warning) 55%, var(--hairline)); }
	.chip-v { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	.rz-foot { display: flex; align-items: flex-end; justify-content: space-between; gap: 1rem; padding: 0.6rem 0.8rem; border-top: 1px solid var(--hairline); background: var(--color-card); flex-shrink: 0; }
	.notes { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
	.note { display: flex; align-items: center; gap: 0.35rem; font-size: 0.74rem; color: var(--color-muted-foreground); }
	.note :global(svg) { flex-shrink: 0; color: var(--color-accent); }
	.note.warn { color: var(--color-warning); }
	.note.warn :global(svg) { color: var(--color-warning); }
	.note.dim { opacity: 0.7; }
	.note.err { color: var(--color-destructive); }
	.acts { display: flex; gap: 0.5rem; flex-shrink: 0; }
</style>
