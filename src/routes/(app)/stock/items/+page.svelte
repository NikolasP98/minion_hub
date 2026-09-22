<script lang="ts">
  import type { PageData } from './$types';
  import { page } from '$app/state';
  import { checkedRefresh } from '$lib/services/actions/refresh';
  import { invalidate, goto } from '$lib/navigation';
  import * as m from '$lib/paraglide/messages';
  import { Package } from 'lucide-svelte';
  import { PageHeader, Modal, Button, EmptyState, Tooltip } from '$lib/components/ui';
  import { PageShell } from '$lib/components/ui/foundations';
  import DataTable from '$lib/components/data-table/DataTable.svelte';
  import type { DataColumn, EditDraft } from '$lib/components/data-table/DataTable.svelte';
  import { canAct } from '$lib/access/can.svelte';
  import { formatMoney } from '$lib/utils/format';
  import StockItemCreateForm from '$lib/components/stock/StockItemCreateForm.svelte';
  import type { StockItemOption } from '$lib/components/stock/StockItemCreateForm.svelte';
  import TagChip from '$lib/components/tags/TagChip.svelte';

  import { saveRowPatch, type RowSaveResult } from '$lib/components/data-table/row-save';
  import type { CommandContext } from '$lib/services/actions/definition';

  let { data }: { data: PageData } = $props();
  const items = $derived(data.items);
  type Row = (typeof items)[number];

  async function saveRow(
    it: Row,
    draft: EditDraft,
    context?: CommandContext,
  ): Promise<RowSaveResult> {
    return saveRowPatch(
      `/api/stock/items/${it.id}`,
      {
        name: draft.name,
        itemGroup: draft.itemGroup || null,
        reorderLevel: draft.reorderLevel !== '' ? Number(draft.reorderLevel) : null,
        reorderQty: draft.reorderQty !== '' ? Number(draft.reorderQty) : null,
        moq: draft.moq !== '' ? Number(draft.moq) : null,
      },
      undefined,
      context,
    );
  }

  const columns: DataColumn<Row>[] = [
    {
      key: 'code',
      label: m.stock_col_code(),
      custom: true,
      accessor: (it) => it.code,
      cellClass: 'font-mono text-xs',
    },
    {
      key: 'name',
      label: m.stock_col_name(),
      accessor: (it) => it.name,
      editable: true,
      custom: true,
    },
    {
      key: 'itemGroup',
      label: m.stock_col_group(),
      accessor: (it) => it.itemGroup ?? '',
      editable: true,
    },
    { key: 'uom', label: m.stock_col_uom(), accessor: (it) => it.uom },
    {
      key: 'tags',
      label: m.stock_col_tags(),
      custom: true,
      sortable: false,
      accessor: (it) => [...it.tags, ...it.inheritedTags].map((t) => t.name).join(', '),
      // Inherited tags are filterable too — "show every recipe that uses a
      // vegan ingredient" is the point of inheritance.
      filter: {
        options: () => data.tags.map((t) => ({ value: t.id, label: t.name })),
        match: (it) => [...it.tags, ...it.inheritedTags].map((t) => t.id),
      },
    },
    {
      key: 'qtyOnHand',
      label: m.stock_col_on_hand(),
      align: 'right',
      custom: true,
      accessor: (it) => it.qtyOnHand,
    },
    {
      key: 'stockValue',
      label: m.stock_col_value(),
      align: 'right',
      custom: true,
      money: true,
      accessor: (it) => it.stockValue,
      exportValue: (it) => it.stockValue,
    },
    {
      key: 'reorderLevel',
      label: m.stock_col_reorder_level(),
      align: 'right',
      editable: true,
      type: 'number',
      accessor: (it) => it.reorderLevel,
    },
    {
      key: 'reorderQty',
      label: m.stock_col_reorder_qty(),
      align: 'right',
      editable: true,
      type: 'number',
      accessor: (it) => it.reorderQty,
    },
    {
      key: 'moq',
      label: m.stock_col_moq(),
      align: 'right',
      editable: true,
      type: 'number',
      accessor: (it) => it.moq,
    },
    // Derived from the ledger (last positive movement), not columns — so
    // read-only here.
    {
      key: 'lastRestockCost',
      label: m.stock_col_last_restock_cost(),
      align: 'right',
      custom: true,
      accessor: (it) => it.lastRestockCost,
      exportValue: (it) => it.lastRestockCost ?? '',
    },
    {
      key: 'lastSupplierName',
      label: m.stock_col_last_supplier(),
      accessor: (it) => it.lastSupplierName ?? '',
    },
  ];

  // ── Create ───────────────────────────────────────────────────────────────
  // svelte-ignore state_referenced_locally
  let createOpen = $state(data.openNew ?? false);
  // ?new=1 while already on the page (assistant deep link): load re-runs, the seed does not.
  $effect(() => {
    if (data.openNew) createOpen = true;
  });

  async function handleCreated(item: StockItemOption) {
    createOpen = false;
    await invalidate('stock:items');
    await goto(`/stock/items/${item.id}`);
  }
</script>

<svelte:head><title>{m.stock_items_title()} — {m.nav_stock()}</title></svelte:head>

<PageShell archetype="collection" scroll="region" labelledBy="stock-items-title">
  <PageHeader
    titleId="stock-items-title"
    title={m.stock_items_title()}
    subtitle={m.stock_items_subtitle()}
  >
    {#snippet leading()}<Package size={16} class="text-accent shrink-0" />{/snippet}
  </PageHeader>

  {#if items.length === 0}
    <EmptyState
      icon={Package}
      title={m.stock_items_empty()}
      description={m.stock_items_empty_hint()}
    >
      {#snippet action()}
        <Button
          variant="primary"
          size="sm"
          onclick={() => (createOpen = true)}
          disabled={!canAct('stock', 'create')}
          title={canAct('stock', 'create') ? undefined : m.no_permission()}
        >
          {m.stock_new_item()}
        </Button>
      {/snippet}
    </EmptyState>
  {:else}
    <DataTable
      class="flex-1 min-h-0"
      {columns}
      data={items}
      getRowId={(it) => it.id}
      searchPlaceholder={m.data_table_search()}
      exportable
      exportName="stock-items"
      selectable
      storageKey="stock-items"
      canEdit={canAct('stock', 'edit')}
      onSaveRow={saveRow}
      onSaveComplete={() =>
        checkedRefresh(
          () => invalidate('stock:items'),
          () => page,
        )}
      addLabel={m.stock_new_item()}
      onAdd={() => (createOpen = true)}
      addDisabled={!canAct('stock', 'create')}
      emptyMessage={m.stock_items_empty()}
    >
      {#snippet cell(it: Row, col: DataColumn<Row>)}
        {#if col.key === 'code'}
          <a href="/stock/items/{it.id}" class="hover:underline">{it.code}</a>
        {:else if col.key === 'name'}
          <span class="truncate block max-w-[16rem]">{it.name}</span>
        {:else if col.key === 'lastRestockCost'}
          <span class="tabular-nums"
            >{it.lastRestockCost != null ? formatMoney(it.lastRestockCost) : '—'}</span
          >
        {:else if col.key === 'qtyOnHand'}
          {#if it.lowStock}
            <Tooltip
              label={m.stock_low_stock_tooltip({ level: String(it.reorderLevel ?? 0) })}
              openDelay={400}
            >
              <span
                class="block text-right tabular-nums rounded-[var(--radius-xs)] bg-warning/15 px-1.5 text-warning"
              >
                {it.qtyOnHand}
              </span>
            </Tooltip>
          {:else}
            <span class="block text-right tabular-nums">{it.qtyOnHand}</span>
          {/if}
        {:else if col.key === 'stockValue'}
          <span class="tabular-nums">{formatMoney(it.stockValue)}</span>
        {:else if col.key === 'tags'}
          {#if it.tags.length || it.inheritedTags.length}
            <div class="tag-chips">
              {#each it.tags as t (t.id)}
                <TagChip size="sm" name={t.name} color={t.color} />
              {/each}
              {#each it.inheritedTags as t ('i:' + t.id)}
                <TagChip
                  size="sm"
                  name={t.name}
                  color={t.color}
                  dashed
                  title={m.tags_from_ingredients()}
                />
              {/each}
            </div>
          {:else}
            <span class="text-tertiary">—</span>
          {/if}
        {/if}
      {/snippet}
    </DataTable>
  {/if}
</PageShell>

<Modal bind:open={createOpen} title={m.stock_create_item_title()}>
  <StockItemCreateForm oncreated={handleCreated} oncancel={() => (createOpen = false)} />
</Modal>

<style>
  .tag-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
</style>
