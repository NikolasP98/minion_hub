<script lang="ts" module>
  export type {
    PickerColumn,
    PickerCreateConfig,
    PickerCreateContext,
    PickerDuplicatePolicy,
    PickerLoadResult,
    PickerRowAction,
    PickerSelectionMode,
  } from './picker';
</script>

<script lang="ts" generics="T">
  import { onDestroy, onMount, tick, untrack, type Snippet } from 'svelte';
  import { Check, Columns3, Plus, RotateCcw, Search, SearchX, Trash2, X } from 'lucide-svelte';
  import { Button, Checkbox, Input } from '@minion-stack/ui';
  import * as m from '$lib/paraglide/messages';
  import EmptyState from './EmptyState.svelte';
  import { iconSizes } from './icon-sizes';
  import DataTable, {
    type DataCellContext,
    type DataColumn,
  } from '$lib/components/data-table/DataTable.svelte';
  import DraggableWindow from './foundations/DraggableWindow.svelte';
  import {
    defaultPickerHidden,
    effectivePickerPickedIds,
    orderPickerColumns,
    pickerRowAction,
    pickerRowIsDuplicate,
    reconcilePickerHidden,
    type PickerColumn,
    type PickerCreateConfig,
    type PickerDuplicatePolicy,
    type PickerLoadResult,
    type PickerRowAction,
    type PickerSelectionMode,
  } from './picker';

  interface Props {
    open?: boolean;
    title: string;
    subtitle?: string;
    columns: PickerColumn<T>[];
    /** Static candidate list; filtered client-side with `searchText`. */
    rows?: T[];
    /** Async source; wins over `rows` and may report a server-side total. */
    loadRows?: (query: string) => Promise<PickerLoadResult<T>>;
    getRowId: (row: T) => string;
    /** Text used for static filtering. Defaults to searchable visible columns. */
    searchText?: (row: T) => string;
    onPick: (row: T) => void;
    /**
     * Drop an already-picked row from the invoking form. Supplying it turns the
     * browse rows into toggles: picked rows become removable instead of inert.
     * Without it a picked row stays blocked, so a picker whose form cannot
     * remove entries never offers an action it can't honor.
     */
    onUnpick?: (row: T) => void;
    onclose?: () => void;
    selectionMode?: PickerSelectionMode;
    /** @deprecated Use `selectionMode="multiple"`. */
    multi?: boolean;
    duplicatePolicy?: PickerDuplicatePolicy;
    /** Existing selections in the invoking form. Required for set-like behavior across reopen. */
    pickedIds?: ReadonlySet<string>;
    isRowDisabled?: (row: T) => boolean;
    rowDisabledReason?: (row: T) => string | undefined;
    create?: PickerCreateConfig<T>;
    /** Compatibility with the initial picker contract. Prefer `create`. */
    createForm?: Snippet<[{ oncreated: (row: T) => void }]>;
    columnsConfigurable?: boolean;
    searchPlaceholder?: string;
    emptyLabel?: string;
    initialSearch?: string;
    /** localStorage namespace for geometry and optional column choices. */
    storageKey?: string;
  }

  let {
    open = $bindable(false),
    title,
    subtitle,
    columns,
    rows,
    loadRows,
    getRowId,
    searchText,
    onPick,
    onUnpick,
    onclose,
    selectionMode,
    multi = false,
    duplicatePolicy = 'prevent',
    pickedIds,
    isRowDisabled,
    rowDisabledReason,
    create,
    createForm,
    columnsConfigurable = false,
    searchPlaceholder,
    emptyLabel,
    initialSearch = '',
    storageKey,
  }: Props = $props();

  const pickerId = $props.id();
  const browseTabId = `${pickerId}-browse-tab`;
  const browsePanelId = `${pickerId}-browse-panel`;
  const createTabId = `${pickerId}-create-tab`;
  const createPanelId = `${pickerId}-create-panel`;
  const searchId = `${pickerId}-search`;

  const resolvedSelectionMode = $derived<PickerSelectionMode>(
    selectionMode ?? (multi ? 'multiple' : 'single'),
  );
  const hasCreate = $derived(Boolean(create || createForm));

  let activeTab = $state<'browse' | 'create'>('browse');
  let createTabOpen = $state(false);
  // svelte-ignore state_referenced_locally -- initialSearch seeds editable search state once
  let q = $state(initialSearch);
  let asyncRows = $state<T[] | null>(null);
  let asyncTotal = $state<number | null>(null);
  let createdRows = $state<T[]>([]);
  let loading = $state(false);
  let loadFailed = $state(false);
  let sessionPickedIds = $state<Set<string>>(new Set());
  const noSessionPickedIds = new Set<string>();
  let tableWrapEl = $state<HTMLDivElement | null>(null);
  let columnPanelEl = $state<HTMLDivElement | null>(null);
  let columnPanelOpen = $state(false);

  // svelte-ignore state_referenced_locally -- one picker instance owns one persistence namespace
  const geometryKey = storageKey ? `picker:${storageKey}:geometry` : null;
  // svelte-ignore state_referenced_locally -- one picker instance owns one persistence namespace
  const columnKey = storageKey ? `picker:${storageKey}:columns` : null;
  const geometry = readGeometry();
  let winX = $state(geometry?.x ?? 120);
  let winY = $state(geometry?.y ?? 96);
  let winW = $state(geometry?.w ?? 720);
  let winH = $state(geometry?.h ?? 520);

  function readGeometry(): { x: number; y: number; w: number; h: number } | null {
    if (!geometryKey || typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(geometryKey);
      return raw ? (JSON.parse(raw) as { x: number; y: number; w: number; h: number }) : null;
    } catch {
      return null;
    }
  }

  function saveGeometry() {
    if (!geometryKey || typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(geometryKey, JSON.stringify({ x: winX, y: winY, w: winW, h: winH }));
    } catch {
      // Geometry persistence is best-effort; the picker remains fully usable.
    }
  }

  const orderedColumns = $derived(orderPickerColumns(columns));
  // svelte-ignore state_referenced_locally -- seeded once, then reconciled when columns change
  let hiddenColumns = $state<Set<string>>(defaultPickerHidden(columns));
  const visibleColumns = $derived(
    orderedColumns.filter((column) => !hiddenColumns.has(column.key)),
  );

  onMount(() => {
    if (!columnKey) return;
    try {
      const raw = localStorage.getItem(columnKey);
      if (raw) hiddenColumns = reconcilePickerHidden(columns, JSON.parse(raw) as string[]);
    } catch {
      hiddenColumns = defaultPickerHidden(columns);
    }
  });

  $effect(() => {
    const currentColumns = columns;
    untrack(() => {
      hiddenColumns = reconcilePickerHidden(currentColumns, hiddenColumns);
    });
  });

  function persistColumns(next: Set<string>) {
    hiddenColumns = reconcilePickerHidden(columns, next);
    if (!columnKey || typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(columnKey, JSON.stringify([...hiddenColumns]));
    } catch {
      // Column preferences are optional; keep the in-memory choice.
    }
  }

  function toggleColumn(column: PickerColumn<T>) {
    if (column.hideable === false) return;
    const next = new Set(hiddenColumns);
    if (next.has(column.key)) next.delete(column.key);
    else if (visibleColumns.length > 1) next.add(column.key);
    persistColumns(next);
  }

  function resetColumns() {
    persistColumns(defaultPickerHidden(columns));
  }

  let loadSequence = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  async function runLoad(term: string) {
    if (!loadRows) return;
    const sequence = ++loadSequence;
    loading = true;
    loadFailed = false;
    try {
      const result = await loadRows(term);
      if (sequence !== loadSequence) return;
      if (Array.isArray(result)) {
        asyncRows = result;
        asyncTotal = result.length;
      } else {
        asyncRows = result.rows;
        asyncTotal = result.total ?? result.rows.length;
      }
    } catch {
      if (sequence === loadSequence) loadFailed = true;
    } finally {
      if (sequence === loadSequence) loading = false;
    }
  }

  function onSearchInput(event: Event) {
    q = (event.currentTarget as HTMLInputElement).value;
    if (!loadRows) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void runLoad(q), 250);
  }

  function focusSearch() {
    void tick().then(() => document.getElementById(searchId)?.focus());
  }

  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      activeTab = 'browse';
      createTabOpen = false;
      createTouched = false;
      columnPanelOpen = false;
      sessionPickedIds = new Set();
      q = initialSearch;
      if (loadRows) void runLoad(q);
      focusSearch();
    }
    wasOpen = open;
  });

  onDestroy(() => {
    clearTimeout(debounceTimer);
    loadSequence += 1;
  });

  const rowText = $derived(
    searchText ??
      ((row: T) =>
        orderedColumns
          .filter((column) => column.searchable !== false)
          .map((column) => cellValue(column, row))
          .join(' ')),
  );

  const sourceRows = $derived.by(() => {
    const source = loadRows ? (asyncRows ?? []) : (rows ?? []);
    const merged = new Map<string, T>();
    for (const row of [...createdRows, ...source]) merged.set(getRowId(row), row);
    return [...merged.values()];
  });

  const view = $derived.by(() => {
    if (loadRows || !q.trim()) return sourceRows;
    const needle = q.trim().toLocaleLowerCase();
    return sourceRows.filter((row) => rowText(row).toLocaleLowerCase().includes(needle));
  });
  const resultTotal = $derived(loadRows ? (asyncTotal ?? view.length) : view.length);
  const effectivePickedIds = $derived(effectivePickerPickedIds(pickedIds, sessionPickedIds));
  const selectedCount = $derived(effectivePickedIds.size);

  /** The column that identifies the primitive — it absorbs the pane's leftover
      width, the way the old auto-layout table gave it the slack. */
  const primaryColumnKey = $derived(
    (
      visibleColumns.find((column) => column.emphasis === 'primary') ??
      visibleColumns.find((column) => !column.emphasis) ??
      visibleColumns[0]
    )?.key,
  );

  /** `PickerColumn` → `DataColumn`. Picker owns search, ordering and visibility,
      so the grid gets no sort/filter/hide of its own; only widths stay adjustable
      (owner directive: every primitive table view lets you resize columns). */
  const dataColumns = $derived<DataColumn<T>[]>(
    visibleColumns.map((column) => ({
      key: column.key,
      label: column.label,
      accessor: (row: T) => cellValue(column, row),
      align: column.align,
      sortable: false,
      hideable: false,
      fill: column.key === primaryColumnKey,
      cellClass: column.key === primaryColumnKey ? 'picker-cell-primary' : undefined,
    })),
  );

  /** A column's `render` snippet, per column key — the grid's `cells` record is
      what replaces the picker's own `{@render column.render(row)}` branch. */
  const cellSnippets = $derived.by(() => {
    const out: Record<string, Snippet<[T, DataColumn<T>, DataCellContext]>> = {};
    for (const column of visibleColumns) if (column.render) out[column.key] = column.render;
    return out;
  });

  function cellValue(column: PickerColumn<T>, row: T): string {
    if (column.value) return column.value(row);
    const value = (row as Record<string, unknown>)[column.key];
    return value == null ? '' : String(value);
  }

  function duplicate(row: T): boolean {
    return pickerRowIsDuplicate(
      getRowId(row),
      resolvedSelectionMode,
      duplicatePolicy,
      pickedIds,
      pickedIds ? noSessionPickedIds : sessionPickedIds,
    );
  }

  const canUnpick = $derived(Boolean(onUnpick));

  function rowAction(row: T): PickerRowAction {
    return pickerRowAction({
      picked: effectivePickedIds.has(getRowId(row)),
      canUnpick,
      duplicate: duplicate(row),
    });
  }

  function disabled(row: T): boolean {
    return rowAction(row) === 'blocked' || isRowDisabled?.(row) === true;
  }

  /** One entry point for row activation, so click, double-click, and Enter/Space
      can never diverge on what a row does. */
  function toggle(row: T) {
    if (isRowDisabled?.(row) === true) return;
    if (rowAction(row) === 'remove') {
      unpick(row);
      return;
    }
    pick(row);
  }

  function pick(row: T) {
    if (disabled(row)) return;
    onPick(row);
    if (resolvedSelectionMode === 'multiple') {
      if (!pickedIds) sessionPickedIds = new Set(sessionPickedIds).add(getRowId(row));
    } else {
      closeWindow();
    }
  }

  function unpick(row: T) {
    onUnpick?.(row);
    // Only the session mirror needs pruning; a consumer-supplied `pickedIds` is
    // authoritative and re-derives itself from the form it just mutated.
    if (pickedIds) return;
    const next = new Set(sessionPickedIds);
    next.delete(getRowId(row));
    sessionPickedIds = next;
  }

  function pickerRowClass(row: T): string {
    const classes = ['picker-row'];
    if (effectivePickedIds.has(getRowId(row))) classes.push('picker-row-picked');
    if (disabled(row)) classes.push('picker-row-disabled');
    return classes.join(' ');
  }

  /** The grid renders the rows, so row activation is read back off the DOM:
      `data-row-index` indexes the same `view` array the grid was handed.
      TODO(handoff): needs DataTable `onRowActivate` (double-click / Enter on the
      focused row) — `onRowClick` would make a SINGLE click pick a row, which
      contradicts the picker's own hint copy and would add a line to the invoking
      form on a stray click. Drop this delegation once the grid owns the gesture. */
  function rowFromIndex(index: number): T | undefined {
    return Number.isInteger(index) ? view[index] : undefined;
  }

  function rowFromElement(element: Element | null | undefined): T | undefined {
    const host = element?.closest<HTMLElement>('[data-row-index]');
    return host ? rowFromIndex(Number(host.dataset.rowIndex)) : undefined;
  }

  function onGridDblClick(event: MouseEvent) {
    const target = event.target as Element | null;
    if (target?.closest('button')) return;
    const row = rowFromElement(target);
    if (row) toggle(row);
  }

  /** Enter/Space on the grid's roving row focus (DataTable marks it `.focused`).
      Bound in the CAPTURE phase: the grid's own hotkey layer stops propagation,
      so a bubble-phase listener here would never run. */
  function onGridKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target as Element | null;
    if (target?.closest('button, input, select, textarea')) return;
    const row = rowFromElement(tableWrapEl?.querySelector('.dt-row.focused'));
    if (!row) return;
    event.preventDefault();
    toggle(row);
  }

  function onSearchKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' || view.length === 0) return;
    event.preventDefault();
    // Hand the same keypress to the grid's own roving row focus, so ArrowDown
    // out of the search box still lands on the first row.
    const pane = tableWrapEl?.querySelector<HTMLElement>('.dt-scroll');
    if (!pane) return;
    pane.focus();
    pane.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  }

  // Discard guard for the "Agregar rápido" create tab: a typed-into field
  // marks it touched, and dismissing the tab (its own X, or closing the whole
  // window) while touched confirms first — same loss this tray-level fix
  // exists for, one level down.
  let createTouched = $state(false);
  function handleCreateInput() {
    createTouched = true;
  }
  function confirmDiscardCreate(): boolean {
    return typeof window === 'undefined' || window.confirm(m.dialog_discardMessage());
  }

  function openCreateTab() {
    if (!hasCreate) return;
    createTabOpen = true;
    createTouched = false;
    activeTab = 'create';
    columnPanelOpen = false;
  }

  function dismissCreateTab() {
    activeTab = 'browse';
    createTabOpen = false;
    createTouched = false;
    focusSearch();
  }

  function closeCreateTab() {
    if (createTouched && !confirmDiscardCreate()) return;
    dismissCreateTab();
  }

  function oncreated(row: T) {
    createdRows = [
      row,
      ...createdRows.filter((candidate) => getRowId(candidate) !== getRowId(row)),
    ];
    pick(row);
    if (open) {
      // A successful create is not a discard — bypass the touched guard.
      dismissCreateTab();
      if (loadRows) void runLoad(q);
    }
  }

  function closeWindow() {
    if (!open) return;
    if (createTabOpen && createTouched && !confirmDiscardCreate()) return;
    open = false;
    columnPanelOpen = false;
    createTouched = false;
    onclose?.();
  }

  function handleDocumentPointerDown(event: PointerEvent) {
    if (columnPanelOpen && event.target instanceof Node && !columnPanelEl?.contains(event.target)) {
      columnPanelOpen = false;
    }
  }

  function handleDocumentKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && columnPanelOpen) {
      event.stopPropagation();
      columnPanelOpen = false;
    }
  }
</script>

<svelte:document
  onpointerdown={handleDocumentPointerDown}
  onkeydowncapture={handleDocumentKeydown}
/>

<DraggableWindow
  {open}
  {title}
  resizable
  resizeLabel={m.picker_resize()}
  keyboardInstructions={m.picker_keyboard_instructions()}
  compactPresentation="sheet"
  bind:x={winX}
  bind:y={winY}
  bind:width={winW}
  bind:height={winH}
  onmove={saveGeometry}
  onresize={saveGeometry}
  onclose={closeWindow}
  class="ui-picker"
>
  {#snippet titleContent()}
    {#if createTabOpen}
      <div class="picker-title-tabs" role="tablist" aria-label={title}>
        <div class="picker-title-tab" class:active={activeTab === 'browse'}>
          <button
            type="button"
            role="tab"
            id={browseTabId}
            aria-controls={browsePanelId}
            aria-selected={activeTab === 'browse'}
            tabindex={activeTab === 'browse' ? 0 : -1}
            class="picker-title-tab-trigger"
            onclick={() => {
              activeTab = 'browse';
              focusSearch();
            }}
          >
            {title}
          </button>
          <button
            type="button"
            class="picker-title-tab-close"
            aria-label={m.window_close()}
            onclick={closeWindow}
          >
            <X size={iconSizes.xs} aria-hidden="true" />
          </button>
        </div>
        <div class="picker-title-tab" class:active={activeTab === 'create'}>
          <button
            type="button"
            role="tab"
            id={createTabId}
            aria-controls={createPanelId}
            aria-selected={activeTab === 'create'}
            tabindex={activeTab === 'create' ? 0 : -1}
            class="picker-title-tab-trigger"
            onclick={() => (activeTab = 'create')}
          >
            <Plus size={iconSizes.sm} aria-hidden="true" />
            {create?.tabLabel ?? create?.label ?? m.picker_add_new()}
          </button>
          <button
            type="button"
            class="picker-title-tab-close"
            aria-label={m.picker_close_create_tab()}
            onclick={closeCreateTab}
          >
            <X size={iconSizes.xs} aria-hidden="true" />
          </button>
        </div>
      </div>
    {:else}
      <span class="picker-window-title">{title}</span>
    {/if}
  {/snippet}

  {#snippet toolbar()}
    {#if resolvedSelectionMode === 'multiple' && selectedCount > 0}
      <span class="picker-count t-caption">{m.picker_selected_n({ n: selectedCount })}</span>
    {/if}
  {/snippet}

  <div class="picker-shell">
    {#if subtitle}
      <p class="picker-subtitle t-caption">{subtitle}</p>
    {/if}

    {#if activeTab === 'create' && createTabOpen}
      <div
        id={createPanelId}
        role="tabpanel"
        aria-labelledby={createTabId}
        class="picker-create"
        oninputcapture={handleCreateInput}
        onchangecapture={handleCreateInput}
      >
        {#if create?.description}<p class="picker-create-copy t-body">{create.description}</p>{/if}
        {#if create}
          {@render create.form({ oncreated, oncancel: closeCreateTab, query: q })}
        {:else if createForm}
          {@render createForm({ oncreated })}
        {/if}
      </div>
    {:else}
      <div
        id={browsePanelId}
        role={createTabOpen ? 'tabpanel' : undefined}
        aria-labelledby={createTabOpen ? browseTabId : undefined}
        class="picker-browse"
      >
        <div class="picker-toolbar">
          <div class="picker-search-wrap">
            {#snippet searchIcon()}<Search size={iconSizes.sm} aria-hidden="true" />{/snippet}
            <Input
              id={searchId}
              type="search"
              size="sm"
              class="picker-search-field"
              leading={searchIcon}
              placeholder={searchPlaceholder ?? m.picker_search()}
              aria-label={searchPlaceholder ?? m.picker_search()}
              bind:value={q}
              oninput={onSearchInput}
              onkeydown={onSearchKeydown}
            />
          </div>
          <span class="picker-results t-caption" aria-live="polite">
            {m.picker_results({ n: resultTotal })}
          </span>
          <div class="picker-actions">
            {#if columnsConfigurable}
              <div class="picker-column-control" bind:this={columnPanelEl}>
                <Button
                  variant="ghost"
                  size="sm"
                  shape="icon"
                  aria-label={m.data_table_columns()}
                  aria-expanded={columnPanelOpen}
                  onclick={() => (columnPanelOpen = !columnPanelOpen)}
                >
                  <Columns3 size={iconSizes.md} aria-hidden="true" />
                </Button>
                {#if columnPanelOpen}
                  <div class="picker-column-panel">
                    <div class="picker-column-head">
                      <span class="t-label">{m.data_table_columns_heading()}</span>
                      <Button
                        variant="ghost"
                        size="xs"
                        onclick={resetColumns}
                        aria-label={m.picker_reset_columns()}
                      >
                        <RotateCcw size={iconSizes.xs} aria-hidden="true" />
                        {m.common_reset()}
                      </Button>
                    </div>
                    <div class="picker-column-list">
                      {#each orderedColumns as column (column.key)}
                        <Checkbox
                          label={column.label}
                          checked={!hiddenColumns.has(column.key)}
                          disabled={column.hideable === false ||
                            (!hiddenColumns.has(column.key) && visibleColumns.length === 1)}
                          onchange={() => toggleColumn(column)}
                        />
                      {/each}
                    </div>
                  </div>
                {/if}
              </div>
            {/if}
            {#if hasCreate}
              <Button variant="primary" size="sm" onclick={openCreateTab}>
                <Plus size={iconSizes.sm} aria-hidden="true" />
                {create?.label ?? m.picker_add_new()}
              </Button>
            {/if}
          </div>
        </div>

        <!-- Gesture host for the grid inside it: double-click and Enter/Space are
             delegated here because DataTable owns the rows (see onGridDblClick).
             The grid keeps the interactive roles; this wrapper adds none. -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="picker-table-wrap"
          bind:this={tableWrapEl}
          ondblclick={onGridDblClick}
          onkeydowncapture={onGridKeydown}
        >
          {#snippet pickerError()}
            <EmptyState
              compact
              icon={SearchX}
              tone="error"
              title={m.picker_load_failed()}
              action={retryAction}
            />
          {/snippet}
          {#snippet retryAction()}
            <Button variant="outline" size="sm" onclick={() => runLoad(q)}>
              <RotateCcw size={iconSizes.sm} aria-hidden="true" />
              {m.picker_retry()}
            </Button>
          {/snippet}
          {#snippet emptyAction()}
            <Button variant="outline" size="sm" onclick={openCreateTab}>
              <Plus size={iconSizes.sm} aria-hidden="true" />
              {create?.label ?? m.picker_add_new()}
            </Button>
          {/snippet}
          {#snippet pickerEmpty()}
            <EmptyState
              compact
              icon={SearchX}
              title={emptyLabel ?? m.picker_empty()}
              action={hasCreate ? emptyAction : undefined}
            />
          {/snippet}
          {#snippet pickerRowActions(row: T)}
            {@const action = rowAction(row)}
            {@const rowDisabled = disabled(row)}
            {@const picked = effectivePickedIds.has(getRowId(row))}
            {@const disabledReason =
              action === 'blocked' ? m.picker_already_added() : rowDisabledReason?.(row)}
            <Button
              variant={picked ? 'secondary' : 'ghost'}
              size="xs"
              shape="icon"
              class={`picker-add-row ${action === 'remove' ? 'removable' : ''}`}
              aria-label={action === 'remove'
                ? m.picker_remove_row()
                : rowDisabled && disabledReason
                  ? disabledReason
                  : m.picker_pick_row()}
              disabled={rowDisabled}
              onclick={() => toggle(row)}
            >
              {#if action === 'remove'}
                <!-- Owner ask 2026-09-18: a picked row offers ONE verb,
                     remove — quantities are edited in the form's own
                     lines, never by re-picking. -->
                <Trash2 size={iconSizes.sm} aria-hidden="true" />
              {:else if picked && duplicatePolicy === 'prevent'}
                <Check size={iconSizes.sm} aria-hidden="true" />
              {:else}
                <Plus size={iconSizes.sm} aria-hidden="true" />
              {/if}
            </Button>
          {/snippet}
          <DataTable
            data={view}
            columns={dataColumns}
            cells={cellSnippets}
            {getRowId}
            chrome={false}
            {loading}
            error={loadFailed || undefined}
            onRetry={() => runLoad(q)}
            errorContent={pickerError}
            empty={pickerEmpty}
            emptyMessage={emptyLabel ?? m.picker_empty()}
            rowActions={pickerRowActions}
            rowClass={pickerRowClass}
            class="picker-grid"
          />
        </div>

        <footer class="picker-footer">
          <p class="picker-hint t-caption">
            {canUnpick ? m.picker_dblclick_hint_toggle() : m.picker_dblclick_hint()}
          </p>
        </footer>
      </div>
    {/if}
  </div>
</DraggableWindow>

<style>
  .picker-shell,
  .picker-browse {
    display: flex;
    min-height: 0;
    height: 100%;
    flex-direction: column;
  }
  .picker-subtitle {
    flex: none;
    padding: var(--space-2) var(--space-3);
    color: var(--color-text-secondary);
    background: var(--color-surface-1);
    border-bottom: 1px solid var(--color-border-subtle);
  }
  .picker-window-title {
    min-width: 0;
    overflow: hidden;
    font-size: var(--font-size-section-title);
    font-weight: var(--font-weight-semibold);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .picker-title-tabs {
    display: flex;
    min-width: 0;
    height: 100%;
    align-items: center;
    gap: var(--space-1);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .picker-title-tabs::-webkit-scrollbar {
    display: none;
  }
  .picker-title-tab {
    display: inline-flex;
    min-width: 0;
    height: var(--control-height-md);
    flex: none;
    align-items: center;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
  }
  .picker-title-tab.active {
    color: var(--color-accent);
    border-color: color-mix(in srgb, var(--color-accent) 28%, transparent);
    background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  }
  .picker-title-tab:hover:not(.active) {
    color: var(--color-text-primary);
    background: var(--color-surface-2);
  }
  .picker-title-tab-trigger,
  .picker-title-tab-close {
    display: inline-flex;
    height: 100%;
    align-items: center;
    justify-content: center;
    border: 0;
    color: inherit;
    background: transparent;
  }
  .picker-title-tab-trigger {
    min-width: 0;
    gap: var(--space-1);
    padding: 0 var(--space-2);
    font-size: var(--font-size-label);
    font-weight: var(--font-weight-medium);
    white-space: nowrap;
  }
  .picker-title-tab-close {
    width: var(--control-height-xs);
    flex: none;
    padding: 0;
    border-radius: var(--radius-sm);
  }
  .picker-title-tab-close:hover {
    color: var(--color-text-primary);
    background: var(--color-surface-3);
  }
  .picker-toolbar {
    position: relative;
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-1);
    border-bottom: 1px solid var(--color-border-subtle);
  }
  /* Search is sized, not greedy (same idiom as DataTable's toolbar): a wide
     window should grow the RESULTS, not the query field. It shrinks down to
     the min before the toolbar wraps at compact widths. */
  .picker-search-wrap {
    min-width: calc(var(--space-12) * 3);
    flex: 0 1 calc(var(--space-12) * 7);
  }
  .picker-search-wrap :global(.picker-search-field) {
    width: 100%;
  }
  .picker-results {
    flex: none;
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
  }
  /* Actions hold the right edge; the slack between count and actions is the
     toolbar's breathing room. */
  .picker-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-1);
    margin-left: auto;
  }
  .picker-column-control {
    position: relative;
  }
  .picker-column-panel {
    position: absolute;
    top: calc(100% + var(--space-1));
    right: 0;
    min-width: calc(var(--space-12) * 5);
    padding: var(--space-2);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-lg);
    color: var(--color-text-primary);
    background: var(--color-overlay);
    box-shadow: var(--shadow-overlay);
    z-index: var(--layer-popover);
  }
  .picker-column-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--color-border-subtle);
  }
  .picker-column-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-2);
  }
  .picker-table-wrap {
    display: flex;
    min-height: 0;
    flex: 1;
    background: var(--color-surface-1);
  }
  /* Rows are DataTable's; these reach into it on purpose (a picked row must
     read as picked, and its one verb must stay visible without hovering). */
  .picker-table-wrap :global(.picker-row-picked) {
    background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface-1));
  }
  .picker-table-wrap :global(.picker-row-picked .picker-cell-primary) {
    color: var(--color-accent);
  }
  .picker-table-wrap :global(.picker-cell-primary) {
    color: var(--color-text-primary);
    font-weight: var(--font-weight-medium);
  }
  .picker-table-wrap :global(.picker-row-disabled) {
    cursor: not-allowed;
  }
  .picker-table-wrap :global(.picker-row-disabled .dt-cell) {
    color: var(--color-text-disabled);
  }
  /* `tr` earns the specificity to beat DataTable's own hover-reveal rule: a
     picked row must keep showing its one verb without hovering. */
  .picker-table-wrap :global(tr.picker-row-picked .dt-row-actions) {
    opacity: 1;
  }
  .picker-table-wrap :global(.picker-add-row.removable) {
    color: var(--color-danger-fg);
  }

  .picker-footer {
    display: flex;
    min-height: var(--control-height-touch);
    flex: none;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    color: var(--color-text-tertiary);
    background: var(--color-surface-1);
    border-top: 1px solid var(--color-border-subtle);
  }
  .picker-hint {
    min-width: 0;
  }
  .picker-create {
    min-height: 0;
    flex: 1;
    overflow: auto;
    padding: var(--space-4);
    background: var(--color-surface-1);
  }
  .picker-create-copy {
    margin-bottom: var(--space-4);
    color: var(--color-text-secondary);
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
  @media (max-width: 47.99875rem) {
    .picker-toolbar {
      flex-wrap: wrap;
    }
    .picker-search-wrap {
      flex-basis: 100%;
    }
    .picker-results {
      flex: 1;
    }
    .picker-subtitle {
      display: none;
    }
  }
</style>
