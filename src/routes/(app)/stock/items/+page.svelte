<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate, goto } from '$lib/navigation';
  import * as m from '$lib/paraglide/messages';
  import { Package } from 'lucide-svelte';
  import { PageHeader, Button, Modal } from '$lib/components/ui';
  import { PageShell } from '$lib/components/ui/foundations';
  import DataTable from '$lib/components/data-table/DataTable.svelte';
  import type { DataColumn, EditDraft } from '$lib/components/data-table/DataTable.svelte';
  import { canAct } from '$lib/access/can.svelte';

  let { data }: { data: PageData } = $props();
  const items = $derived(data.items);
  type Row = (typeof items)[number];

  async function saveRow(it: Row, draft: EditDraft): Promise<boolean> {
    const res = await fetch(`/api/stock/items/${it.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: draft.name,
        itemGroup: draft.itemGroup || null,
        reorderLevel: draft.reorderLevel !== '' ? Number(draft.reorderLevel) : null,
        reorderQty: draft.reorderQty !== '' ? Number(draft.reorderQty) : null,
      }),
    });
    if (res.ok) await invalidate('stock:items');
    return res.ok;
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
      key: 'reorderLevel',
      label: m.stock_col_reorder_level(),
      align: 'right',
      editable: true,
      editType: 'number',
      accessor: (it) => it.reorderLevel,
    },
    {
      key: 'reorderQty',
      label: m.stock_col_reorder_qty(),
      align: 'right',
      editable: true,
      editType: 'number',
      accessor: (it) => it.reorderQty,
    },
  ];

  // ── Create ───────────────────────────────────────────────────────────────
  let createOpen = $state(false);
  let newCode = $state('');
  let newName = $state('');
  let newUom = $state('unit');
  let createBusy = $state(false);
  let createErr = $state<string | null>(null);

  async function createItem() {
    createBusy = true;
    createErr = null;
    try {
      const res = await fetch('/api/stock/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: newCode, name: newName, uom: newUom || 'unit' }),
      });
      if (res.ok) {
        const item = await res.json();
        createOpen = false;
        newCode = '';
        newName = '';
        newUom = 'unit';
        await invalidate('stock:items');
        await goto(`/stock/items/${item.id}`);
      } else {
        createErr = m.stock_item_save_failed();
      }
    } finally {
      createBusy = false;
    }
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
      {/if}
    {/snippet}
  </DataTable>
</PageShell>

<Modal bind:open={createOpen} title={m.stock_create_item_title()}>
  <div class="flex flex-col gap-3">
    <label class="fld">
      <span>{m.stock_field_code()}</span>
      <input class="inp" bind:value={newCode} />
    </label>
    <label class="fld">
      <span>{m.stock_field_name()}</span>
      <input class="inp" bind:value={newName} />
    </label>
    <label class="fld">
      <span>{m.stock_field_uom()}</span>
      <input class="inp" bind:value={newUom} />
    </label>
    {#if createErr}<p class="err-msg text-xs">{createErr}</p>{/if}
  </div>
  {#snippet footer()}
    <Button variant="outline" size="sm" onclick={() => (createOpen = false)}
      >{m.common_cancel()}</Button
    >
    <Button
      variant="primary"
      size="sm"
      onclick={createItem}
      disabled={createBusy || !newCode.trim() || !newName.trim()}
    >
      {m.stock_create()}
    </Button>
  {/snippet}
</Modal>

<style>
  .inp {
    height: 1.75rem;
    padding: 0 var(--space-2, 8px);
    font-size: var(--font-size-body, 14px);
    border-radius: var(--radius-sm);
    background: var(--color-bg3);
    border: 1px solid var(--hairline);
    color: var(--color-foreground);
  }
  .fld {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 4px);
    font-size: var(--font-size-body, 14px);
    color: var(--color-muted-foreground);
  }
  .err-msg {
    font-size: var(--font-size-body, 14px);
    color: var(--color-destructive);
  }
</style>
