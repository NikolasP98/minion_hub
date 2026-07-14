<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate } from '$app/navigation';
  import * as m from '$lib/paraglide/messages';
  import { LayoutGrid } from 'lucide-svelte';
  import { PageHeader, Badge, Button, Toggle } from '$lib/components/ui';
  import { PageShell } from '$lib/components/ui/foundations';
  import DataTable from '$lib/components/data-table/DataTable.svelte';
  import type { DataColumn, EditDraft } from '$lib/components/data-table/DataTable.svelte';
  import { canAct } from '$lib/access/can.svelte';
  import { toastError } from '$lib/state/ui/toast.svelte';
  import { formatMoney } from '$lib/utils/format';
  import SellableWizard, { type SellableLike } from '$lib/components/pos/SellableWizard.svelte';

  let { data }: { data: PageData } = $props();
  const sellables = $derived(data.sellables);
  const stockEnabled = $derived(data.stockEnabled);
  type Row = (typeof sellables)[number];

  const categories = $derived(
    Array.from(new Set(sellables.map((s) => s.category).filter((c): c is string => !!c))).sort(),
  );

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
  const canWrite = $derived(canAct('pos', 'edit'));
</script>

<svelte:head><title>{m.pos_catalog_title()} — {m.pos_nav_catalog()}</title></svelte:head>

<PageShell archetype="collection" scroll="region" labelledBy="pos-catalog-title">
  <PageHeader
    titleId="pos-catalog-title"
    title={m.pos_catalog_title()}
    subtitle={m.pos_catalog_subtitle()}
  >
    {#snippet leading()}<LayoutGrid size={16} class="text-accent shrink-0" />{/snippet}
  </PageHeader>

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
    addLabel={m.pos_catalog_new()}
    onAdd={openCreate}
    addDisabled={!canWrite}
    emptyMessage={m.pos_catalog_empty()}
  >
    {#snippet cell(s: Row, col: DataColumn<Row>)}
      {#if col.key === 'name'}
        {#if canWrite}
          <Button variant="ghost" size="sm" class="name-link" onclick={() => openEdit(s)}
            >{s.name}</Button
          >
        {:else}
          <span class="truncate block max-w-[16rem]">{s.name}</span>
        {/if}
      {:else if col.key === 'unitPrice'}
        <span class="tabular-nums">{s.unitPrice != null ? formatMoney(s.unitPrice) : '—'}</span>
      {:else if col.key === 'kind'}
        <Badge variant="semantic" value={s.kind === 'product' ? 'accent' : 'info'}>
          {s.kind === 'product' ? m.pos_catalog_kind_product() : m.pos_catalog_kind_service()}
        </Badge>
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
</PageShell>

<SellableWizard
  bind:open={wizardOpen}
  {stockEnabled}
  stockItems={data.stockItems}
  {categories}
  consumption={data.consumption}
  editing={editingRow}
  onSaved={() => invalidate('pos:catalog')}
/>

<style>
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
  .mapping-dot.on {
    background: var(--color-success, var(--color-emerald));
  }
</style>
