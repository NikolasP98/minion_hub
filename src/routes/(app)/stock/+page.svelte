<script lang="ts">
  import type { PageData } from './$types';
  import { Warehouse } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { formatMoney } from '$lib/utils/format';
  import { PageHeader, EmptyState } from '$lib/components/ui';
  import EditableGrid from '$lib/components/dashboard/EditableGrid.svelte';
  import { canAct } from '$lib/access/can.svelte';
  import { isAdmin } from '$lib/state/features/user.svelte';

  let { data }: { data: PageData } = $props();

  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  // Money vs quantity: `fmt` stays unit-less for qty; money gets its symbol.
  const fmtMoney = (n: string | number) => formatMoney(Number(n));

  const kpis = $derived([
    { id: 'k-valuation', label: m.stock_kpi_valuation(), value: fmtMoney(data.totalValuation) },
    { id: 'k-lowstock', label: m.stock_kpi_low_stock(), value: String(data.lowStock.length), href: '/stock/items' },
    { id: 'k-items', label: m.stock_kpi_items(), value: String(data.itemCount), href: '/stock/items' },
    { id: 'k-warehouses', label: m.stock_kpi_warehouses(), value: String(data.warehouseCount), href: '/stock/warehouses' },
  ]);
  const kpiById = $derived(new Map(kpis.map((k) => [k.id, k])));

  const items = $derived([...kpis.map((k) => ({ id: k.id, w: 3, h: 2 })), { id: 'lowstock', w: 6, h: 6 }, { id: 'recent', w: 6, h: 6 }]);
</script>

<svelte:head><title>{m.nav_stock()}</title></svelte:head>

{#snippet cellBody(id: string)}
  {#if id.startsWith('k-')}
    {@const k = kpiById.get(id)}
    {#if k}
      {@const href = 'href' in k ? k.href : undefined}
      {#if href}
        <a class="kpi kpi-link" {href}>
          <div class="kpi-val">{k.value}</div>
          <div class="kpi-label">{k.label}</div>
        </a>
      {:else}
        <div class="kpi">
          <div class="kpi-val">{k.value}</div>
          <div class="kpi-label">{k.label}</div>
        </div>
      {/if}
    {/if}
  {:else if id === 'lowstock'}
    <div class="card">
      <div class="card-h">{m.stock_low_stock_title()}</div>
      {#if data.lowStock.length === 0}
        <p class="t-caption">{m.stock_low_stock_empty()}</p>
      {:else}
        <table class="mini-table">
          <thead>
            <tr>
              <th>{m.stock_col_item()}</th>
              <th>{m.stock_col_warehouse()}</th>
              <th class="num">{m.stock_col_qty()}</th>
              <th class="num">{m.stock_col_reorder()}</th>
            </tr>
          </thead>
          <tbody>
            {#each data.lowStock as r (r.itemId + r.warehouseName)}
              <tr>
                <td><a href="/stock/items/{r.itemId}">{r.itemName}</a></td>
                <td>{r.warehouseName}</td>
                <td class="num warn">{fmt(r.qty)}</td>
                <td class="num">{fmt(r.reorderLevel)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  {:else if id === 'recent'}
    <div class="card">
      <div class="card-h">{m.stock_recent_title()}</div>
      {#if data.recent.length === 0}
        <p class="t-caption">{m.stock_recent_empty()}</p>
      {:else}
        <table class="mini-table">
          <thead>
            <tr>
              <th>{m.stock_col_item()}</th>
              <th>{m.stock_col_warehouse()}</th>
              <th class="num">{m.stock_col_qty()}</th>
            </tr>
          </thead>
          <tbody>
            {#each data.recent as r (r.id)}
              <tr>
                <td>{r.itemName}</td>
                <td>{r.warehouseName}</td>
                <td class="num" class:in={r.qtyDelta > 0} class:out={r.qtyDelta < 0}>
                  {r.qtyDelta > 0 ? '+' : ''}{fmt(r.qtyDelta)}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  {/if}
{/snippet}

<div class="flex flex-col h-full min-h-0 flex-1 min-w-0">
  <PageHeader title={m.nav_stock()} subtitle={m.stock_overview_subtitle()}>
    {#snippet leading()}<Warehouse size={16} class="text-accent shrink-0" />{/snippet}
  </PageHeader>

  <div class="flex-1 min-h-0 overflow-auto p-4">
    <div class="w-full max-w-6xl mx-auto">
      {#if !data.hasData}
        <EmptyState icon={Warehouse} title={m.stock_empty_title()} description={m.stock_empty_body()} />
      {:else}
        <EditableGrid id="stock-dashboard-v1" {items} cols={12} rowHeight={56} canSetDefault={isAdmin.value} readonly={!canAct('stock', 'edit')}>
          {#snippet cell(id)}{@render cellBody(id)}{/snippet}
        </EditableGrid>
      {/if}
    </div>
  </div>
</div>

<style>
  .kpi { display: flex; flex-direction: column; justify-content: center; padding: var(--space-3) var(--space-4); border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); height: 100%; }
  .kpi-link { text-decoration: none; color: inherit; transition: border-color var(--duration-fast), background var(--duration-fast); cursor: pointer; }
  .kpi-link:hover { border-color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 6%, var(--color-card)); }
  .kpi-val { font-size: var(--font-size-display); font-weight: 700; font-variant-numeric: tabular-nums; }
  .kpi-label { font-size: var(--font-size-caption); color: var(--color-muted-foreground); margin-top: var(--space-1); }
  .card { border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); padding: var(--space-3) var(--space-4); height: 100%; overflow: auto; }
  .card-h { font-size: var(--font-size-body); font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: var(--color-muted-foreground); margin-bottom: var(--space-3); }
  .mini-table { width: 100%; font-size: var(--font-size-body); border-collapse: collapse; }
  .mini-table th { text-align: left; font-weight: 500; color: var(--color-muted-foreground); padding: var(--space-1) var(--space-2); border-bottom: 1px solid var(--hairline); }
  .mini-table td { padding: var(--space-1) var(--space-2); border-bottom: 1px solid var(--hairline); }
  .mini-table .num { text-align: right; font-variant-numeric: tabular-nums; }
  .mini-table .warn { color: var(--color-warning); font-weight: 600; }
  .mini-table .in { color: var(--color-success, var(--color-emerald)); }
  .mini-table .out { color: var(--color-destructive); }
</style>
