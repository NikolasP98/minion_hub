<script lang="ts">
  import type { PageData } from './$types';
  import { browser } from '$app/environment';
  import { invalidate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { checkedRefresh } from '$lib/services/actions/refresh';
  import * as m from '$lib/paraglide/messages';
  import { LayoutGrid, List, Columns3 } from 'lucide-svelte';
  import {
    PageHeader,
    Badge,
    Button,
    Toggle,
    SegmentedControl,
    EmptyState,
    iconSizes,
  } from '$lib/components/ui';
  import { groupBy, type GroupAxis } from '$lib/catalog/grouping';
  import { PageShell } from '$lib/components/ui/foundations';
  import DataTable from '$lib/components/data-table/DataTable.svelte';
  import type { DataColumn, EditDraft } from '$lib/components/data-table/DataTable.svelte';
  import { canAct } from '$lib/access/can.svelte';
  import { toastError } from '$lib/state/ui/toast.svelte';
  import { formatMoney } from '$lib/utils/format';
  import RecipeEditor from '$lib/components/pos/RecipeEditor.svelte';
  import InlineTagsCell from '$lib/components/tags/InlineTagsCell.svelte';
  import type { CalTag } from '$lib/components/scheduling/calendar/types';
  import PackageEditor from '$lib/components/pos/PackageEditor.svelte';
  import InlineCategoryCell, {
    type ProductCategoryOption,
  } from '$lib/components/pos/InlineCategoryCell.svelte';

  import {
    createRowSaveController,
    runDraftCommand,
    saveRowPatch,
    type RowSaveResult,
  } from '$lib/components/data-table/row-save';
  import { onDestroy, untrack } from 'svelte';
  import { tryUseActions } from '$lib/services/actions/context';
  import type { CommandContext } from '$lib/services/actions/definition';

  let { data }: { data: PageData } = $props();
  type Row = PageData['sellables'][number];
  // svelte-ignore state_referenced_locally -- synchronized from page data below
  let sellables = $state<Row[]>(data.sellables);
  // svelte-ignore state_referenced_locally -- synchronized from page data below
  let catalogTags = $state<CalTag[]>(data.catalogTags);
  // svelte-ignore state_referenced_locally -- synchronized from page data below
  let categories = $state<ProductCategoryOption[]>(data.categories);
  $effect(() => {
    sellables = data.sellables;
    catalogTags = data.catalogTags;
    categories = data.categories;
  });
  const stockEnabled = $derived(data.stockEnabled);
  const coverage = $derived(data.coverage);
  const catalogTagIds = $derived(new Set(catalogTags.map((tag) => tag.id)));
  const tagOptions = $derived.by(() => {
    const options = new Map(catalogTags.map((tag) => [tag.id, tag]));
    for (const row of sellables) for (const tag of row.inheritedTags) options.set(tag.id, tag);
    return [...options.values()];
  });

  function directManualTags(row: Row): CalTag[] {
    return row.tags.filter((tag) => catalogTagIds.has(tag.id));
  }
  function directReadonlyTags(row: Row): CalTag[] {
    return row.tags.filter((tag) => !catalogTagIds.has(tag.id));
  }
  function updateRowTags(productId: string, manual: CalTag[]) {
    sellables = sellables.map((row) =>
      row.productId === productId ? { ...row, tags: [...directReadonlyTags(row), ...manual] } : row,
    );
  }
  async function refreshCatalog() {
    await checkedRefresh(
      () => invalidate('pos:catalog'),
      () => page,
    );
  }
  function updateTagRegistry(next: CalTag[]) {
    const nextById = new Map(next.map((tag) => [tag.id, tag]));
    const previousManualIds = new Set(catalogTags.map((tag) => tag.id));
    catalogTags = next;
    sellables = sellables.map((row) => ({
      ...row,
      tags: row.tags
        .filter((tag) => !previousManualIds.has(tag.id) || nextById.has(tag.id))
        .map((tag) => nextById.get(tag.id) ?? tag),
    }));
    void refreshCatalog().catch(() => toastError(m.data_table_save_failed()));
  }
  function updateCategoryRegistry(
    next: ProductCategoryOption[],
    change?: { from: string; to: string | null },
  ) {
    categories = next;
    if (change)
      sellables = sellables.map((row) =>
        row.category === change.from ? { ...row, category: change.to } : row,
      );
    void refreshCatalog().catch(() => toastError(m.data_table_save_failed()));
  }

  async function saveCategory(row: Row, category: string | null): Promise<boolean> {
    const execute = async (context?: CommandContext) => {
      const outcome = await saveRowPatch(
        `/api/pos/sellables/${row.productId}`,
        { category },
        refreshCatalog,
        context,
      );
      if (outcome.status === 'succeeded' || outcome.status === 'committed-refreshing')
        sellables = sellables.map((item) =>
          item.productId === row.productId ? { ...item, category } : item,
        );
      return { ...outcome, value: undefined };
    };
    const outcome = await runDraftCommand(actionRuntime, 'catalog.category', execute, () => {});
    return outcome.status === 'succeeded' || outcome.status === 'committed-refreshing';
  }

  // ── Show inactive ────────────────────────────────────────────────────────
  // Page-load param (not client-only state): the toggle re-navigates so the
  // server re-queries listSellables with includeInactive, same as every other
  // filter in this app.
  function toggleShowInactive(checked: boolean) {
    const url = new URL(page.url);
    if (checked) url.searchParams.set('inactive', '1');
    else url.searchParams.delete('inactive');
    goto(`${url.pathname}${url.search}`, { replaceState: true, keepFocus: true, noScroll: true });
  }

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

  // Primitive row persistence is price-only. Category and tags own separate
  // column requests so an older full-row draft can never clobber either.
  async function saveRow(
    row: Row,
    draft: EditDraft,
    context?: CommandContext,
  ): Promise<RowSaveResult> {
    return saveRowPatch(
      `/api/pos/sellables/${row.productId}`,
      {
        unitPrice: draft.unitPrice !== '' ? Number(draft.unitPrice) : null,
      },
      undefined,
      context,
    );
  }

  const catalogSaves = createRowSaveController();
  const actionRuntime = tryUseActions();
  $effect(() => {
    const scopeVersion = actionRuntime?.scopeVersion;
    if (scopeVersion !== undefined) untrack(() => catalogSaves.reset(scopeVersion));
  });
  let catalogSaveView = $state(catalogSaves.view());
  const unsubscribeSaves = catalogSaves.subscribe(() => {
    catalogSaveView = catalogSaves.view();
  });
  onDestroy(() => {
    unsubscribeSaves();
    catalogSaves.dispose();
  });
  $effect(() => {
    const rows = sellables.map((row) => ({ id: row.productId, active: String(row.active) }));
    untrack(() => {
      for (const row of rows) catalogSaves.reconcile(row.id, { active: row.active });
    });
  });
  async function toggleActive(row: Row, checked: boolean) {
    const retainUnsent = catalogSaves.prepareAdmissionFailure(row.productId, {
      active: String(checked),
    });
    const execute = async (context?: CommandContext) => {
      const outcome = await catalogSaves.save(
        row.productId,
        row,
        {},
        { active: String(checked) },
        (_row, draft, ctx) =>
          saveRowPatch(
            `/api/pos/sellables/${row.productId}`,
            { active: draft.active === 'true' },
            () =>
              checkedRefresh(
                () => invalidate('pos:catalog'),
                () => page,
              ),
            ctx,
          ),
        context,
      );
      return { ...outcome, value: undefined };
    };
    const outcome = await runDraftCommand(actionRuntime, 'catalog.active', execute, retainUnsent);
    if (outcome.status === 'failed' || outcome.status === 'conflict')
      toastError(m.data_table_save_failed());
  }

  const columns = $derived<DataColumn<Row>[]>([
    { key: 'name', label: m.stock_col_name(), custom: true, accessor: (s) => s.name },
    {
      key: 'category',
      label: m.fin_col_category(),
      accessor: (s) => s.category ?? '',
      custom: true,
      customEditable: true,
      filter: {
        options: () =>
          categories.map((category) => ({ value: category.name, label: category.name })),
        match: (row) => row.category,
      },
    },
    {
      key: 'unitPrice',
      money: true,
      label: m.pos_sell_price(),
      align: 'right',
      editable: true,
      type: 'number',
      custom: true,
      accessor: (s) => s.unitPrice,
      exportValue: (s) => s.unitPrice ?? '',
    },
    { key: 'kind', label: m.pos_catalog_col_kind(), custom: true, accessor: (s) => s.kind },
    {
      key: 'tags',
      label: m.pos_catalog_col_tags(),
      custom: true,
      customEditable: true,
      sortable: false,
      accessor: (s) => [...s.tags, ...s.inheritedTags].map((t) => t.name).join(', '),
      filter: {
        options: () => tagOptions.map((t) => ({ value: t.id, label: t.name })),
        match: (s) => [...s.tags, ...s.inheritedTags].map((t) => t.id),
      },
    },
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
    {
      key: 'billed',
      label: m.fin_col_billed(),
      align: 'right',
      accessor: (s) => s.billed,
    },
    {
      key: 'revenue',
      money: true,
      label: m.fin_col_revenue(),
      align: 'right',
      custom: true,
      accessor: (s) => s.revenue,
      exportValue: (s) => s.revenue ?? '',
    },
    {
      key: 'cost',
      money: true,
      label: m.fin_col_cost(),
      align: 'right',
      custom: true,
      accessor: (s) => s.cost,
      exportValue: (s) => s.cost ?? '',
    },
    {
      key: 'margin',
      money: true,
      label: m.fin_col_margin(),
      align: 'right',
      custom: true,
      accessor: (s) => s.margin,
      exportValue: (s) => s.margin ?? '',
    },
  ]);

  function openCreate() {
    void goto('/pos/catalog/new');
  }
  // Deep link: /pos/catalog?new=1 → the editor page (same convention as the
  // other list pages' ?new=1).
  $effect(() => {
    if (page.url.searchParams.get('new') === '1') openCreate();
  });
  function openEdit(row: Row) {
    void goto(`/pos/catalog/${encodeURIComponent(row.productId)}/edit`);
  }

  // ★ The central write-capability hook (rbac.service.ts apiWriteCapability)
  // maps every /api/pos/* POST/PATCH to the SAME `pos:edit` capability — there
  // is no separate server-side `pos:create`. Gating "add" on `pos:create`
  // would enable a button whose POST then 403s for a create-but-not-edit
  // role, so both gates use `pos:edit` (defaultCaps grant staff both anyway).
  const canWrite = $derived(canAct('pos', 'edit'));
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
        <Toggle
          size="sm"
          label={m.pos_catalog_show_inactive()}
          checked={data.includeInactive}
          onchange={toggleShowInactive}
        />
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

  {#if coverage.billedNotInCatalog > 0 || coverage.catalogNeverBilled > 0}
    <div class="coverage-banner">
      {#if coverage.billedNotInCatalog > 0}
        <span>{m.fin_products_coverage({ n: coverage.billedNotInCatalog })}</span>
      {/if}
      {#if coverage.catalogNeverBilled > 0}
        <span>{m.fin_products_catalog_never_billed({ n: coverage.catalogNeverBilled })}</span>
      {/if}
    </div>
  {/if}

  {#if sellables.length === 0}
    <EmptyState
      icon={LayoutGrid}
      title={m.pos_catalog_empty()}
      description={m.pos_catalog_empty_hint()}
    >
      {#snippet action()}
        <Button
          variant="primary"
          size="sm"
          onclick={openCreate}
          disabled={!canWrite}
          title={canWrite ? undefined : m.no_permission()}
        >
          {m.pos_catalog_new()}
        </Button>
      {/snippet}
    </EmptyState>
  {:else if view === 'board'}
    <!-- Board: one column per group on the chosen axis, empty groups omitted.
         Cards open the dedicated editor page, so the board remains a real
         editing surface rather than a read-only visualization. -->
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
                disabled={!canWrite}
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
      tableId="pos.catalog"
      idColumn={{ value: (s) => s.code }}
      titleColumn={{
        key: 'name',
        href: (s) => `/pos/catalog/${encodeURIComponent(s.productId)}/edit`,
      }}
      searchPlaceholder={m.data_table_search()}
      exportable
      exportName="pos-catalog"
      selectable
      storageKey="pos-catalog"
      canEdit={canWrite}
      onSaveRow={saveRow}
      onSaveComplete={() =>
        checkedRefresh(
          () => invalidate('pos:catalog'),
          () => page,
        )}
      rowSaveController={catalogSaves}
      {expandedContent}
      addLabel={m.pos_catalog_new()}
      onAdd={openCreate}
      addDisabled={!canWrite}
      emptyMessage={m.pos_catalog_empty()}
    >
      {#snippet cell(s: Row, col: DataColumn<Row>, context)}
        {#if col.key === 'name'}
          <span class="truncate block max-w-[16rem]">{s.name}</span>
        {:else if col.key === 'category'}
          <InlineCategoryCell
            value={s.category}
            {categories}
            canEdit={context.canEdit}
            onsave={(category) => saveCategory(s, category)}
            onregistrychange={updateCategoryRegistry}
          />
        {:else if col.key === 'unitPrice'}
          <span class="tabular-nums">{s.unitPrice != null ? formatMoney(s.unitPrice) : '—'}</span>
        {:else if col.key === 'kind'}
          <Badge variant="semantic" value={kindTone(s.kind)}>{kindLabel(s.kind)}</Badge>
        {:else if col.key === 'tags'}
          <InlineTagsCell
            scope="catalog"
            kind="product"
            entityId={s.productId}
            registry={catalogTags}
            selected={directManualTags(s)}
            readonly={directReadonlyTags(s)}
            inherited={s.inheritedTags}
            canEdit={context.canEdit}
            onregistrychange={updateTagRegistry}
            onsaved={(tags) => updateRowTags(s.productId, tags)}
            onrefresh={refreshCatalog}
          />
        {:else if col.key === 'stockQty'}
          <span class="tabular-nums">{s.stockQty != null ? s.stockQty : '—'}</span>
        {:else if col.key === 'hasMapping'}
          <span class="mapping-dot" class:on={s.hasMapping} title={m.pos_catalog_consumption()}
          ></span>
        {:else if col.key === 'revenue'}
          {#if s.costMasked}
            <span class="muted">•••</span>
          {:else}
            <span class="tabular-nums font-medium">{formatMoney(s.revenue ?? 0)}</span>
          {/if}
        {:else if col.key === 'cost'}
          {#if s.costMasked}
            <span class="muted">•••</span>
          {:else if s.cost == null}
            <span class="muted">—</span>
          {:else}
            <span class="tabular-nums" title={s.partial ? m.fin_cost_partial_hint() : undefined}>
              {formatMoney(s.cost)}{#if s.partial}<span class="partial-mark">*</span>{/if}
            </span>
          {/if}
        {:else if col.key === 'margin'}
          {#if s.costMasked}
            <span class="muted">•••</span>
          {:else if s.margin == null}
            <span class="muted">—</span>
          {:else}
            <span
              class="tabular-nums font-medium"
              class:margin-pos={s.margin >= 0}
              class:margin-neg={s.margin < 0}
            >
              {formatMoney(s.margin)}{#if s.marginPct != null}<span class="t-caption pct"
                  >{s.marginPct}%</span
                >{/if}
            </span>
          {/if}
        {:else if col.key === 'active'}
          <Toggle
            checked={catalogSaveView.values.get(s.productId)?.active !== undefined
              ? catalogSaveView.values.get(s.productId)?.active === 'true'
              : s.active}
            pending={catalogSaveView.pending.has(catalogSaves.key(s.productId, 'active'))}
            size="sm"
            ariaLabel={m.fin_col_active()}
            disabled={!canWrite || catalogSaveView.blocked.has(s.productId)}
            onchange={(checked) => toggleActive(s, checked)}
          />
          {#if catalogSaveView.failed.has(catalogSaves.key(s.productId, 'active')) && !catalogSaveView.blocked.has(s.productId)}
            <Button
              variant="ghost"
              size="sm"
              onclick={() =>
                toggleActive(s, catalogSaveView.values.get(s.productId)?.active === 'true')}
              >{m.asyncAction_retry()}</Button
            >
          {/if}
        {/if}
      {/snippet}
    </DataTable>
  {/if}
</PageShell>

<!-- Recipe builder (#8): composition is edited per sellable, in POS. Only
     sellables backed by a stk_item can have one — a pure fin_product has no
     node in the graph to hang components off. -->
{#snippet expandedContent(s: Row)}
  <!-- Package composition (spec §4.3): a sellable with component edges IS a
       package — one grant per child service is minted when it is rung up. -->
  <PackageEditor
    productId={s.productId}
    {sellables}
    canEdit={canWrite}
    onChanged={() => invalidate('pos:catalog')}
  />
  {#if stockEnabled && s.itemId}
    <RecipeEditor
      itemId={s.itemId}
      items={data.stockItems}
      edges={data.componentEdges}
      canEdit={canWrite}
      onChanged={() => invalidate('pos:catalog')}
    />
  {:else}
    <p class="t-caption no-recipe">{m.pos_recipe_needs_item()}</p>
  {/if}
{/snippet}

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
    /* Never let cards compress when a column overflows — they'd stack on top
       of each other instead of scrolling (`min-height: 0` here caused that). */
    flex-shrink: 0;
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
  .muted {
    color: var(--color-text-tertiary);
  }
  .margin-pos {
    color: var(--color-success-fg);
  }
  .margin-neg {
    color: var(--color-danger-fg);
  }
  .partial-mark {
    color: var(--color-warning-fg);
    margin-left: var(--space-0-5);
  }
  .pct {
    margin-left: var(--space-1);
  }
  .coverage-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    background: color-mix(in oklab, var(--color-accent) 10%, transparent);
    border-bottom: 1px solid var(--hairline);
    color: var(--color-text-secondary);
  }
</style>
