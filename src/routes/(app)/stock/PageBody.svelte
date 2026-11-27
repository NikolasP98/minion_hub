<script lang="ts">
  import type { PageData as LoadedPageData } from './$types';
  import type { Granted } from '$lib/permissions';
  import { Warehouse } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { appLocale, formatMoney } from '$lib/utils/format';
  import { iconSizes, PageHeader, EmptyState, Badge } from '$lib/components/ui';
  import EditableGrid from '$lib/components/dashboard/EditableGrid.svelte';
  import Chart from '$lib/components/charts/Chart.svelte';
  import { chartColors } from '$lib/utils/chart-colors';
  import type { EChartsOption } from 'echarts';
  import { canAct } from '$lib/access/can.svelte';
  import { isAdmin } from '$lib/state/features/user.svelte';
  import { entryTypeLabel } from '$lib/components/stock/entry-type-label';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';

  type PageData = Granted<LoadedPageData['stock']>;
  let { data }: { data: PageData } = $props();
  type LowStockRow = PageData['lowStock'][number];
  type FullRecentRow = Extract<PageData['recentMovements'], { projection: 'full' }>['rows'][number];
  type RecentRow = {
    ledgerId: string;
    entryId: string;
    entryHref: string;
    itemId: string;
    warehouseId: string;
  } & Partial<FullRecentRow>;
  const recentRows = $derived(data.recentMovements.rows as RecentRow[]);
  const recentFull = $derived(data.recentMovements.projection === 'full');
  const recentKind = (r: RecentRow) => entryTypeLabel(r.movementKind) ?? m.stock_mv_kind_unknown();
  const recentItem = (r: RecentRow) =>
    r.item?.name ?? (recentFull ? r.itemId.slice(0, 8) : m.stock_mv_unavailable_value());

  const fmt = (n: number) => n.toLocaleString(appLocale(), { maximumFractionDigits: 2 });
  // Money vs quantity: `fmt` stays unit-less for qty; money gets its symbol.
  const fmtMoney = (n: string | number) => formatMoney(Number(n));

  const kpis = $derived([
    // TODO(handoff): qualify historical stock denomination before currency formatting; see proposals/2026-11-16-faces-stock-cash-crm-meeting-followups.md, Existing valuation-display follow-up.
    { id: 'k-valuation', label: m.stock_kpi_valuation(), value: fmtMoney(data.totalValuation) },
    {
      id: 'k-items',
      label: m.stock_kpi_items(),
      value: String(data.itemCount),
      href: '/stock/items',
    },
    {
      id: 'k-warehouses',
      label: m.stock_kpi_warehouses(),
      value: String(data.warehouseCount),
      href: '/stock/warehouses',
    },
  ]);
  const kpiById = $derived(new Map(kpis.map((k) => [k.id, k])));

  // Low-stock COUNT lives on the list card's header (owner 2026-09-17: the
  // KPI card duplicated the list). Charts: valuation and consumption per day.
  const items = $derived([
    ...kpis.map((k) => ({ id: k.id, label: k.label, w: 4, h: 2 })),
    { id: 'chart-value', w: 6, h: 5 },
    { id: 'chart-use', w: 6, h: 5 },
    { id: 'lowstock', w: 6, h: 6 },
    { id: 'recent', w: 6, h: 6 },
  ]);

  const c = $derived(chartColors());
  const dayLabel = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString(appLocale(), {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  const baseChart = (): EChartsOption => ({
    grid: { left: 8, right: 16, top: 12, bottom: 24, containLabel: true },
    xAxis: {
      type: 'category',
      data: data.series.map((p) => dayLabel(p.day)),
      axisLabel: { hideOverlap: true, color: c.mutedForeground },
      axisLine: { lineStyle: { color: c.border } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: (v: number) => formatMoney(v), color: c.mutedForeground },
      splitLine: { lineStyle: { color: c.border } },
    },
    tooltip: { trigger: 'axis', valueFormatter: (v) => formatMoney(Number(v)) },
  });
  const valueOpts = $derived<EChartsOption>({
    ...baseChart(),
    series: [
      {
        name: m.stock_chart_value_title(),
        type: 'line',
        data: data.series.map((p) => p.value),
        smooth: true,
        showSymbol: false,
        itemStyle: { color: c.accent },
        areaStyle: { color: c.accent, opacity: 0.12 },
      },
    ],
  });
  const useOpts = $derived<EChartsOption>({
    ...baseChart(),
    series: [
      {
        name: m.stock_chart_use_title(),
        type: 'bar',
        data: data.series.map((p) => p.used),
        itemStyle: { color: c.warning },
      },
    ],
  });

  const lowStockColumns: DataColumn<LowStockRow>[] = [
    { key: 'item', label: m.stock_col_item(), custom: true, accessor: (r) => r.itemName },
    {
      key: 'qty',
      label: m.stock_col_qty(),
      align: 'right',
      numeric: true,
      custom: true,
      accessor: (r) => r.qty,
    },
    {
      key: 'reorder',
      label: m.stock_col_reorder(),
      align: 'right',
      numeric: true,
      custom: true,
      accessor: (r) => r.reorderLevel,
    },
  ];

  /** Exact decimal strings: Number() is only the local ordering key, never the display. */
  const deltaCmp = (a: RecentRow, b: RecentRow) =>
    Number(a.qtyDelta ?? 0) - Number(b.qtyDelta ?? 0);
  const recentColumns = $derived.by((): DataColumn<RecentRow>[] => {
    const sortable = data.recentMovements.projection !== 'identity_only';
    const hasValues = data.recentMovements.projection !== 'identity_only';
    return [
      { key: 'item', label: m.stock_col_item(), sortable: recentFull, accessor: recentItem },
      {
        key: 'warehouse',
        label: m.stock_col_warehouse(),
        sortable: recentFull,
        accessor: (r) => r.warehouseName ?? r.warehouseId.slice(0, 8),
      },
      {
        key: 'qtyDelta',
        label: m.stock_col_qty(),
        align: 'right',
        numeric: true,
        custom: true,
        sortable: sortable && hasValues,
        sortFn: deltaCmp,
        accessor: (r) => r.qtyDelta ?? '',
      },
      {
        key: 'entry',
        label: m.stock_col_entry(),
        sortable: false,
        custom: true,
        accessor: (r) => r.entryHumanId ?? r.entryId.slice(0, 8),
      },
    ];
  });
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
  {:else if id === 'chart-value'}
    <div class="card chart-card">
      <div class="card-h">
        <span>{m.stock_chart_value_title()}</span>
        <span class="t-caption hint">{m.stock_chart_value_hint({ days: data.seriesDays })}</span>
      </div>
      <Chart
        options={valueOpts}
        height="var(--stock-chart-h)"
        ariaLabel={m.stock_chart_value_title()}
      />
    </div>
  {:else if id === 'chart-use'}
    <div class="card chart-card">
      <div class="card-h">
        <span>{m.stock_chart_use_title()}</span>
        <span class="t-caption hint">{m.stock_chart_use_hint({ days: data.seriesDays })}</span>
      </div>
      <Chart
        options={useOpts}
        height="var(--stock-chart-h)"
        ariaLabel={m.stock_chart_use_title()}
      />
    </div>
  {:else if id === 'lowstock'}
    <div class="card">
      <div class="card-h">
        <span>{m.stock_low_stock_title()}</span>
        {#if data.lowStock.length}
          <Badge variant="semantic" value="warning" size="sm">{data.lowStock.length}</Badge>
        {:else}
          <Badge variant="neutral" size="sm">0</Badge>
        {/if}
      </div>
      {#if data.lowStock.length === 0}
        <p class="t-caption">{m.stock_low_stock_empty()}</p>
      {:else}
        <DataTable
          ariaLabel={m.stock_low_stock_title()}
          variant="plain"
          data={data.lowStock}
          columns={lowStockColumns}
          getRowId={(r) => r.itemId}
        >
          {#snippet cell(row: LowStockRow, col: DataColumn<LowStockRow>)}
            {#if col.key === 'item'}
              <a href="/stock/items/{row.itemId}" class="hover:underline">{row.itemName}</a>
            {:else if col.key === 'qty'}
              <span class="tabular-nums warn">{fmt(row.qty)}</span>
            {:else if col.key === 'reorder'}
              <span class="tabular-nums">{fmt(row.reorderLevel)}</span>
            {/if}
          {/snippet}
        </DataTable>
      {/if}
    </div>
  {:else if id === 'recent'}
    <div class="card">
      <div class="card-h">{m.stock_recent_title()}</div>
      {#if recentRows.length === 0}
        <p class="t-caption">{m.stock_recent_empty()}</p>
      {:else}
        <p class="t-caption">
          {m.stock_mv_recent_notice()}
          {#if !recentFull}{m.stock_mv_unavailable()}{/if}
        </p>
        <DataTable
          ariaLabel={m.stock_recent_title()}
          variant="plain"
          data={recentRows}
          columns={recentColumns}
          getRowId={(r) => r.ledgerId}
        >
          {#snippet cell(row: RecentRow, col: DataColumn<RecentRow>)}
            {#if col.key === 'qtyDelta'}
              {#if row.qtyDelta === undefined}
                <span class="t-caption">{m.stock_mv_unavailable_value()}</span>
              {:else}
                <span
                  class="tabular-nums"
                  class:delta-in={Number(row.qtyDelta) > 0}
                  class:delta-out={Number(row.qtyDelta) < 0}
                >
                  {Number(row.qtyDelta) > 0 ? '+' : ''}{row.qtyDelta}
                </span>
              {/if}
            {:else if col.key === 'entry'}
              <a href={row.entryHref} class="hover:underline">
                ENT-{row.entryHumanId ?? row.entryId.slice(0, 8)}
              </a>
              {#if recentFull}<span class="t-caption"> · {recentKind(row)}</span>{/if}
            {/if}
          {/snippet}
        </DataTable>
      {/if}
    </div>
  {/if}
{/snippet}

<div class="flex flex-col h-full min-h-0 flex-1 min-w-0">
  <PageHeader documentTitle={false} title={m.nav_stock()} subtitle={m.stock_overview_subtitle()}>
    {#snippet leading()}<Warehouse size={iconSizes.md} class="text-accent shrink-0" />{/snippet}
  </PageHeader>

  <div class="flex-1 min-h-0 overflow-auto p-4">
    <div class="w-full max-w-6xl mx-auto">
      {#if !data.hasData}
        <EmptyState
          icon={Warehouse}
          title={m.stock_empty_title()}
          description={m.stock_empty_body()}
        />
      {:else}
        <EditableGrid
          getItemLabel={(key) =>
            (
              ({
                'chart-value': m.stock_chart_value_title(),
                'chart-use': m.stock_chart_use_title(),
                lowstock: m.stock_low_stock_title(),
                recent: m.stock_recent_title(),
              }) as Record<string, string>
            )[key] ??
            kpis.find((k) => k.id === key)?.label ??
            m.design_card_label({ position: 1 })}
          id="stock-dashboard-v2"
          {items}
          cols={12}
          rowHeight={56}
          canSetDefault={isAdmin.value}
          readonly={!canAct('stock', 'edit')}
        >
          {#snippet cell(id)}{@render cellBody(id)}{/snippet}
        </EditableGrid>
      {/if}
    </div>
  </div>
</div>

<style>
  .kpi {
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    height: 100%;
  }
  .kpi-link {
    text-decoration: none;
    color: inherit;
    transition:
      border-color var(--duration-fast),
      background var(--duration-fast);
    cursor: pointer;
  }
  .kpi-link:hover {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 6%, var(--color-card));
  }
  .kpi-val {
    font-size: var(--font-size-display);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
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
    height: 100%;
    overflow: auto;
  }
  /* Chart height is FIXED, not 100%: the grid cell is 5 rows × 56px and an
     ECharts canvas sized to a percentage of a flex child grows the card
     without bound (seen on QA: the card swallowed the whole page). */
  .chart-card {
    --stock-chart-h: 208px;
    overflow: hidden;
  }
  .hint {
    font-weight: 400;
    text-transform: none;
    letter-spacing: normal;
  }
  .card-h {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    font-size: var(--font-size-body);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-muted-foreground);
    margin-bottom: var(--space-3);
  }
  .warn {
    color: var(--color-warning);
    font-weight: 600;
  }
  .delta-in {
    color: var(--color-success, var(--color-emerald));
  }
  .delta-out {
    color: var(--color-destructive);
  }
</style>
