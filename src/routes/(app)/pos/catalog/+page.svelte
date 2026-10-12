<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { checkedRefresh } from '$lib/services/actions/refresh';
  import * as m from '$lib/paraglide/messages';
  import { LayoutGrid } from 'lucide-svelte';
  import { PageHeader, Badge, Button, Toggle, EmptyState, iconSizes } from '$lib/components/ui';
  import { catalogGroupSpec, type GroupAxis } from '$lib/catalog/taxonomy';
  import { groupRows } from '$lib/components/data-table/group-by';
  import { PageShell } from '$lib/components/ui/foundations';
  import DataTable from '$lib/components/data-table/DataTable.svelte';
  import GroupByPicker from '$lib/components/data-table/GroupByPicker.svelte';
  import DataView from '$lib/components/data-view/DataView.svelte';
  import BoardView from '$lib/components/data-view/BoardView.svelte';
  import { createViewPref } from '$lib/components/data-view/view-pref.svelte';
  import type {
    DataColumn,
    EditDraft,
    FilterGroup,
    FilterValue,
  } from '$lib/components/data-table/DataTable.svelte';
  import { applyFilters } from '$lib/components/data-table/apply-filters';
  import { canAct } from '$lib/access/can.svelte';
  import { toastError } from '$lib/state/ui/toast.svelte';
  import { formatMoney } from '$lib/utils/format';
  import CompositionEditor from '$lib/components/pos/CompositionEditor.svelte';
  import InlineTagsCell from '$lib/components/tags/InlineTagsCell.svelte';
  import type { CalTag } from '$lib/components/scheduling/calendar/types';
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

  // ── Table filters (spec 2026-09-29: "Show inactive" toggle → an Active
  // filter). Default = only active rows, same starting view the toggle gave. ──
  let tableFilters = $state<Record<string, FilterValue>>({
    active: { kind: 'boolean', op: 'checked' },
  });
  let tableAdvanced = $state<FilterGroup | null>(null);
  let tableSearch = $state('');
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

  // ── Table | Board ──────────────────────────────────────────────────────────
  const viewPref = createViewPref('pos-catalog-view', ['table', 'board'] as const, 'table');
  /**
   * Defaults to `category` (10 coarse buckets), not zone or line. Those axes have
   * 17 and 20 possible values against ~80 products, so opening straight onto them
   * would greet you with a long horizontal scroll of mostly-thin columns. Coarse
   * first, drill down by choosing the axis.
   */
  const boardAxis = createViewPref(
    'pos-catalog-board-axis',
    ['category', 'zone', 'line'] as const,
    'category',
  );
  // The TABLE groups along the same taxonomy axes through DataTable's `groupBy`,
  // but defaults to FLAT: this is the price/margin editing grid, and opening it
  // behind ten collapsible headers would cost a click before every edit.
  const tableAxis = createViewPref<GroupAxis>(
    'pos-catalog-table-axis',
    ['none', 'category', 'zone', 'line'],
    'none',
  );

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

  // The table filters ITSELF (bind:filters/bind:advanced below) — the board is
  // a second, independent view of the same rows, so it has to re-apply the
  // same filters by hand or the default "Active" chip would only ever hide
  // rows in the table half of this page.
  function catalogMatchOf(key: string): ((row: unknown) => unknown) | null {
    const col = columns.find((c) => c.key === key);
    if (!col?.filter) return null;
    const fn =
      col.filter.match ?? col.accessor ?? ((row: Row) => (row as Record<string, unknown>)[key]);
    return (row: unknown) => fn(row as Row);
  }
  // Mirrors DataTable's own default search (`rowText`/`acc`): join every
  // column's accessor value, case-insensitive substring match — so the board
  // half agrees with whatever the table's free-text search matched.
  function catalogRowText(row: Row): string {
    return columns
      .map((c) =>
        String((c.accessor ? c.accessor(row) : (row as Record<string, unknown>)[c.key]) ?? ''),
      )
      .join(' ');
  }
  const visibleSellables = $derived.by(() => {
    let list = applyFilters(sellables, tableFilters, tableAdvanced, catalogMatchOf);
    const q = tableSearch.trim().toLowerCase();
    if (q) list = list.filter((row) => catalogRowText(row).toLowerCase().includes(q));
    return list;
  });

  // Board columns and table group headers come from the SAME axis spec, so the
  // two views can never disagree on bucket membership or order. Only groups
  // with rows become columns (an empty category is noise on an editing board).
  const boardSpec = $derived(catalogGroupSpec<Row>(boardAxis.value));
  const boardColumns = $derived(
    groupRows(visibleSellables, boardSpec).map((g) => ({ id: g.key, label: g.label })),
  );
  const tableGroupSpec = $derived(
    tableAxis.value === 'none' ? undefined : catalogGroupSpec<Row>(tableAxis.value),
  );
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
    if (draft.kind !== undefined)
      return saveKind(row, draft.kind === 'product' ? 'product' : 'service');
    return saveRowPatch(
      `/api/pos/sellables/${row.productId}`,
      {
        unitPrice: draft.unitPrice !== '' ? Number(draft.unitPrice) : null,
      },
      undefined,
      context,
    );
  }

  /** A kind flip can be refused for a named reason (stock link, service
   *  components); the row-save helper drops 4xx bodies, so surface it here. */
  async function saveKind(row: Row, kind: 'service' | 'product'): Promise<RowSaveResult> {
    const res = await fetch(`/api/pos/sellables/${row.productId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind }),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
      toastError(
        d.code === 'kind_has_stock'
          ? m.pos_catalog_kind_has_stock()
          : d.code === 'kind_has_services'
            ? m.pos_catalog_kind_has_services()
            : (d.error ?? m.data_table_save_failed()),
      );
      return { status: res.status === 409 ? 'conflict' : 'failed' };
    }
    await refreshCatalog();
    return { status: 'succeeded' };
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
    {
      key: 'kind',
      label: m.pos_catalog_col_kind(),
      custom: true,
      editable: true,
      type: 'select',
      // Stored, operator-chosen (spec 2026-10-10 Slice 1). A package reads as
      // 'bundle' from the server but IS a service for the operator.
      accessor: (s) => (s.kind === 'bundle' ? 'service' : s.kind),
      options: () => [
        { value: 'service', label: m.pos_catalog_kind_service() },
        { value: 'product', label: m.pos_catalog_kind_product() },
      ],
    },
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
            numeric: true,
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
      type: 'boolean',
      custom: true,
      accessor: (s) => s.active,
      exportValue: (s) => (s.active ? 1 : 0),
      filter: { match: (s) => s.active },
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
  <DataView views={['table', 'board']} value={viewPref.value} onchange={viewPref.set}>
    {#snippet children({ switcher, view })}
      <PageHeader
        titleId="pos-catalog-title"
        title={m.pos_catalog_title()}
        subtitle={m.pos_catalog_subtitle()}
      >
        {#snippet leading()}<LayoutGrid
            size={iconSizes.md}
            class="text-accent shrink-0"
          />{/snippet}
        {#snippet actions()}
          <div class="view-bar">
            {#if view === 'board'}
              <GroupByPicker
                options={axisItems}
                value={boardAxis.value}
                onChange={(v) => boardAxis.set(v as 'category' | 'zone' | 'line')}
              />
            {/if}
            <!-- TABLE view's own group-by picker now lives in DataTable's toolbar
             (groupOptions/bind:groupValue below) — see the view-tools segment. -->
            {@render switcher()}
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
        <BoardView
          columns={boardColumns}
          rows={visibleSellables}
          columnOf={boardSpec.of}
          rowKey={(s) => s.productId}
          onopen={openEdit}
          emptyMessage={m.pos_sell_no_results()}
        >
          {#snippet card(s)}
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
          {/snippet}
        </BoardView>
      {:else}
        <DataTable
          class="flex-1 min-h-0"
          {columns}
          data={sellables}
          getRowId={(s) => s.productId}
          customProperties={{
            bundle: data.customProperties,
            recordId: (sellable) => sellable.productId,
            scopeKey: `${data.activeOrgId ?? ''}:pos.catalog`,
          }}
          tableId="pos.catalog"
          idColumn={{ value: (s) => s.code }}
          titleColumn={{
            key: 'name',
            href: (s) => `/pos/catalog/${encodeURIComponent(s.productId)}/edit`,
          }}
          tagScope="catalog"
          tagsOf={(s) => directManualTags(s).map((t) => t.id)}
          searchPlaceholder={m.data_table_search()}
          bind:search={tableSearch}
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
          bind:filters={tableFilters}
          bind:advanced={tableAdvanced}
          groupBy={tableGroupSpec}
          groupOptions={axisItems}
          bind:groupValue={
            () => (tableAxis.value === 'none' ? '' : tableAxis.value),
            (v) => tableAxis.set((v || 'none') as GroupAxis)
          }
          groupNoneLabel={m.catalog_group_none()}
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
              <span class="tabular-nums"
                >{s.unitPrice != null ? formatMoney(s.unitPrice) : '—'}</span
              >
            {:else if col.key === 'kind'}
              <!-- Type is Service | Product (operator-chosen); a package is a service
               that contains services, so it reads as Service + a caption. -->
              <Badge variant="semantic" value={kindTone(s.kind === 'bundle' ? 'service' : s.kind)}
                >{kindLabel(s.kind === 'bundle' ? 'service' : s.kind)}</Badge
              >
              {#if s.kind === 'bundle'}<span class="t-caption kind-caption"
                  >{m.pos_catalog_kind_bundle()}</span
                >{/if}
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
                showAdd={false}
                open={!!context.open}
                onOpenChange={context.onOpenChange}
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
                <span
                  class="tabular-nums"
                  title={s.partial ? m.fin_cost_partial_hint() : undefined}
                >
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
    {/snippet}
  </DataView>
</PageShell>

<!-- One composition per entry (spec 2026-10-10 Slice 2): a service is composed
     of products and/or services, a product of products only. A service child
     makes the entry a package (one grant per child service when rung up). -->
{#snippet expandedContent(s: Row)}
  <CompositionEditor
    sellable={s}
    {sellables}
    stockItems={data.stockItems}
    {stockEnabled}
    canEdit={canWrite}
    onChanged={() => invalidate('pos:catalog')}
  />
{/snippet}

<style>
  .view-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
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
  .kind-caption {
    margin-left: var(--space-1);
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
