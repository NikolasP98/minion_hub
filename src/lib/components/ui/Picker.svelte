<script lang="ts" module>
  /** Column of the picker's browse table. */
  export interface PickerColumn<T> {
    key: string;
    label: string;
    /** Cell text; defaults to `String(row[key] ?? '')`. */
    value?: (row: T) => string;
    align?: 'left' | 'right';
  }
</script>

<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import { Plus } from 'lucide-svelte';
  import { iconSizes } from './icon-sizes';
  import * as m from '$lib/paraglide/messages';
  import { Button } from '@minion-stack/ui';
  import DraggableWindow from './foundations/DraggableWindow.svelte';

  /**
   * Picker — SAP-style selection window (spec 2026-08-23-hub-stock-crm-ux-
   * consolidation §S7). A field ("selector") opens it; the browse tab lists
   * candidate rows with search; double-clicking a row (or its + button on
   * coarse pointers, or Enter on a focused row) hands the row back to the
   * invoker via `onPick`. `multi` keeps the window open so several picks land
   * in the destination; single-pick closes on the first pick. An optional
   * "Add new" tab renders a caller-supplied create form whose result is picked
   * automatically. Desktop = draggable floating window; small screens degrade
   * to a bottom sheet via DraggableWindow's compactPresentation.
   */
  interface Props {
    open?: boolean;
    title: string;
    columns: PickerColumn<T>[];
    /** Static candidate list; filtered client-side with `searchText`. */
    rows?: T[];
    /** Async source; wins over `rows` when provided. Called on open and per search input (debounced). */
    loadRows?: (q: string) => Promise<T[]>;
    getRowId: (row: T) => string;
    /** Text used for client-side filtering of static `rows`. Defaults to joining column values. */
    searchText?: (row: T) => string;
    onPick: (row: T) => void;
    /** Keep the window open and count picks (default false = close on first pick). */
    multi?: boolean;
    /** Ids to badge as already picked (multi mode). */
    pickedIds?: ReadonlySet<string>;
    /** "Add new" tab content. Receives oncreated: call it with the new row to auto-pick it. */
    createForm?: Snippet<[{ oncreated: (row: T) => void }]>;
    searchPlaceholder?: string;
    emptyLabel?: string;
    /** localStorage key to remember window geometry. */
    storageKey?: string;
  }

  let {
    open = $bindable(false),
    title,
    columns,
    rows,
    loadRows,
    getRowId,
    searchText,
    onPick,
    multi = false,
    pickedIds,
    createForm,
    searchPlaceholder,
    emptyLabel,
    storageKey,
  }: Props = $props();

  let tab = $state<'browse' | 'create'>('browse');
  let q = $state('');
  let asyncRows = $state<T[] | null>(null);
  let loading = $state(false);
  let pickCount = $state(0);

  // Window geometry, restored per storageKey (best-effort; SSR-safe).
  // svelte-ignore state_referenced_locally -- storageKey is load-constant for a given field
  const geomKey = storageKey ? `picker:${storageKey}` : null;
  const geom = readGeom();
  let winX = $state(geom?.x ?? 120);
  let winY = $state(geom?.y ?? 96);
  let winW = $state(geom?.w ?? 640);
  let winH = $state(geom?.h ?? 480);
  function readGeom(): { x: number; y: number; w: number; h: number } | null {
    if (!geomKey || typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(geomKey);
      return raw ? (JSON.parse(raw) as { x: number; y: number; w: number; h: number }) : null;
    } catch {
      return null;
    }
  }
  function saveGeom() {
    if (!geomKey || typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(geomKey, JSON.stringify({ x: winX, y: winY, w: winW, h: winH }));
    } catch {
      /* storage full/denied — geometry memory is best-effort */
    }
  }

  let loadSeq = 0;
  async function runLoad(term: string) {
    if (!loadRows) return;
    const seq = ++loadSeq;
    loading = true;
    try {
      const out = await loadRows(term);
      if (seq === loadSeq) asyncRows = out;
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  function onSearchInput(e: Event) {
    q = (e.currentTarget as HTMLInputElement).value;
    if (!loadRows) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void runLoad(q), 250);
  }

  $effect(() => {
    if (open) {
      tab = 'browse';
      pickCount = 0;
      if (loadRows) void runLoad(q);
    }
  });

  const rowText = $derived(
    searchText ??
      ((row: T) =>
        columns
          .map((c) => cellValue(c, row))
          .join(' ')
          .toLowerCase()),
  );
  const view = $derived.by(() => {
    const base = loadRows ? (asyncRows ?? []) : (rows ?? []);
    if (loadRows || !q.trim()) return base;
    const needle = q.trim().toLowerCase();
    return base.filter((r) => rowText(r).toLowerCase().includes(needle));
  });

  function cellValue(c: PickerColumn<T>, row: T): string {
    if (c.value) return c.value(row);
    const v = (row as Record<string, unknown>)[c.key];
    return v == null ? '' : String(v);
  }

  function pick(row: T) {
    onPick(row);
    if (multi) {
      pickCount += 1;
    } else {
      open = false;
    }
  }

  function onRowKeydown(e: KeyboardEvent, row: T) {
    if (e.key === 'Enter') {
      e.preventDefault();
      pick(row);
    }
  }

  function oncreated(row: T) {
    pick(row);
    tab = 'browse';
    if (loadRows) void runLoad(q);
  }
</script>

<DraggableWindow
  bind:open
  {title}
  resizable
  resizeLabel={m.picker_resize()}
  keyboardInstructions={m.picker_keyboard_instructions()}
  compactPresentation="sheet"
  bind:x={winX}
  bind:y={winY}
  bind:width={winW}
  bind:height={winH}
  onmove={saveGeom}
  onresize={saveGeom}
  class="ui-picker"
>
  {#snippet toolbar()}
    {#if multi && pickCount > 0}
      <span class="picker-count t-caption">{m.picker_added_n({ n: pickCount })}</span>
    {/if}
  {/snippet}
  <div class="picker-body">
    {#if createForm}
      <div class="picker-tabs" role="tablist" aria-label={title}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'browse'}
          class="picker-tab"
          class:active={tab === 'browse'}
          onclick={() => (tab = 'browse')}>{m.picker_browse()}</button
        >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'create'}
          class="picker-tab"
          class:active={tab === 'create'}
          onclick={() => (tab = 'create')}
        >
          <Plus size={iconSizes.sm} aria-hidden="true" />
          {m.picker_add_new()}
        </button>
      </div>
    {/if}

    {#if tab === 'create' && createForm}
      <div class="picker-create">{@render createForm({ oncreated })}</div>
    {:else}
      <div class="picker-search">
        <input
          class="picker-search-in"
          type="search"
          placeholder={searchPlaceholder ?? m.picker_search()}
          value={q}
          oninput={onSearchInput}
        />
      </div>
      <div class="picker-table-wrap">
        <table class="picker-table">
          <thead>
            <tr>
              {#each columns as c (c.key)}
                <th class:num={c.align === 'right'}>{c.label}</th>
              {/each}
              <th class="act-col"></th>
            </tr>
          </thead>
          <tbody>
            {#each view as row (getRowId(row))}
              {@const picked = pickedIds?.has(getRowId(row)) ?? false}
              <tr
                class="picker-row"
                class:picked
                tabindex="0"
                ondblclick={() => pick(row)}
                onkeydown={(e) => onRowKeydown(e, row)}
              >
                {#each columns as c (c.key)}
                  <td class:num={c.align === 'right'}>{cellValue(c, row)}</td>
                {/each}
                <td class="act-col">
                  <Button
                    variant="ghost"
                    size="xs"
                    class="picker-add-btn"
                    aria-label={m.picker_pick_row()}
                    onclick={() => pick(row)}
                  >
                    <Plus size={iconSizes.sm} />
                  </Button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if !loading && view.length === 0}
          <p class="picker-empty t-caption">{emptyLabel ?? m.picker_empty()}</p>
        {/if}
        {#if loading}
          <p class="picker-empty t-caption">{m.common_loading()}</p>
        {/if}
      </div>
      <p class="picker-hint t-caption">{m.picker_dblclick_hint()}</p>
    {/if}
  </div>
</DraggableWindow>

<style>
  .picker-body {
    display: flex;
    min-height: 0;
    height: 100%;
    flex-direction: column;
  }
  .picker-tabs {
    display: flex;
    flex: none;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2) 0;
    border-bottom: 1px solid var(--color-border-subtle);
  }
  .picker-tab {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border: 0;
    border-bottom: 2px solid transparent;
    border-radius: var(--radius-xs) var(--radius-xs) 0 0;
    background: transparent;
    color: var(--color-text-secondary);
    font-size: var(--font-size-body);
    cursor: pointer;
  }
  .picker-tab.active {
    color: var(--color-accent);
    border-bottom-color: var(--color-accent);
  }
  .picker-tab:hover:not(.active) {
    color: var(--color-text-primary);
    background: var(--color-surface-2);
  }
  .picker-search {
    flex: none;
    padding: var(--space-2);
  }
  .picker-search-in {
    width: 100%;
    height: var(--control-height-sm);
    padding: 0 var(--space-2);
    font-size: var(--font-size-body);
    color: var(--color-text-primary);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
  }
  .picker-table-wrap {
    min-height: 0;
    flex: 1;
    overflow: auto;
    overscroll-behavior: contain;
  }
  .picker-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-body);
  }
  .picker-table th {
    position: sticky;
    top: 0;
    padding: var(--space-1) var(--space-2);
    text-align: left;
    font-weight: 500;
    color: var(--color-text-secondary);
    background: var(--color-overlay);
    border-bottom: 1px solid var(--color-border-subtle);
  }
  .picker-table td {
    padding: var(--space-1) var(--space-2);
    border-bottom: 1px solid var(--color-border-subtle);
  }
  .picker-table .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .picker-row {
    cursor: default;
    user-select: none;
  }
  .picker-row:hover {
    background: var(--color-surface-2);
  }
  .picker-row:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }
  .picker-row.picked td {
    color: var(--color-text-tertiary);
  }
  .act-col {
    width: var(--control-height-md);
    text-align: right;
  }
  /* Row + button: pointer-fine users double-click; keep the explicit button
     discoverable but quiet until the row is hovered or focused. */
  @media (pointer: fine) {
    .picker-row :global(.picker-add-btn) {
      opacity: 0;
    }
    .picker-row:hover :global(.picker-add-btn),
    .picker-row:focus-visible :global(.picker-add-btn),
    .picker-row :global(.picker-add-btn:focus-visible) {
      opacity: 1;
    }
  }
  .picker-empty {
    padding: var(--space-4);
    text-align: center;
    color: var(--color-text-tertiary);
  }
  .picker-hint {
    flex: none;
    padding: var(--space-1) var(--space-2);
    color: var(--color-text-tertiary);
    border-top: 1px solid var(--color-border-subtle);
  }
  .picker-create {
    min-height: 0;
    flex: 1;
    overflow: auto;
    padding: var(--space-3);
  }
  .picker-count {
    color: var(--color-success-fg);
    white-space: nowrap;
  }
  @media (pointer: coarse) {
    .picker-hint {
      display: none;
    }
  }
</style>
