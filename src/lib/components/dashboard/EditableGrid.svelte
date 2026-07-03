<script lang="ts">
	import { browser } from '$app/environment';
	import { Pencil, Check, RotateCcw, GripVertical, Pin } from 'lucide-svelte';
	import type { Snippet } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { mergeLayout, reorder, clampSpan, type GridLayout, type Span } from './editable-grid';

	type Item = { id: string; w: number; h: number };
	let {
		id,
		items,
		cell,
		toolbar,
		canSetDefault = false,
		readonly = false,
		cols = 4,
		rowHeight = 104,
		gap = 12,
	}: {
		id: string;
		items: Item[];
		cell: Snippet<[string]>;
		/** Content rendered at the left of the toolbar row (e.g. a filter control). */
		toolbar?: Snippet;
		/** Admins: show "Save as default" (pins this layout for all org users). */
		canSetDefault?: boolean;
		/** Hide the Edit/reorder/resize affordances (no module write capability). */
		readonly?: boolean;
		cols?: number;
		rowHeight?: number;
		gap?: number;
	} = $props();

	const storageKey = $derived(`dash:layout:${id}`);
	const defaults = $derived(items.map((it) => ({ id: it.id, w: it.w, h: it.h })));
	const byId = $derived(new Map(items.map((it) => [it.id, it])));

	// Layout resolution: personal (localStorage) → org default (server) → code
	// defaults. A user's own edits always win; the admin default only fills in for
	// users who never customized.
	let saved = $state<GridLayout | null>(null);
	let serverDefault = $state<GridLayout | null>(null);
	let layout = $derived(mergeLayout(defaults, saved ?? serverDefault, cols));
	let editing = $state(false);
	let savingDefault = $state(false);
	let savedDefaultAt = $state(0); // bump to flash a "saved" tick

	$effect(() => {
		if (!browser) return;
		const raw = localStorage.getItem(storageKey);
		saved = raw ? (JSON.parse(raw) as GridLayout) : null;
	});

	// Fetch the org default (shared, admin-pinned). Best-effort; falls back to
	// code defaults if the request fails or none is set.
	$effect(() => {
		if (!browser) return;
		const key = id;
		fetch(`/api/dashboard-layouts/${encodeURIComponent(key)}`)
			.then((r) => (r.ok ? r.json() : null))
			.then((d) => {
				if (d?.layout?.order) serverDefault = d.layout as GridLayout;
			})
			.catch(() => {});
	});

	function persist(next: GridLayout) {
		saved = next;
		if (browser) localStorage.setItem(storageKey, JSON.stringify(next));
	}
	function reset() {
		// Drop the personal override → fall back to the org default (or code defaults).
		saved = null;
		if (browser) localStorage.removeItem(storageKey);
	}
	async function saveAsDefault() {
		savingDefault = true;
		try {
			const res = await fetch(`/api/dashboard-layouts/${encodeURIComponent(id)}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(layout),
			});
			if (res.ok) {
				serverDefault = layout;
				savedDefaultAt = savedDefaultAt + 1;
			}
		} finally {
			savingDefault = false;
		}
	}

	let gridEl: HTMLElement | undefined;
	let dragId = $state<string | null>(null);

	// ── Reorder (drag the grip handle; live insert before the cell under pointer) ─
	function startDrag(e: PointerEvent, itemId: string) {
		if (!editing) return;
		e.preventDefault();
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
		dragId = itemId;
	}
	function onDragMove(e: PointerEvent) {
		if (dragId == null) return;
		const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-grid-id]');
		const overId = el?.getAttribute('data-grid-id');
		if (overId && overId !== dragId) persist({ ...layout, order: reorder(layout.order, dragId, overId) });
	}
	function endDrag(e: PointerEvent) {
		if (dragId != null) (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
		dragId = null;
	}

	// ── Resize (drag the bottom-right handle; snap to grid units) ────────────────
	let resizeId: string | null = null;
	let start = { x: 0, y: 0, w: 1, h: 1 };
	function startResize(e: PointerEvent, itemId: string) {
		e.preventDefault();
		e.stopPropagation();
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
		resizeId = itemId;
		const s = layout.span[itemId];
		start = { x: e.clientX, y: e.clientY, w: s.w, h: s.h };
	}
	function onResizeMove(e: PointerEvent) {
		if (resizeId == null || !gridEl) return;
		const colUnit = (gridEl.clientWidth - gap * (cols - 1)) / cols;
		const dw = Math.round((e.clientX - start.x) / (colUnit + gap));
		const dh = Math.round((e.clientY - start.y) / (rowHeight + gap));
		const next: Span = clampSpan({ w: start.w + dw, h: start.h + dh }, cols);
		const cur = layout.span[resizeId];
		if (next.w !== cur.w || next.h !== cur.h) persist({ ...layout, span: { ...layout.span, [resizeId]: next } });
	}
	function endResize(e: PointerEvent) {
		if (resizeId != null) (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
		resizeId = null;
	}
</script>

<div class="eg-bar">
	{#if toolbar}<div class="eg-lead">{@render toolbar()}</div>{/if}
	<div class="eg-actions">
		{#if editing}
			<button class="eg-btn" onclick={reset} title={m.dash_layout_reset()}><RotateCcw size={13} /> {m.dash_layout_reset()}</button>
			{#if canSetDefault}
				<button class="eg-btn" onclick={saveAsDefault} disabled={savingDefault} title={m.dash_layout_save_default_hint()}>
					{#if savedDefaultAt > 0 && !savingDefault}<Check size={13} />{:else}<Pin size={13} />{/if}
					{m.dash_layout_save_default()}
				</button>
			{/if}
		{/if}
		{#if !readonly}
			<button class="eg-btn" class:on={editing} onclick={() => (editing = !editing)}>
				{#if editing}<Check size={13} /> {m.dash_layout_done()}{:else}<Pencil size={13} /> {m.dash_layout_edit()}{/if}
			</button>
		{/if}
	</div>
</div>

<div class="eg-wrap">
<div
	bind:this={gridEl}
	class="eg-grid"
	class:editing
	role="group"
	style:--eg-cols={cols}
	style:--eg-row={`${rowHeight}px`}
	style:--eg-gap={`${gap}px`}
	onpointermove={(e) => {
		onDragMove(e);
		onResizeMove(e);
	}}
	onpointerup={(e) => {
		endDrag(e);
		endResize(e);
	}}
>
	{#each layout.order as itemId (itemId)}
		{#if byId.has(itemId)}
			{@const span = layout.span[itemId]}
			<div
				class="eg-cell"
				class:dragging={dragId === itemId}
				data-grid-id={itemId}
				style:grid-column={`span ${span.w}`}
				style:grid-row={`span ${span.h}`}
			>
				{@render cell(itemId)}
				{#if editing}
					<!-- shield: swallow clicks so the card's own nav doesn't fire while editing -->
					<div class="eg-shield"></div>
					<button
						class="eg-grip"
						title={m.dash_layout_drag()}
						onpointerdown={(e) => startDrag(e, itemId)}
					><GripVertical size={14} /></button>
					<button
						class="eg-resize"
						title={m.dash_layout_resize()}
						aria-label={m.dash_layout_resize()}
						onpointerdown={(e) => startResize(e, itemId)}
					></button>
				{/if}
			</div>
		{/if}
	{/each}
</div>
</div>

<style>
	.eg-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
		flex-wrap: wrap;
	}
	.eg-lead {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		min-width: 0;
	}
	.eg-actions {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-left: auto;
	}
	.eg-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		height: 1.7rem;
		padding: 0 0.6rem;
		font-size: 0.74rem;
		font-weight: 600;
		border-radius: var(--radius-md);
		border: 1px solid var(--hairline);
		color: var(--color-muted-foreground);
		background: var(--color-card);
		transition: color var(--duration-fast) var(--ease-standard);
	}
	.eg-btn:hover { color: var(--color-foreground); }
	.eg-btn.on { color: var(--color-accent); border-color: color-mix(in srgb, var(--color-accent) 50%, transparent); }

	/* Container so cards stack when the grid's own width shrinks (e.g. the CRM
	   detail left column at 1:1 with both sidebars open), independent of viewport.
	   Named container — Svelte prunes anonymous @container blocks. */
	.eg-wrap { container: egwrap / inline-size; }
	.eg-grid {
		display: grid;
		grid-template-columns: repeat(var(--eg-cols), minmax(0, 1fr));
		/* Row is a MINIMUM height; cells grow to fit content (so a short span never
		   clips or shows a scrollbar). Resize sets the floor, not a hard cap. */
		grid-auto-rows: minmax(var(--eg-row), auto);
		grid-auto-flow: row dense;
		gap: var(--eg-gap);
	}
	/* Narrow container → single column, every card full-width. The cells carry
	   inline grid-column/row spans, so !important is required to override them
	   (else they land in 0px-wide tracks and overlap). ponytail: resize math still
	   assumes `cols` — fine, resizing a stacked narrow grid is an edge case. */
	@container egwrap (max-width: 620px) {
		.eg-grid { grid-template-columns: 1fr; }
		.eg-cell { grid-column: auto !important; grid-row: auto !important; }
	}
	.eg-cell {
		position: relative;
		min-width: 0;
		min-height: 0;
	}
	/* The cell's child (the card) fills the spanned area so resizing is visible.
	   overflow:hidden (not auto) — rows grow to fit content, so a scrollbar would
	   only appear on a deliberate resize-too-small; clip quietly instead. */
	.eg-cell > :global(:first-child) {
		height: 100%;
		overflow: hidden;
	}
	.eg-grid.editing .eg-cell {
		outline: 1px dashed color-mix(in srgb, var(--color-accent) 45%, transparent);
		outline-offset: 2px;
		border-radius: var(--radius-lg);
	}
	.eg-cell.dragging {
		opacity: 0.55;
		z-index: 5;
	}
	.eg-shield {
		position: absolute;
		inset: 0;
		z-index: 2;
		cursor: grab;
	}
	.eg-grip {
		position: absolute;
		top: 6px;
		left: 6px;
		z-index: 3;
		display: grid;
		place-items: center;
		width: 1.4rem;
		height: 1.4rem;
		border-radius: var(--radius-sm, 6px);
		color: var(--color-muted-foreground);
		background: color-mix(in srgb, var(--color-card) 85%, transparent);
		border: 1px solid var(--hairline);
		cursor: grab;
		touch-action: none;
	}
	.eg-grip:active { cursor: grabbing; }
	.eg-resize {
		position: absolute;
		right: 2px;
		bottom: 2px;
		z-index: 3;
		width: 1.1rem;
		height: 1.1rem;
		cursor: nwse-resize;
		touch-action: none;
		background:
			linear-gradient(
				135deg,
				transparent 0 45%,
				color-mix(in srgb, var(--color-accent) 70%, transparent) 45% 55%,
				transparent 55% 70%,
				color-mix(in srgb, var(--color-accent) 70%, transparent) 70% 80%,
				transparent 80%
			);
	}
</style>
