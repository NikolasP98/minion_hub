<script lang="ts">
  import { Button, Dropdown, iconSizes } from '$lib/components/ui';
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import { Pencil, Check, RotateCcw, GripVertical, Pin } from 'lucide-svelte';
  import { tick, type Snippet } from 'svelte';
  import { preferenceOwner, preferenceKey } from '$lib/state/ui/scoped-preference.svelte';
  import * as m from '$lib/paraglide/messages';
  import {
    mergeLayout,
    reorder,
    clampSpan,
    parseGridLayout,
    type GridLayout,
    type Span,
  } from './editable-grid';
  import { loadDashboardLayout, primeDashboardLayout } from './dashboard-layout-cache';

  type Item = { id: string; w: number; h: number; label?: string };
  let {
    id,
    items,
    cell,
    toolbar,
    getItemLabel,
    canSetDefault = false,
    readonly = false,
    cols = 4,
    rowHeight = 104,
    gap = 12,
  }: {
    id: string;
    items: Item[];
    cell: Snippet<[string]>;
    getItemLabel?: (id: string) => string;
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

  const owner = $derived(preferenceOwner());
  const storageKey = $derived(preferenceKey(`dash:layout:${id}`, owner));
  const orgId = $derived(String(page.data.activeOrgId ?? ''));
  const defaults = $derived(items.map((it) => ({ id: it.id, w: it.w, h: it.h })));
  const byId = $derived(new Map(items.map((it) => [it.id, it])));
  const itemLabel = (key: string) =>
    getItemLabel?.(key) ??
    byId.get(key)?.label ??
    m.design_card_label({ position: defaults.findIndex((d) => d.id === key) + 1 });
  let saved = $state<unknown>(null);
  let serverDefault = $state<GridLayout | null>(null);
  let loadedKey = $state<string | null>(null);
  let layout = $derived(
    mergeLayout(defaults, loadedKey === storageKey ? (saved ?? serverDefault) : null, cols),
  );
  let editing = $state(false);
  let savingDefault = $state(false);
  let savedDefaultAt = $state(0);
  let saveState = $state<'idle' | 'local-only' | 'error' | 'unknown' | 'checked'>('idle');
  let announce = $state('');
  let compact = $state(false);
  let generation = 0;
  $effect(() => {
    const key = storageKey;
    const dashboard = id;
    const org = orgId;
    const actor = owner;
    const token = ++generation;
    loadedKey = key;
    saved = null;
    serverDefault = null;
    editing = false;
    savingDefault = false;
    savedDefaultAt = 0;
    saveState = 'idle';
    dragId = null;
    resizeId = null;
    if (!browser) return;
    try {
      const raw = key ? localStorage.getItem(key) : null;
      saved = raw ? JSON.parse(raw) : null;
    } catch {
      saved = null;
      saveState = 'local-only';
    }
    if (!actor) return;
    void loadDashboardLayout(org, dashboard)
      .then((value) => {
        if (token === generation && owner === actor && id === dashboard) serverDefault = value;
      })
      .catch(() => {
        if (token === generation && owner === actor) saveState = 'error';
      });
  });
  $effect(() => {
    if (!gridEl || typeof ResizeObserver === 'undefined') return;
    const el = gridEl;
    compact = el.clientWidth <= 620;
    const observer = new ResizeObserver(() => {
      compact = el.clientWidth <= 620;
    });
    observer.observe(el);
    return () => observer.disconnect();
  });
  function persist(next: GridLayout) {
    if (readonly || loadedKey !== storageKey) return;
    saved = { ...next, version: 1 };
    loadedKey = storageKey;
    savedDefaultAt = 0;
    try {
      if (!storageKey) {
        saveState = 'local-only';
        return;
      }
      localStorage.setItem(storageKey, JSON.stringify(saved));
      if (saveState !== 'unknown') saveState = 'idle';
    } catch {
      if (saveState !== 'unknown') saveState = 'local-only';
    }
  }
  function reset() {
    if (loadedKey !== storageKey || readonly) return;
    saved = null;
    savedDefaultAt = 0;
    try {
      if (storageKey) localStorage.removeItem(storageKey);
      if (saveState !== 'unknown') saveState = 'idle';
    } catch {
      if (saveState !== 'unknown') saveState = 'local-only';
    }
    announce = m.dash_layout_reset();
  }
  async function saveAsDefault() {
    if (
      savingDefault ||
      saveState === 'unknown' ||
      !owner ||
      readonly ||
      !canSetDefault ||
      loadedKey !== storageKey
    )
      return;
    const actor = owner;
    const dashboard = id;
    const org = orgId;
    const token = generation;
    const snapshot = structuredClone($state.snapshot({ ...layout, version: 1 as const }));
    savingDefault = true;
    savedDefaultAt = 0;
    try {
      const res = await fetch(`/api/dashboard-layouts/${encodeURIComponent(dashboard)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(snapshot),
      });
      if (owner !== actor || id !== dashboard || generation !== token) return;
      if (!res.ok) {
        saveState = res.status >= 500 ? 'unknown' : 'error';
        return;
      }
      serverDefault = snapshot;
      primeDashboardLayout(org, dashboard, snapshot);
      savedDefaultAt =
        JSON.stringify({ ...layout, version: 1 }) === JSON.stringify(snapshot)
          ? savedDefaultAt + 1
          : 0;
      saveState = 'idle';
    } catch {
      if (owner === actor && generation === token) saveState = 'unknown';
    } finally {
      if (owner === actor && generation === token) savingDefault = false;
    }
  }
  async function reconcileDefault() {
    const actor = owner;
    const dashboard = id;
    const token = generation;
    if (!actor || savingDefault) return;
    savingDefault = true;
    try {
      const res = await fetch(`/api/dashboard-layouts/${encodeURIComponent(dashboard)}`);
      if (!res.ok) throw new Error('read failed');
      const body = await res.json();
      if (owner !== actor || id !== dashboard || generation !== token) return;
      serverDefault = parseGridLayout(body.layout);
      saveState = 'checked';
    } catch {
      /* Keep the unresolved write blocked until a successful read. */
    } finally {
      if (owner === actor && generation === token) savingDefault = false;
    }
  }
  const commands = (key: string) => {
    const label = itemLabel(key);
    const index = layout.order.indexOf(key);
    const size = layout.span[key];
    return [
      { value: 'up', label: m.design_move_before({ label }), disabled: index === 0 },
      {
        value: 'down',
        label: m.design_move_after({ label }),
        disabled: index === layout.order.length - 1,
      },
      { value: 'wider', label: m.design_wider({ label }), disabled: compact || size.w >= cols },
      { value: 'narrower', label: m.design_narrower({ label }), disabled: compact || size.w <= 1 },
      { value: 'taller', label: m.design_taller({ label }), disabled: size.h >= 8 },
      { value: 'shorter', label: m.design_shorter({ label }), disabled: size.h <= 1 },
      {
        value: 'visibility',
        label: layout.hidden?.includes(key) ? m.design_show({ label }) : m.design_hide({ label }),
      },
    ];
  };
  async function arrange(key: string, command: string) {
    if (readonly || !editing || commands(key).find((c) => c.value === command)?.disabled) return;
    const next = { ...layout, order: [...layout.order], span: { ...layout.span } };
    const index = next.order.indexOf(key);
    if (command === 'up' || command === 'down') {
      const other = index + (command === 'up' ? -1 : 1);
      [next.order[index], next.order[other]] = [next.order[other], next.order[index]];
    } else if (command === 'visibility')
      next.hidden = next.hidden?.includes(key)
        ? next.hidden.filter((x) => x !== key)
        : [...(next.hidden ?? []), key];
    else {
      const size = next.span[key];
      next.span[key] = clampSpan(
        {
          w: size.w + (command === 'wider' ? 1 : command === 'narrower' ? -1 : 0),
          h: size.h + (command === 'taller' ? 1 : command === 'shorter' ? -1 : 0),
        },
        cols,
      );
    }
    persist(next);
    announce =
      command === 'visibility'
        ? next.hidden?.includes(key)
          ? m.design_hide({ label: itemLabel(key) })
          : m.design_show({ label: itemLabel(key) })
        : m.design_layout_changed({
            label: itemLabel(key),
            position: next.order.indexOf(key) + 1,
            width: next.span[key].w,
            height: next.span[key].h,
          });
    await tick();
    gridEl
      ?.querySelector<HTMLElement>(`[data-grid-id="${CSS.escape(key)}"] .eg-menu button`)
      ?.focus();
  }

  let gridEl: HTMLElement | undefined;
  let dragId = $state<string | null>(null);

  // ── Reorder (drag the grip handle; live insert before the cell under pointer) ─
  function startDrag(e: PointerEvent, itemId: string) {
    if (!editing || readonly) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragId = itemId;
  }
  function onDragMove(e: PointerEvent) {
    if (dragId == null) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-grid-id]');
    const overId = el?.getAttribute('data-grid-id');
    if (overId && overId !== dragId)
      persist({ ...layout, order: reorder(layout.order, dragId, overId) });
  }
  function endDrag(e: PointerEvent) {
    if (dragId != null) (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    dragId = null;
  }

  // ── Resize (drag the bottom-right handle; snap to grid units) ────────────────
  let resizeId: string | null = null;
  let start = { x: 0, y: 0, w: 1, h: 1 };
  function startResize(e: PointerEvent, itemId: string) {
    if (!editing || readonly || compact) return;
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
    if (next.w !== cur.w || next.h !== cur.h)
      persist({ ...layout, span: { ...layout.span, [resizeId]: next } });
  }
  function endResize(e: PointerEvent) {
    if (resizeId != null) (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    resizeId = null;
  }
</script>

<div class="eg-bar view-toolbar">
  {#if toolbar}<div class="eg-lead">{@render toolbar()}</div>{/if}
  <div class="eg-actions">
    {#if editing}
      <Button variant="ghost" class="eg-btn" onclick={reset} title={m.dash_layout_reset()}
        ><RotateCcw size={iconSizes.sm} /> {m.dash_layout_reset()}</Button
      >
      {#if canSetDefault}
        <Button
          variant="ghost"
          class="eg-btn"
          onclick={saveAsDefault}
          disabled={savingDefault || saveState === 'unknown' || !owner}
          title={m.dash_layout_save_default_hint()}
        >
          {#if savedDefaultAt > 0 && !savingDefault}<Check size={iconSizes.sm} />{:else}<Pin
              size={iconSizes.sm}
            />{/if}
          {m.dash_layout_save_default()}
        </Button>
      {/if}
    {/if}
    {#if !readonly}
      <Button
        variant="ghost"
        class="eg-btn {editing ? 'on' : ''}"
        onclick={() => (editing = !editing)}
      >
        {#if editing}<Check size={iconSizes.sm} /> {m.dash_layout_done()}{:else}<Pencil
            size={iconSizes.sm}
          />
          {m.dash_layout_edit()}{/if}
      </Button>
    {/if}
  </div>
</div>

<div class="sr-only" aria-live="polite">{announce}</div>
{#if saveState !== 'idle'}
  <div class="eg-status t-caption" role="status">
    {saveState === 'unknown'
      ? m.design_save_unknown()
      : saveState === 'error'
        ? m.design_save_failed()
        : saveState === 'checked'
          ? m.design_reconciled()
          : m.design_local_only()}
    {#if saveState === 'unknown'}<Button
        variant="secondary"
        disabled={savingDefault}
        onclick={reconcileDefault}>{m.design_reconcile()}</Button
      >{/if}
  </div>
{/if}
{#if editing && compact}<p class="t-caption">{m.design_compact_width()}</p>{/if}
<div class="eg-wrap" data-component="editable-grid">
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
    onpointercancel={(e) => {
      endDrag(e);
      endResize(e);
    }}
    onpointerup={(e) => {
      endDrag(e);
      endResize(e);
    }}
  >
    {#each layout.order as itemId (itemId)}
      {#if byId.has(itemId) && (editing || !layout.hidden?.includes(itemId))}
        {@const span = layout.span[itemId]}
        <div
          class="eg-cell"
          class:dragging={dragId === itemId}
          class:eg-hidden={layout.hidden?.includes(itemId)}
          data-grid-id={itemId}
          style:grid-column={`span ${span.w}`}
          style:grid-row={`span ${span.h}`}
        >
          {@render cell(itemId)}
          {#if editing}
            <!-- shield: swallow clicks so the card's own nav doesn't fire while editing -->
            <div class="eg-shield"></div>
            <div class="eg-menu">
              <Dropdown items={commands(itemId)} onSelect={(command) => arrange(itemId, command)}>
                {#snippet trigger()}<span class="t-caption">{itemLabel(itemId)}</span><Pencil
                    size={iconSizes.sm}
                  />{/snippet}
              </Dropdown>
            </div>
            <Button
              variant="ghost"
              class="eg-grip"
              title={m.dash_layout_drag()}
              aria-label={`${m.dash_layout_drag()}: ${itemLabel(itemId)}`}
              onpointerdown={(e: PointerEvent) => startDrag(e, itemId)}
              ><GripVertical size={iconSizes.sm} /></Button
            >
            <Button
              variant="ghost"
              class="eg-resize"
              title={m.dash_layout_resize()}
              aria-label={`${m.dash_layout_resize()}: ${itemLabel(itemId)}`}
              disabled={compact}
              onpointerdown={(e: PointerEvent) => startResize(e, itemId)}
            ></Button>
          {/if}
        </div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .eg-menu {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    z-index: var(--layer-base);
    max-width: calc(100% - var(--space-8));
    background: var(--color-surface-1);
    padding: var(--space-1);
    border-radius: var(--radius-sm);
  }
  .eg-menu :global(button) {
    min-height: var(--control-height-md);
    gap: var(--space-1);
    max-width: 100%;
  }
  .eg-menu :global(span) {
    overflow-wrap: anywhere;
  }
  .eg-hidden > :global(:first-child) {
    opacity: 0.35;
  }
  .eg-status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  /* .eg-bar's shape comes from the shared `.view-toolbar` contract (app.css). */
  .eg-lead {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
    min-width: 0;
  }
  .eg-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-left: auto;
  }
  :global(.eg-btn) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    height: 1.7rem;
    padding: 0 var(--space-2);
    font-size: var(--font-size-caption);
    font-weight: 600;
    border-radius: var(--radius-md);
    border: 1px solid var(--hairline);
    color: var(--color-muted-foreground);
    background: var(--color-card);
    transition: color var(--duration-fast) var(--ease-standard);
  }
  :global(.eg-btn:hover) {
    color: var(--color-foreground);
  }
  :global(.eg-btn.on) {
    color: var(--color-accent);
    border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
  }

  /* Container so cards stack when the grid's own width shrinks (e.g. the CRM
	   detail left column at 1:1 with both sidebars open), independent of viewport.
	   Named container — Svelte prunes anonymous @container blocks. */
  .eg-wrap {
    container: egwrap / inline-size;
  }
  .eg-grid {
    display: grid;
    grid-template-columns: repeat(var(--eg-cols), minmax(0, 1fr));
    /* Row is a MINIMUM height; cells grow to fit content (so a short span never
		   clips or shows a scrollbar). Resize sets the floor, not a hard cap. */
    grid-auto-rows: minmax(var(--eg-row), auto);
    grid-auto-flow: row;
    gap: var(--eg-gap);
  }
  /* Narrow container → single column, every card full-width. The cells carry
	   inline grid-column/row spans, so !important is required to override them
	   (else they land in 0px-wide tracks and overlap). Compact controls preserve desktop spans. */
  @container egwrap (max-width: 620px) {
    .eg-grid {
      grid-template-columns: 1fr;
    }
    .eg-cell {
      grid-column: auto !important;
      grid-row: auto !important;
    }
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
    z-index: var(--layer-sticky);
  }
  .eg-shield {
    position: absolute;
    inset: 0;
    z-index: var(--layer-base);
    cursor: grab;
  }
  :global(.eg-grip) {
    position: absolute;
    top: 6px;
    left: 6px;
    z-index: var(--layer-base);
    display: grid;
    place-items: center;
    width: 1.4rem;
    height: 1.4rem;
    border-radius: var(--radius-sm);
    color: var(--color-muted-foreground);
    background: color-mix(in srgb, var(--color-card) 85%, transparent);
    border: 1px solid var(--hairline);
    cursor: grab;
    touch-action: none;
  }
  :global(.eg-grip:active) {
    cursor: grabbing;
  }
  :global(.eg-resize) {
    position: absolute;
    right: 2px;
    bottom: 2px;
    z-index: var(--layer-base);
    width: 1.1rem;
    height: 1.1rem;
    cursor: nwse-resize;
    touch-action: none;
    background: linear-gradient(
      135deg,
      transparent 0 45%,
      color-mix(in srgb, var(--color-accent) 70%, transparent) 45% 55%,
      transparent 55% 70%,
      color-mix(in srgb, var(--color-accent) 70%, transparent) 70% 80%,
      transparent 80%
    );
  }
</style>
