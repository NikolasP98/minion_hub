<script lang="ts">
  import type { PageData } from './$types';
  import { browser } from '$app/environment';
  import { invalidate } from '$app/navigation';
  import * as m from '$lib/paraglide/messages';
  import { LayoutGrid, List, Columns3 } from 'lucide-svelte';
  import {
    PageHeader,
    Badge,
    Button,
    Toggle,
    SegmentedControl,
    iconSizes,
  } from '$lib/components/ui';
  import { groupBy, type GroupAxis } from '$lib/catalog/grouping';
  import { PageShell } from '$lib/components/ui/foundations';
  import DataTable from '$lib/components/data-table/DataTable.svelte';
  import type { DataColumn, EditDraft } from '$lib/components/data-table/DataTable.svelte';
  import { canAct } from '$lib/access/can.svelte';
  import { toastError } from '$lib/state/ui/toast.svelte';
  import { formatMoney } from '$lib/utils/format';
  import SellableWizard, { type SellableLike } from '$lib/components/pos/SellableWizard.svelte';
  import RecipeEditor from '$lib/components/pos/RecipeEditor.svelte';

  let { data }: { data: PageData } = $props();
  const sellables = $derived(data.sellables);
  const stockEnabled = $derived(data.stockEnabled);
  type Row = (typeof sellables)[number];

  const categories = $derived(
    Array.from(new Set(sellables.map((s) => s.category).filter((c): c is string => !!c))).sort(),
  );
  /** Feeds the wizard's code suggester so it never proposes a taken code. */
  const takenCodes = $derived(sellables.map((s) => s.code));

  // ── Table | Board ──────────────────────────────────────────────────────────
  const VIEW_KEY = 'pos-catalog-view';
  const BOARD_AXIS_KEY = 'pos-catalog-board-axis';
  const BOARD_AXES: GroupAxis[] = ['category', 'zone', 'line'];

  function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
    if (!browser) return fallback;
    const raw = localStorage.getItem(key);
    return allowed.includes(raw as T) ? (raw as T) : fallback;
  }

  // svelte-ignore state_referenced_locally -- seed once from localStorage
  let view = $state<'table' | 'board'>(stored(VIEW_KEY, ['table', 'board'] as const, 'table'));
  /**
   * Defaults to `category` (10 coarse buckets), not zone or line. Those axes have
   * 17 and 20 possible values against ~80 products, so opening straight onto them
   * would greet you with a long horizontal scroll of mostly-thin columns. Coarse
   * first, drill down by choosing the axis.
   */
  // svelte-ignore state_referenced_locally -- seed once from localStorage
  let boardAxis = $state<GroupAxis>(stored(BOARD_AXIS_KEY, BOARD_AXES, 'category'));
  $effect(() => {
    if (browser) localStorage.setItem(VIEW_KEY, view);
  });
  $effect(() => {
    if (browser) localStorage.setItem(BOARD_AXIS_KEY, boardAxis);
  });

  // One kind → one label+tone, used by BOTH the table cell and the board card so
  // the same kind can never read as two different colours across views.
  function kindLabel(kind: Row['kind']): string {
    if (kind === 'bundle') return m.pos_catalog_kind_bundle();
    return kind === 'product' ? m.pos_catalog_kind_product() : m.pos_catalog_kind_service();
  }
  // 'brand', not a categorical hue: --color-purple/pink/cyan are reserved for
  // charts and data-viz, never for a semantic like "this row is a bundle".
  function kindTone(kind: Row['kind']): 'accent' | 'info' | 'brand' {
    if (kind === 'bundle') return 'brand';
    return kind === 'product' ? 'accent' : 'info';
  }

  const boardColumns = $derived(groupBy(sellables, boardAxis));
  const axisItems = $derived([
    { value: 'category', label: m.catalog_group_category() },
    { value: 'zone', label: m.catalog_group_zone() },
    { value: 'line', label: m.catalog_group_line() },
  ]);

  // Only the two `editable: true` columns (category, unitPrice) — DataTable's
  // draft only ever contains editable-column keys, so this never round-trips
  // derived fields (kind, stockQty, active) back to the PATCH body.
  async function saveRow(row: Row, draft: EditDraft): Promise<boolean> {
    const res = await fetch(`/api/pos/sellables/${row.productId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        category: draft.category || null,
        unitPrice: draft.unitPrice !== '' ? Number(draft.unitPrice) : null,
      }),
    });
    if (res.ok) await invalidate('pos:catalog');
    return res.ok;
  }

  // Forced-remount nonce so the in-cell Toggle always resyncs to server truth
  // after the PATCH settles — on success that's the new value, on failure
  // it's the unchanged one, either way no stale optimistic flip lingers.
  let toggleNonce = $state(0);
  async function toggleActive(row: Row, checked: boolean) {
    const res = await fetch(`/api/pos/sellables/${row.productId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ active: checked }),
    });
    toggleNonce++;
    if (res.ok) await invalidate('pos:catalog');
    else toastError(m.data_table_save_failed());
  }

  const columns = $derived<DataColumn<Row>[]>([
    { key: 'name', label: m.stock_col_name(), custom: true, accessor: (s) => s.name },
    {
      key: 'code',
      label: m.stock_col_code(),
      accessor: (s) => s.code,
      cellClass: 'font-mono text-xs',
    },
    {
      key: 'category',
      label: m.fin_col_category(),
      accessor: (s) => s.category ?? '',
      editable: true,
    },
    {
      key: 'unitPrice',
      money: true,
      label: m.pos_sell_price(),
      align: 'right',
      editable: true,
      editType: 'number',
      custom: true,
      accessor: (s) => s.unitPrice,
      exportValue: (s) => s.unitPrice ?? '',
    },
    { key: 'kind', label: m.pos_catalog_col_kind(), custom: true, accessor: (s) => s.kind },
    ...(stockEnabled
      ? [
          {
            key: 'stockQty',
            label: m.pos_catalog_col_stock(),
            align: 'right' as const,
            custom: true,
            accessor: (s: Row) => s.stockQty ?? '',
          },
        ]
      : []),
    ...(stockEnabled
      ? [
          {
            key: 'hasMapping',
            label: m.pos_catalog_col_mapped(),
            align: 'center' as const,
            custom: true,
            accessor: (s: Row) => s.hasMapping,
          },
        ]
      : []),
    {
      key: 'active',
      label: m.fin_col_active(),
      align: 'center',
      custom: true,
      accessor: (s) => s.active,
      exportValue: (s) => (s.active ? 1 : 0),
    },
  ]);

  // ── Wizard (create + edit) ───────────────────────────────────────────────
  let wizardOpen = $state(false);
  let editingRow = $state<SellableLike | null>(null);

  function openCreate() {
    editingRow = null;
    wizardOpen = true;
  }
  function openEdit(row: Row) {
    editingRow = row;
    wizardOpen = true;
  }

  // ★ The central write-capability hook (rbac.service.ts apiWriteCapability)
  // maps every /api/pos/* POST/PATCH to the SAME `pos:edit` capability — there
  // is no separate server-side `pos:create`. Gating "add" on `pos:create`
  // would enable a button whose POST then 403s for a create-but-not-edit
  // role, so both gates use `pos:edit` (defaultCaps grant staff both anyway).
  //
  // ★★ A sellable is a `fin_products` row (+ optional `stk_items`/`stk_consumption`),
  // so the API now requires the OWNING module's capability on top of pos —
  // see routes/api/pos/sellables/_owning-modules.ts. Mirror that here or the
  // buttons render for roles whose write 403s.
  const canWrite = $derived(canAct('pos', 'edit') && canAct('finance', 'edit'));
  // The wizard always posts `consumption` when stock is on, and RecipeEditor
  // writes /api/stock/items/:id/components directly — both need stock:edit.
  const canWriteStock = $derived(canWrite && canAct('stock', 'edit'));
  const canOpenWizard = $derived(stockEnabled ? canWriteStock : canWrite);
</script>

<svelte:head><title>{m.pos_catalog_title()} — {m.pos_nav_catalog()}</title></svelte:head>

<PageShell archetype="collection" scroll="region" labelledBy="pos-catalog-title">
  <PageHeader
    titleId="pos-catalog-title"
    title={m.pos_catalog_title()}
    subtitle={m.pos_catalog_subtitle()}
  >
    {#snippet leading()}<LayoutGrid size={iconSizes.md} class="text-accent shrink-0" />{/snippet}
    {#snippet actions()}
      <div class="view-bar">
        {#if view === 'board'}
          <SegmentedControl
            aria-label={m.catalog_group_by()}
            value={boardAxis}
            items={axisItems}
            onValueChange={(v) => (boardAxis = v as GroupAxis)}
          />
        {/if}
        <div class="view-toggle" role="group" aria-label={m.catalog_view_kanban()}>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            class={`vt-btn ${view === 'table' ? 'on' : ''}`}
            aria-pressed={view === 'table'}
            title={m.pos_sell_view_table()}
            aria-label={m.pos_sell_view_table()}
            onclick={() => (view = 'table')}
          >
            <List size={iconSizes.sm} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            class={`vt-btn ${view === 'board' ? 'on' : ''}`}
            aria-pressed={view === 'board'}
            title={m.catalog_view_kanban()}
            aria-label={m.catalog_view_kanban()}
            onclick={() => (view = 'board')}
          >
            <Columns3 size={iconSizes.sm} />
          </Button>
        </div>
      </div>
    {/snippet}
  </PageHeader>

  {#if view === 'board'}
    <!-- Board: one column per group on the chosen axis, empty groups omitted.
         Cards open the same wizard the table's name cell does, so the board is a
         real editing surface rather than a read-only visualization. -->
    <div class="board">
      {#each boardColumns as col (col.key)}
        <section class="bcol" aria-label={col.label}>
          <header class="bhead">
            <span class="btitle">{col.label}</span>
            <span class="bcount">{col.rows.length}</span>
          </header>
          <div class="bcards">
            {#each col.rows as s (s.productId)}
              <Button
                variant="ghost"
                size="sm"
                type="button"
                class="bcard"
                disabled={!canOpenWizard}
                onclick={() => openEdit(s)}
              >
                <span class="bname">{s.name}</span>
                <span class="bmeta">
                  <span class="bcode">{s.code}</span>
                  <span class="bprice">{s.unitPrice != null ? formatMoney(s.unitPrice) : '—'}</span>
                </span>
                <span class="bbadges">
                  <Badge variant="semantic" value={kindTone(s.kind)} size="sm"
                    >{kindLabel(s.kind)}</Badge
                  >
                  {#if !s.active}
                    <Badge variant="semantic" value="warning" size="sm">{m.fin_col_active()}</Badge>
                  {/if}
                </span>
              </Button>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {:else}
    <DataTable
      class="flex-1 min-h-0"
      {columns}
      data={sellables}
      getRowId={(s) => s.productId}
      searchPlaceholder={m.data_table_search()}
      exportable
      exportName="pos-catalog"
      selectable
      storageKey="pos-catalog"
      canEdit={canWrite}
      onSaveRow={saveRow}
      {expandedContent}
      addLabel={m.pos_catalog_new()}
      onAdd={openCreate}
      addDisabled={!canOpenWizard}
      emptyMessage={m.pos_catalog_empty()}
    >
      {#snippet cell(s: Row, col: DataColumn<Row>)}
        {#if col.key === 'name'}
          {#if canOpenWizard}
            <Button variant="ghost" size="sm" class="name-link" onclick={() => openEdit(s)}
              >{s.name}</Button
            >
          {:else}
            <span class="truncate block max-w-[16rem]">{s.name}</span>
          {/if}
        {:else if col.key === 'unitPrice'}
          <span class="tabular-nums">{s.unitPrice != null ? formatMoney(s.unitPrice) : '—'}</span>
        {:else if col.key === 'kind'}
          <Badge variant="semantic" value={kindTone(s.kind)}>{kindLabel(s.kind)}</Badge>
        {:else if col.key === 'stockQty'}
          <span class="tabular-nums"
            >{s.kind === 'product' && s.stockQty != null ? s.stockQty : '—'}</span
          >
        {:else if col.key === 'hasMapping'}
          <span class="mapping-dot" class:on={s.hasMapping} title={m.pos_catalog_consumption()}
          ></span>
        {:else if col.key === 'active'}
          {#key `${s.productId}-${toggleNonce}`}
            <Toggle
              checked={s.active}
              size="sm"
              ariaLabel={m.fin_col_active()}
              disabled={!canWrite}
              onchange={(checked) => toggleActive(s, checked)}
            />
          {/key}
        {/if}
      {/snippet}
    </DataTable>
  {/if}
</PageShell>

<!-- Recipe builder (#8): composition is edited per sellable, in POS. Only
     sellables backed by a stk_item can have one — a pure fin_product has no
     node in the graph to hang components off. -->
{#snippet expandedContent(s: Row)}
  {#if stockEnabled && s.itemId}
    <RecipeEditor
      itemId={s.itemId}
      items={data.stockItems}
      edges={data.componentEdges}
      canEdit={canWriteStock}
      onChanged={() => invalidate('pos:catalog')}
    />
  {:else}
    <p class="t-caption no-recipe">{m.pos_recipe_needs_item()}</p>
  {/if}
{/snippet}

<SellableWizard
  bind:open={wizardOpen}
  {stockEnabled}
  stockItems={data.stockItems}
  {categories}
  {takenCodes}
  consumption={data.consumption}
  editing={editingRow}
  onSaved={() => invalidate('pos:catalog')}
/>

<style>
  .view-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  /* Same bordered-pill idiom as the /pos/sell view toggle. */
  .view-toggle {
    display: flex;
    gap: var(--space-1);
    flex-shrink: 0;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    padding: var(--space-0-5);
    background: var(--color-surface-2);
  }
  :global(.view-toggle .vt-btn) {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.7rem;
    height: 1.5rem;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
  }
  /* Active = accent-TINTED pill + accent text, never a full accent fill. */
  :global(.view-toggle .vt-btn.on) {
    background: color-mix(in oklab, var(--color-accent) 14%, transparent);
    color: var(--color-accent);
  }

  /* ── Board ── the page body owns vertical scroll; the board owns horizontal.
     Columns are fixed-width so a long product name wraps inside its card
     instead of widening the track. */
  .board {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: var(--space-3);
    overflow-x: auto;
    overflow-y: hidden;
    padding: var(--space-2) var(--space-1) var(--space-4);
  }
  .bcol {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 0 0 15rem;
    width: 15rem;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
  }
  .bhead {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--hairline);
    /* Sticky needs an OPAQUE surface or the cards scroll through it. */
    position: sticky;
    top: 0;
    background: var(--color-surface-2);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }
  .btitle {
    font-size: var(--font-size-label);
    font-weight: 600;
    color: var(--color-text-primary);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .bcount {
    font-size: var(--font-size-caption);
    color: var(--color-text-tertiary);
    flex-shrink: 0;
  }
  .bcards {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
    overflow-y: auto;
    min-height: 0;
  }
  /* ★ Button renders children inside an inner fixed-height inline-flex row
     <span>, so `flex-col`/`h-auto` on the Button itself never reach it. The
     card shape has to be forced through a scoped ancestor + `> span`. */
  :global(.bcards .bcard) {
    height: auto;
    min-height: 0;
    padding: var(--space-2);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    text-align: left;
  }
  :global(.bcards .bcard > span) {
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    height: auto;
    gap: var(--space-1);
  }
  :global(.bcards .bcard:hover) {
    border-color: var(--color-accent);
  }
  .bname {
    font-size: var(--font-size-label);
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
    white-space: normal;
  }
  .bmeta {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .bcode {
    font-family: var(--font-mono);
    font-size: var(--font-size-caption);
    color: var(--color-text-tertiary);
  }
  .bprice {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .bbadges {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  :global(.name-link) {
    justify-content: flex-start;
    color: var(--color-foreground);
    text-decoration: none;
  }
  :global(.name-link:hover) {
    text-decoration: underline;
    color: var(--color-accent);
  }
  .mapping-dot {
    display: inline-block;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: var(--radius-full);
    background: var(--color-border, var(--hairline));
  }
  .no-recipe {
    padding: var(--space-2) var(--space-4);
    color: var(--color-text-tertiary);
  }
  .mapping-dot.on {
    background: var(--color-success, var(--color-emerald));
  }
</style>
