<script lang="ts">
  import type { PageData } from './$types';
  import * as m from '$lib/paraglide/messages';
  import { CalendarClock } from 'lucide-svelte';
  import { PageHeader } from '$lib/components/ui';

  let { data }: { data: PageData } = $props();

  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

  const realizedSpend = $derived(data.realized.reduce((sum, r) => sum + Number(r.realizedValue ?? 0), 0));
  const variance = $derived(data.realized.reduce((sum, r) => sum + (Number(r.realizedValue ?? 0) - Number(r.estValue)), 0));
</script>

<svelte:head><title>{m.stock_commitments_title()} — {m.nav_stock()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
  <PageHeader title={m.stock_commitments_title()} subtitle={m.stock_commitments_hint()}>
    {#snippet leading()}<CalendarClock size={16} class="text-accent shrink-0" />{/snippet}
  </PageHeader>

  <div class="flex-1 min-h-0 overflow-auto p-4">
    <div class="w-full max-w-5xl mx-auto flex flex-col gap-4">
      <div class="kpi-row">
        <div class="kpi">
          <div class="kpi-val">{fmt(data.committed)}</div>
          <div class="kpi-label">{m.stock_commitments_committed()}</div>
        </div>
        <div class="kpi">
          <div class="kpi-val">{fmt(realizedSpend)}</div>
          <div class="kpi-label">{m.stock_commitments_realized()}</div>
        </div>
        <div class="kpi">
          <div class="kpi-val" class:warn={variance > 0}>{fmt(variance)}</div>
          <div class="kpi-label">{m.stock_commitments_variance()}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-h">{m.stock_nav_commitments()}</div>
        {#if data.open.length === 0}
          <p class="t-caption">{m.stock_commitments_empty()}</p>
        {:else}
          <table class="mini-table">
            <thead>
              <tr>
                <th>{m.stock_field_item()}</th>
                <th>{m.misc_source()}</th>
                <th class="num">{m.stock_field_qty()}</th>
                <th class="num">{m.stock_col_value()}</th>
                <th>{m.stock_col_created()}</th>
              </tr>
            </thead>
            <tbody>
              {#each data.open as r (r.id)}
                <tr>
                  <td>
                    <span class="item-name">{r.itemName}</span>
                    <span class="item-code">{r.itemCode}</span>
                  </td>
                  <td class="t-caption">{r.source}</td>
                  <td class="num">{fmt(Number(r.qtyConsumption))} {r.consumptionUom ?? r.itemUom}</td>
                  <td class="num">{fmt(Number(r.estValue))}</td>
                  <td class="t-caption">{new Date(r.createdAt).toLocaleDateString()}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>

      <div class="card">
        <div class="card-h">{m.stock_commitments_realized()}</div>
        {#if data.realized.length === 0}
          <p class="t-caption">{m.stock_commitments_empty()}</p>
        {:else}
          <table class="mini-table">
            <thead>
              <tr>
                <th>{m.stock_field_item()}</th>
                <th class="num">{m.stock_field_qty()}</th>
                <th class="num">{m.stock_col_value()}</th>
                <th class="num">{m.stock_commitments_realized()}</th>
                <th class="num">{m.stock_commitments_variance()}</th>
              </tr>
            </thead>
            <tbody>
              {#each data.realized as r (r.id)}
                {@const rowVariance = Number(r.realizedValue ?? 0) - Number(r.estValue)}
                <tr>
                  <td>
                    <span class="item-name">{r.itemName}</span>
                    <span class="item-code">{r.itemCode}</span>
                  </td>
                  <td class="num">
                    {fmt(Number(r.qtyConsumption))} / {fmt(Number(r.realizedQty ?? 0))} {r.consumptionUom ?? r.itemUom}
                  </td>
                  <td class="num">{fmt(Number(r.estValue))}</td>
                  <td class="num">{fmt(Number(r.realizedValue ?? 0))}</td>
                  <td class="num" class:warn={rowVariance > 0}>{fmt(rowVariance)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: 0.75rem; }
  .kpi { display: flex; flex-direction: column; justify-content: center; padding: 0.85rem 1rem; border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); }
  .kpi-val { font-size: 1.5rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  .kpi-val.warn { color: var(--color-warning); }
  .kpi-label { font-size: 0.72rem; color: var(--color-muted-foreground); margin-top: 0.15rem; }
  .card { border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); padding: 0.85rem 1rem; }
  .card-h { font-size: 0.78rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: var(--color-muted-foreground); margin-bottom: 0.7rem; }
  .mini-table { width: 100%; font-size: 0.82rem; border-collapse: collapse; }
  .mini-table th { text-align: left; font-weight: 500; color: var(--color-muted-foreground); padding: 0.3rem 0.5rem; border-bottom: 1px solid var(--hairline); }
  .mini-table td { padding: 0.3rem 0.5rem; border-bottom: 1px solid var(--hairline); }
  .mini-table .num { text-align: right; font-variant-numeric: tabular-nums; }
  .mini-table .num.warn { color: var(--color-warning); font-weight: 600; }
  .item-name { display: block; }
  .item-code { display: block; font-size: 0.7rem; color: var(--color-muted-foreground); font-family: var(--font-mono, monospace); }
</style>
