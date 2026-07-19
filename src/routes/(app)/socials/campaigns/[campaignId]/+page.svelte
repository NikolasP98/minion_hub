<script lang="ts">
  import { goto } from '$lib/navigation';
  import type { PageData } from './$types';
  import * as m from '$lib/paraglide/messages';
  import { formatMoney, formatMoneyShort } from '$lib/utils/format';
  import { ArrowLeft, Target, Image } from 'lucide-svelte';
  import { PageHeader, Button } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import { createBackNav } from '$lib/nav/back-nav.svelte';
  import DataTable from '$lib/components/data-table/DataTable.svelte';
  import type { DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import Chart from '$lib/components/charts/Chart.svelte';
  import { chartColors } from '$lib/utils/chart-colors';
  import type { EChartsOption } from 'echarts';

  let { data }: { data: PageData } = $props();
  const back = createBackNav('/socials/campaigns', m.ads_nav_campaigns);
  const campaign = $derived(data.campaign);
  type AdRow = (typeof campaign.ads)[number];

  const c = $derived(chartColors());

  // Ad spend carries the AD ACCOUNT's currency (PEN or USD), not the org default.
  const adCurrency = $derived(data.currency ?? 'PEN');
  function fmtMoney(v: number): string {
    return formatMoney(v, adCurrency);
  }
  function fmtInt(v: number): string {
    return Math.round(v).toLocaleString();
  }

  const kpis = $derived([
    { id: 'spend', label: m.ads_kpi_spend(), value: fmtMoney(campaign.totals.spend) },
    {
      id: 'impressions',
      label: m.ads_kpi_impressions(),
      value: fmtInt(campaign.totals.impressions),
    },
    { id: 'reach', label: m.ads_kpi_reach(), value: fmtInt(campaign.totals.reach) },
    { id: 'clicks', label: m.ads_kpi_clicks(), value: fmtInt(campaign.totals.clicks) },
    { id: 'ctr', label: m.ads_kpi_ctr(), value: `${campaign.totals.ctr.toFixed(2)}%` },
    { id: 'cpc', label: m.ads_kpi_cpc(), value: fmtMoney(campaign.totals.cpc) },
  ]);

  const spendOpts = $derived({
    grid: { left: 8, right: 18, top: 16, bottom: 30, containLabel: true },
    tooltip: { trigger: 'axis', valueFormatter: (v) => fmtMoney(Number(v)) },
    xAxis: {
      type: 'category',
      data: campaign.spendSeries.map((r) => r.date),
      axisLabel: { hideOverlap: true },
    },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => formatMoneyShort(v, adCurrency) } },
    series: [
      {
        name: m.ads_kpi_spend(),
        type: 'line',
        areaStyle: { color: c.info, opacity: 0.25 },
        lineStyle: { color: c.info },
        itemStyle: { color: c.info },
        smooth: true,
        data: campaign.spendSeries.map((r) => Math.round(r.spend * 100) / 100),
      },
    ],
  } satisfies EChartsOption);

  function adRowClick(r: AdRow) {
    if (r.postId) goto(`/socials/posts/${encodeURIComponent(r.postId)}`);
  }

  const adColumns: DataColumn<AdRow>[] = [
    {
      key: 'preview',
      label: m.ads_col_thumbnail(),
      custom: true,
      sortable: false,
      exportable: false,
      align: 'center',
      width: 56,
    },
    {
      key: 'name',
      label: m.ads_col_ad(),
      custom: true,
      accessor: (r) => r.adName ?? '—',
      exportValue: (r) => r.adName ?? '',
      sortFn: (a, b) => (a.adName ?? '').localeCompare(b.adName ?? ''),
      width: 260,
    },
    {
      key: 'spend',
      money: true,
      label: m.ads_col_spend(),
      align: 'right',
      numeric: true,
      custom: true,
      accessor: (r) => r.spend,
      sortFn: (a, b) => a.spend - b.spend,
      width: 120,
    },
    {
      key: 'impressions',
      label: m.ads_col_impressions(),
      align: 'right',
      numeric: true,
      custom: true,
      accessor: (r) => r.impressions,
      sortFn: (a, b) => a.impressions - b.impressions,
      width: 120,
    },
    {
      key: 'clicks',
      label: m.ads_col_clicks(),
      align: 'right',
      numeric: true,
      custom: true,
      accessor: (r) => r.clicks,
      sortFn: (a, b) => a.clicks - b.clicks,
      width: 100,
    },
    {
      key: 'ctr',
      label: m.ads_col_ctr(),
      align: 'right',
      numeric: true,
      custom: true,
      accessor: (r) => r.ctr,
      sortFn: (a, b) => a.ctr - b.ctr,
      width: 90,
    },
    {
      key: 'cpc',
      money: true,
      label: m.ads_col_cpc(),
      align: 'right',
      numeric: true,
      custom: true,
      accessor: (r) => r.cpc,
      sortFn: (a, b) => a.cpc - b.cpc,
      width: 100,
    },
  ];
</script>

<svelte:head
  ><title>{campaign.campaignName ?? m.ads_nav_campaigns()} · {m.nav_ads()}</title></svelte:head
>

<PageShell
  archetype="record-detail"
  scroll="region"
  labelledBy="socials-campaigns-campaignId-title"
>
  <PageHeader
    titleId="socials-campaigns-campaignId-title"
    title={campaign.campaignName ?? m.ads_nav_campaigns()}
    subtitle={m.ads_campaign_detail_subtitle()}
  >
    {#snippet leading()}<Target size={16} class="text-accent shrink-0" />{/snippet}
  </PageHeader>

  <PageBody padding="compact" scroll="region" class="flex flex-col gap-3">
    <Button variant="outline" size="sm" onclick={back.go} class="self-start">
      <ArrowLeft size={14} />
      {back.label}
    </Button>

    <div class="kpi-grid">
      {#each kpis as k (k.id)}
        <div class="kpi">
          <div class="kpi-val">{k.value}</div>
          <div class="kpi-label">{k.label}</div>
        </div>
      {/each}
    </div>

    <div class="card">
      <div class="card-h">{m.ads_chart_spend_title()}</div>
      <Chart options={spendOpts} height="240px" />
    </div>

    <div class="card">
      <div class="card-h">{m.ads_campaign_detail_ads_title()}</div>
      <DataTable
        class="ads-table"
        columns={adColumns}
        data={campaign.ads}
        getRowId={(r) => r.adId}
        searchable={false}
        storageKey="ads-campaign-detail-ads"
        emptyMessage={m.ads_empty_campaigns_desc()}
        onRowClick={adRowClick}
      >
        {#snippet cell(r: AdRow, col: DataColumn<AdRow>)}
          {#if col.key === 'preview'}
            {#if r.thumbFileId}
              <img
                src="/api/files/{r.thumbFileId}/raw"
                loading="lazy"
                alt=""
                width="40"
                height="40"
                class="row-thumb"
              />
            {:else}
              <div class="row-thumb row-thumb-placeholder" aria-hidden="true">
                <Image size={16} />
              </div>
            {/if}
          {:else if col.key === 'name'}
            <span class="truncate block">{r.adName ?? '—'}</span>
          {:else if col.key === 'spend'}
            <span class="tabular-nums">{fmtMoney(r.spend)}</span>
          {:else if col.key === 'impressions'}
            <span class="tabular-nums">{fmtInt(r.impressions)}</span>
          {:else if col.key === 'clicks'}
            <span class="tabular-nums">{fmtInt(r.clicks)}</span>
          {:else if col.key === 'ctr'}
            <span class="tabular-nums">{r.ctr.toFixed(2)}%</span>
          {:else if col.key === 'cpc'}
            <span class="tabular-nums">{fmtMoney(r.cpc)}</span>
          {/if}
        {/snippet}
      </DataTable>
    </div>
  </PageBody>
</PageShell>

<style>
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: var(--space-3, 12px);
  }
  .kpi {
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: var(--space-4, 16px) var(--space-4, 16px);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
  }
  .kpi-val {
    font-size: var(--font-size-display, 28px);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .kpi-label {
    font-size: var(--font-size-caption, 12px);
    color: var(--color-muted-foreground);
    margin-top: var(--space-0-5, 2px);
  }
  .card {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    padding: var(--space-4, 16px) var(--space-4, 16px);
  }
  .card-h {
    font-size: var(--font-size-body, 14px);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-muted-foreground);
    margin-bottom: var(--space-3, 12px);
  }
  :global(.ads-table) {
    height: 24rem;
  }
  .row-thumb {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-lg);
    object-fit: cover;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .row-thumb-placeholder {
    background: color-mix(in srgb, var(--color-muted-foreground) 15%, transparent);
    color: var(--color-muted-foreground);
  }
</style>
