<script lang="ts">
  import type { PageData } from './$types';
  import * as m from '$lib/paraglide/messages';
  import { formatMoney } from '$lib/utils/format';
  import { CalendarClock } from 'lucide-svelte';
  import { PageHeader, EmptyState } from '$lib/components/ui';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';

  let { data }: { data: PageData } = $props();
  type OpenRow = PageData['open'][number];
  type RealizedRow = PageData['realized'][number];
  const noCommitments = $derived(data.open.length === 0 && data.realized.length === 0);

  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  // Money vs quantity: `fmt` stays unit-less for qty; money gets its symbol.
  const fmtMoney = (n: string | number) => formatMoney(Number(n));

  const realizedSpend = $derived(
    data.realized.reduce((sum, r) => sum + Number(r.realizedValue ?? 0), 0),
  );
  const variance = $derived(
    data.realized.reduce((sum, r) => sum + (Number(r.realizedValue ?? 0) - Number(r.estValue)), 0),
  );

  const openColumns: DataColumn<OpenRow>[] = [
    { key: 'item', label: m.stock_field_item(), custom: true },
    { key: 'source', label: m.misc_source(), custom: true, accessor: (r) => r.source },
    {
      key: 'qty',
      label: m.stock_field_qty(),
      align: 'right',
      numeric: true,
      custom: true,
      accessor: (r) => Number(r.qtyConsumption),
    },
    {
      key: 'value',
      label: m.stock_col_value(),
      align: 'right',
      numeric: true,
      custom: true,
      accessor: (r) => Number(r.estValue),
    },
    {
      key: 'created',
      label: m.stock_col_created(),
      custom: true,
      accessor: (r) => r.createdAt,
    },
  ];

  const realizedColumns: DataColumn<RealizedRow>[] = [
    { key: 'item', label: m.stock_field_item(), custom: true },
    {
      key: 'qty',
      label: m.stock_field_qty(),
      align: 'right',
      numeric: true,
      custom: true,
      accessor: (r) => Number(r.qtyConsumption),
    },
    {
      key: 'value',
      label: m.stock_col_value(),
      align: 'right',
      numeric: true,
      custom: true,
      accessor: (r) => Number(r.estValue),
    },
    {
      key: 'realized',
      label: m.stock_commitments_realized(),
      align: 'right',
      numeric: true,
      custom: true,
      accessor: (r) => Number(r.realizedValue ?? 0),
    },
    {
      key: 'variance',
      label: m.stock_commitments_variance(),
      align: 'right',
      numeric: true,
      custom: true,
      accessor: (r) => Number(r.realizedValue ?? 0) - Number(r.estValue),
    },
  ];
</script>

<svelte:head><title>{m.stock_commitments_title()} — {m.nav_stock()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0 flex-1 min-w-0">
  <PageHeader title={m.stock_commitments_title()} subtitle={m.stock_commitments_hint()}>
    {#snippet leading()}<CalendarClock size={16} class="text-accent shrink-0" />{/snippet}
  </PageHeader>

  <div class="flex-1 min-h-0 overflow-auto p-4">
    {#if noCommitments}
      <EmptyState
        icon={CalendarClock}
        title={m.stock_commitments_empty_title()}
        description={m.stock_commitments_empty_hint()}
      />
    {:else}
      <div class="w-full max-w-5xl mx-auto flex flex-col gap-4">
        <div class="kpi-row">
          <div class="kpi">
            <div class="kpi-val">{fmtMoney(data.committed)}</div>
            <div class="kpi-label">{m.stock_commitments_committed()}</div>
          </div>
          <div class="kpi">
            <div class="kpi-val">{fmtMoney(realizedSpend)}</div>
            <div class="kpi-label">{m.stock_commitments_realized()}</div>
          </div>
          <div class="kpi">
            <div class="kpi-val" class:warn={variance > 0}>{fmtMoney(variance)}</div>
            <div class="kpi-label">{m.stock_commitments_variance()}</div>
          </div>
        </div>

        <div class="card">
          <div class="card-h">{m.stock_nav_commitments()}</div>
          {#if data.open.length === 0}
            <p class="t-caption">{m.stock_commitments_empty()}</p>
          {:else}
            <DataTable variant="plain" data={data.open} columns={openColumns} getRowId={(r) => r.id}>
              {#snippet cell(row: OpenRow, col: DataColumn<OpenRow>)}
                {#if col.key === 'item'}
                  <span class="item-name">{row.itemName}</span>
                  <span class="item-code">{row.itemCode}</span>
                {:else if col.key === 'source'}
                  <span class="t-caption">{row.source}</span>
                {:else if col.key === 'qty'}
                  <span class="tabular-nums"
                    >{fmt(Number(row.qtyConsumption))} {row.consumptionUom ?? row.itemUom}</span
                  >
                {:else if col.key === 'value'}
                  <span class="tabular-nums">{fmtMoney(Number(row.estValue))}</span>
                {:else if col.key === 'created'}
                  <span class="t-caption">{new Date(row.createdAt).toLocaleDateString()}</span>
                {/if}
              {/snippet}
            </DataTable>
          {/if}
        </div>

        <div class="card">
          <div class="card-h">{m.stock_commitments_realized()}</div>
          {#if data.realized.length === 0}
            <p class="t-caption">{m.stock_commitments_empty()}</p>
          {:else}
            <DataTable
              variant="plain"
              data={data.realized}
              columns={realizedColumns}
              getRowId={(r) => r.id}
            >
              {#snippet cell(row: RealizedRow, col: DataColumn<RealizedRow>)}
                {#if col.key === 'item'}
                  <span class="item-name">{row.itemName}</span>
                  <span class="item-code">{row.itemCode}</span>
                {:else if col.key === 'qty'}
                  <span class="tabular-nums">
                    {fmt(Number(row.qtyConsumption))} / {fmt(Number(row.realizedQty ?? 0))}
                    {row.consumptionUom ?? row.itemUom}
                  </span>
                {:else if col.key === 'value'}
                  <span class="tabular-nums">{fmtMoney(Number(row.estValue))}</span>
                {:else if col.key === 'realized'}
                  <span class="tabular-nums">{fmtMoney(Number(row.realizedValue ?? 0))}</span>
                {:else if col.key === 'variance'}
                  {@const rowVariance = Number(row.realizedValue ?? 0) - Number(row.estValue)}
                  <span class="tabular-nums" class:cell-warn={rowVariance > 0}
                    >{fmtMoney(rowVariance)}</span
                  >
                {/if}
              {/snippet}
            </DataTable>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .kpi-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: var(--space-3);
  }
  .kpi {
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
  }
  .kpi-val {
    font-size: var(--font-size-display);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .kpi-val.warn {
    color: var(--color-warning);
  }
  .kpi-label {
    font-size: var(--font-size-caption);
    color: var(--color-muted-foreground);
    margin-top: var(--space-1);
  }
  .card {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    padding: var(--space-3) var(--space-4);
  }
  .card-h {
    font-size: var(--font-size-body);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-muted-foreground);
    margin-bottom: var(--space-3);
  }
  .cell-warn {
    color: var(--color-warning);
    font-weight: 600;
  }
  .item-name {
    display: block;
  }
  .item-code {
    display: block;
    font-size: var(--font-size-caption);
    color: var(--color-muted-foreground);
    font-family: var(--font-mono, monospace);
  }
</style>
