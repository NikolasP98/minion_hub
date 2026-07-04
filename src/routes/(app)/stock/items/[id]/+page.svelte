<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate } from '$app/navigation';
  import * as m from '$lib/paraglide/messages';
  import { Package, ArrowLeft, ExternalLink } from 'lucide-svelte';
  import { PageHeader, Button } from '$lib/components/ui';
  import { canAct } from '$lib/access/can.svelte';

  let { data }: { data: PageData } = $props();
  const item = $derived(data.item);

  let editing = $state(false);
  let editName = $state('');
  let editReorderLevel = $state('');
  let editReorderQty = $state('');
  let busy = $state(false);
  let err = $state<string | null>(null);

  function startEdit() {
    editName = item.name;
    editReorderLevel = item.reorderLevel ?? '';
    editReorderQty = item.reorderQty ?? '';
    err = null;
    editing = true;
  }

  async function save() {
    busy = true;
    err = null;
    try {
      const res = await fetch(`/api/stock/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: editName,
          reorderLevel: editReorderLevel !== '' ? Number(editReorderLevel) : null,
          reorderQty: editReorderQty !== '' ? Number(editReorderQty) : null,
        }),
      });
      if (res.ok) {
        editing = false;
        await invalidate('stock:item-detail');
      } else {
        err = m.stock_item_save_failed();
      }
    } finally {
      busy = false;
    }
  }

  const fmt = (n: string | number) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
</script>

<svelte:head><title>{item.name} — {m.nav_stock()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
  <PageHeader title={item.name} subtitle={item.code}>
    {#snippet leading()}<Package size={16} class="text-accent shrink-0" />{/snippet}
    {#snippet actions()}
      <Button variant="outline" size="sm" onclick={() => history.back()}><ArrowLeft size={14} /> {m.common_back()}</Button>
      {#if !editing}
        <Button
          variant="outline"
          size="sm"
          onclick={startEdit}
          disabled={!canAct('stock', 'edit')}
          title={canAct('stock', 'edit') ? undefined : m.no_permission()}
        >{m.common_edit()}</Button>
      {/if}
    {/snippet}
  </PageHeader>

  <div class="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4">
    <div class="card">
      {#if editing}
        <div class="flex flex-col gap-3 max-w-md">
          <label class="fld"><span>{m.stock_field_name()}</span><input class="inp" bind:value={editName} /></label>
          <label class="fld"><span>{m.stock_col_reorder_level()}</span><input class="inp" type="number" min="0" step="0.01" bind:value={editReorderLevel} /></label>
          <label class="fld"><span>{m.stock_col_reorder_qty()}</span><input class="inp" type="number" min="0" step="0.01" bind:value={editReorderQty} /></label>
          {#if err}<p class="err-msg">{err}</p>{/if}
          <div class="flex gap-2">
            <Button variant="primary" size="sm" onclick={save} disabled={busy}>{m.common_save()}</Button>
            <Button variant="outline" size="sm" onclick={() => (editing = false)}>{m.common_cancel()}</Button>
          </div>
        </div>
      {:else}
        <dl class="meta-grid">
          <dt>{m.stock_col_uom()}</dt><dd>{item.uom}</dd>
          <dt>{m.stock_col_group()}</dt><dd>{item.itemGroup ?? '—'}</dd>
          <dt>{m.stock_col_reorder_level()}</dt><dd>{item.reorderLevel ?? '—'}</dd>
          <dt>{m.stock_col_reorder_qty()}</dt><dd>{item.reorderQty ?? '—'}</dd>
        </dl>
      {/if}
    </div>

    <div class="card">
      <div class="card-h">{m.stock_item_bins_title()}</div>
      {#if data.bins.length === 0}
        <p class="t-caption">{m.stock_bins_empty()}</p>
      {:else}
        <table class="mini-table">
          <thead><tr><th>{m.stock_col_warehouse()}</th><th class="num">{m.stock_col_qty()}</th><th class="num">{m.stock_col_valuation_rate()}</th><th class="num">{m.stock_col_value()}</th></tr></thead>
          <tbody>
            {#each data.bins as b (b.warehouseId)}
              <tr>
                <td>{b.warehouseName}</td>
                <td class="num">{fmt(b.qty)}</td>
                <td class="num">{fmt(b.valuationRate)}</td>
                <td class="num">{fmt(Number(b.qty) * Number(b.valuationRate))}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>

    <div class="card">
      <div class="card-h">{m.stock_item_ledger_title()}</div>
      {#if data.ledger.length === 0}
        <p class="t-caption">{m.stock_ledger_empty()}</p>
      {:else}
        <table class="mini-table">
          <thead>
            <tr>
              <th>{m.stock_col_posted_at()}</th>
              <th>{m.stock_col_warehouse()}</th>
              <th class="num">{m.stock_col_delta()}</th>
              <th class="num">{m.stock_col_qty_after()}</th>
              <th class="num">{m.stock_col_valuation_rate()}</th>
            </tr>
          </thead>
          <tbody>
            {#each data.ledger as l (l.id)}
              <tr>
                <td class="t-caption">{new Date(l.postedAt).toLocaleString()}</td>
                <td>{l.warehouseName}</td>
                <td class="num" class:in={Number(l.qtyDelta) > 0} class:out={Number(l.qtyDelta) < 0}>
                  {Number(l.qtyDelta) > 0 ? '+' : ''}{fmt(l.qtyDelta)}
                </td>
                <td class="num">{fmt(l.qtyAfter)}</td>
                <td class="num">{fmt(l.valuationRate)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>

    <div class="card">
      <div class="card-h">{m.stock_item_consumed_by_title()}</div>
      {#if data.consumedBy.length === 0}
        <p class="t-caption">{m.stock_item_consumed_by_empty()}</p>
      {:else}
        <table class="mini-table">
          <thead><tr><th>{m.stock_col_product()}</th><th class="num">{m.stock_consumption_col_qty_per_unit()}</th><th>{m.stock_field_note()}</th></tr></thead>
          <tbody>
            {#each data.consumedBy as c (c.id)}
              <tr>
                <td>{c.productCode} — {c.productName}</td>
                <td class="num">{fmt(c.qtyPerUnit)}</td>
                <td class="t-caption">{c.note ?? '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        <a class="consumed-link" href="/stock/consumption">{m.stock_item_manage_consumption()} <ExternalLink size={12} /></a>
      {/if}
    </div>
  </div>
</div>

<style>
  .card { border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); padding: 0.85rem 1rem; }
  .card-h { font-size: 0.78rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: var(--color-muted-foreground); margin-bottom: 0.7rem; }
  .meta-grid { display: grid; grid-template-columns: max-content 1fr; gap: 0.35rem 1rem; font-size: 0.86rem; }
  .meta-grid dt { color: var(--color-muted-foreground); }
  .fld { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.78rem; color: var(--color-muted-foreground); }
  .inp { height: 1.75rem; padding: 0 0.5rem; font-size: 0.82rem; border-radius: var(--radius-sm); background: var(--color-bg3); border: 1px solid var(--hairline); color: var(--color-foreground); }
  .err-msg { font-size: 0.8rem; color: var(--color-destructive); }
  .mini-table { width: 100%; font-size: 0.82rem; border-collapse: collapse; }
  .mini-table th { text-align: left; font-weight: 500; color: var(--color-muted-foreground); padding: 0.3rem 0.5rem; border-bottom: 1px solid var(--hairline); }
  .mini-table td { padding: 0.3rem 0.5rem; border-bottom: 1px solid var(--hairline); }
  .mini-table .num { text-align: right; font-variant-numeric: tabular-nums; }
  .mini-table .in { color: var(--color-success, var(--color-emerald)); }
  .mini-table .out { color: var(--color-destructive); }
  .consumed-link { display: inline-flex; align-items: center; gap: 0.3rem; margin-top: 0.6rem; font-size: 0.78rem; color: var(--color-accent); }
  .consumed-link:hover { text-decoration: underline; }
</style>
