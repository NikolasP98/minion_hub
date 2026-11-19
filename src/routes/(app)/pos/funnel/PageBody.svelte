<script lang="ts">
  import type { PageData as LoadedPageData } from './$types';
  import type { Granted } from '$lib/permissions';
  import { Funnel } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { goto } from '$lib/navigation';
  import { PageHeader, Badge, iconSizes } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import SegmentedControl from '$lib/components/ui/SegmentedControl.svelte';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import DateRangeControls from '$lib/components/dashboard/DateRangeControls.svelte';
  import { appLocale, formatDate, formatMoney } from '$lib/utils/format';
  import {
    filterCustomers,
    funnelMetrics,
    reachTotals,
    reachability,
    stageRates,
    type CustomerFilter,
    type CustomerRow,
    type ReachKind,
  } from '$lib/pos/funnel-logic';

  type PageData = Granted<LoadedPageData['pos']>;
  let { data }: { data: PageData } = $props();

  // svelte-ignore state_referenced_locally
  let fromDate = $state(data.range.from);
  // svelte-ignore state_referenced_locally
  let toDate = $state(data.range.to);
  function onRangeChange(v: { from: string; to: string }) {
    fromDate = v.from;
    toDate = v.to;
    const p = new URLSearchParams();
    if (v.from) p.set('from', v.from);
    if (v.to) p.set('to', v.to);
    goto(`/pos/funnel?${p}`, { keepFocus: true, noScroll: true });
  }

  // Customer list: loaded once, filtered client-side.
  let reach = $state<CustomerFilter['reach']>('any');
  let tier = $state<string>('all');
  const filter = $derived<CustomerFilter>({
    reach,
    tier: tier === 'all' ? 'all' : (Number(tier) as 1 | 2 | 3),
  });
  const rows = $derived(filterCustomers(data.customers, filter));
  const totals = $derived(reachTotals(rows));

  const reachLabel = (k: ReachKind) =>
    ({
      phone: m.pos_funnel_reach_phone(),
      email: m.pos_funnel_reach_email(),
      whatsapp: m.pos_funnel_reach_whatsapp(),
      instagram: m.pos_funnel_reach_instagram(),
    })[k];
  const tierLabel = (t: 1 | 2 | 3) =>
    ({ 1: m.pos_funnel_tier_top(), 2: m.pos_funnel_tier_mid(), 3: m.pos_funnel_tier_bottom() })[t];

  const columns = $derived<DataColumn<CustomerRow>[]>([
    { key: 'name', label: m.pos_funnel_col_customer(), accessor: (r) => r.name },
    {
      key: 'spend',
      money: true,
      label: m.pos_funnel_col_spend(),
      align: 'right',
      custom: true,
      accessor: (r) => r.spend,
    },
    { key: 'count', label: m.pos_funnel_col_purchases(), align: 'right', accessor: (r) => r.count },
    { key: 'lastAt', label: m.pos_funnel_col_last(), custom: true, accessor: (r) => r.lastAt },
    { key: 'tier', label: m.pos_funnel_col_tier(), accessor: (r) => tierLabel(r.tier) },
    {
      key: 'reach',
      label: m.pos_funnel_col_reach(),
      accessor: (r) => {
        const kinds = reachability(r);
        return kinds.length ? kinds.map(reachLabel).join(', ') : m.pos_funnel_reach_none();
      },
    },
  ]);

  // Metrics + stages.
  const f = $derived(data.funnel);
  const metrics = $derived(
    funnelMetrics({
      spend: f.spend,
      firstTime: f.firstTime,
      customers: f.customers,
      lifetimeTotal: f.lifetimeTotal,
      repeatCustomers: f.repeatCustomers,
      revenue: f.revenue,
      sales: f.sales,
    }),
  );
  const none = $derived(m.pos_funnel_no_data());
  const money = (v: number | null) => (v === null ? none : formatMoney(v));
  const times = (v: number | null) => (v === null ? none : `${v.toFixed(1)}×`);
  const pct = (v: number | null) => (v === null ? none : `${(v * 100).toFixed(1)}%`);
  const int = (v: number) => Math.round(v).toLocaleString(appLocale());

  const tiles = $derived([
    { id: 'cac', label: m.pos_funnel_metric_cac(), value: money(metrics.cac) },
    { id: 'ltv', label: m.pos_funnel_metric_ltv(), value: money(metrics.ltv) },
    { id: 'ltv-cac', label: m.pos_funnel_metric_ltv_cac(), value: times(metrics.ltvCac) },
    { id: 'roas', label: m.pos_funnel_metric_roas(), value: times(metrics.roas) },
    { id: 'ticket', label: m.pos_funnel_metric_ticket(), value: money(metrics.avgTicket) },
    { id: 'repeat', label: m.pos_funnel_metric_repeat(), value: pct(metrics.repeatRate) },
  ]);

  // Spend is money, not a count: it starts the funnel but has no rate to impressions.
  const countStages = $derived([
    { id: 'impressions', label: m.pos_funnel_stage_impressions(), n: f.impressions },
    { id: 'clicks', label: m.pos_funnel_stage_clicks(), n: f.clicks },
    { id: 'conversations', label: m.pos_funnel_stage_conversations(), n: f.conversations },
    { id: 'leads', label: m.pos_funnel_stage_leads(), n: f.leads },
    { id: 'first', label: m.pos_funnel_stage_first(), n: f.firstTime },
    { id: 'repeat', label: m.pos_funnel_stage_repeat(), n: f.repeatInRange },
  ]);
  // Repeat customers are not a subset of first-time ones, so that pair has no rate.
  const rates = $derived(
    stageRates(countStages.map((s) => s.n)).map((r, i) =>
      countStages[i].id === 'repeat' ? undefined : r,
    ),
  );
  const adEndsEarly = $derived(f.adLastDate !== null && f.adLastDate < data.range.to);
</script>

{#snippet spendCell(r: CustomerRow)}
  <span class="tabular-nums">{formatMoney(r.spend)}</span>
{/snippet}
{#snippet lastAtCell(r: CustomerRow)}
  <!-- lastAt is an org-local day; noon keeps it on that day in any browser zone -->
  {formatDate(`${r.lastAt}T12:00:00`, { dateStyle: 'medium' })}
{/snippet}

<PageShell archetype="collection" scroll="page" labelledBy="pos-funnel-title">
  <PageHeader
    titleId="pos-funnel-title"
    title={m.pos_funnel_title()}
    subtitle={m.pos_funnel_subtitle()}
  >
    {#snippet leading()}<Funnel size={iconSizes.md} class="text-accent shrink-0" />{/snippet}
  </PageHeader>

  <PageBody padding="compact">
    <div class="stack">
      <DateRangeControls
        from={fromDate}
        to={toDate}
        periods={[]}
        dataMax={f.adLastDate ?? ''}
        timeZone={data.timeZone}
        storageKey="pos-funnel"
        onChange={onRangeChange}
      />
      {#if adEndsEarly}
        <p class="t-caption">{m.pos_funnel_ad_ends({ date: f.adLastDate ?? '' })}</p>
      {/if}

      <section class="stack" aria-labelledby="funnel-metrics">
        <h2 id="funnel-metrics" class="t-title">{m.pos_funnel_metrics_title()}</h2>
        <div class="tiles">
          {#each tiles as tile (tile.id)}
            <div class="tile">
              <span class="t-display">{tile.value}</span>
              <span class="t-caption">{tile.label}</span>
            </div>
          {/each}
        </div>
      </section>

      <section class="stack" aria-labelledby="funnel-stages">
        <h2 id="funnel-stages" class="t-title">{m.pos_funnel_stages_title()}</h2>
        <ol class="stages">
          <li class="stage">
            <span class="t-label">{m.pos_funnel_stage_spend()}</span>
            <span class="t-body">{formatMoney(f.spend)}</span>
          </li>
          {#each countStages as s, i (s.id)}
            <li class="stage">
              <span class="t-label">
                {s.label}
                {#if s.id === 'leads'}<Badge>{m.pos_funnel_estimate()}</Badge>{/if}
              </span>
              <span class="t-body">{int(s.n)}</span>
              {#if i > 0 && rates[i] !== undefined}
                <span class="t-caption">{pct(rates[i] ?? null)}</span>
              {/if}
            </li>
          {/each}
        </ol>
        <p class="t-caption">{m.pos_funnel_stages_note()}</p>
      </section>

      <section class="stack" aria-labelledby="funnel-customers">
        <h2 id="funnel-customers" class="t-title">{m.pos_funnel_customers_title()}</h2>
        <div class="filters">
          <span class="t-label">{m.pos_funnel_filter_reach()}</span>
          <SegmentedControl
            aria-label={m.pos_funnel_filter_reach()}
            bind:value={reach}
            items={[
              { value: 'any', label: m.pos_funnel_reach_any() },
              { value: 'phone', label: m.pos_funnel_reach_phone() },
              { value: 'email', label: m.pos_funnel_reach_email() },
              { value: 'whatsapp', label: m.pos_funnel_reach_whatsapp() },
              { value: 'instagram', label: m.pos_funnel_reach_instagram() },
              { value: 'none', label: m.pos_funnel_reach_none() },
            ]}
          />
          <span class="t-label">{m.pos_funnel_filter_tier()}</span>
          <SegmentedControl
            aria-label={m.pos_funnel_filter_tier()}
            bind:value={tier}
            items={[
              { value: 'all', label: m.pos_funnel_tier_all() },
              { value: '1', label: m.pos_funnel_tier_top() },
              { value: '2', label: m.pos_funnel_tier_mid() },
              { value: '3', label: m.pos_funnel_tier_bottom() },
            ]}
          />
        </div>
        <p class="t-caption">
          {m.pos_funnel_customers_summary({
            customers: int(totals.customers),
            reachable: int(totals.reachable),
            notReachable: int(totals.notReachable),
          })}
          · {m.pos_funnel_reach_phone()}
          {int(totals.phone)} · {m.pos_funnel_reach_email()}
          {int(totals.email)} · {m.pos_funnel_reach_whatsapp()}
          {int(totals.whatsapp)} · {m.pos_funnel_reach_instagram()}
          {int(totals.instagram)}
        </p>
        <DataTable
          variant="plain"
          {columns}
          cells={{ spend: spendCell, lastAt: lastAtCell }}
          data={rows}
          getRowId={(r) => r.partyId}
          searchPlaceholder={m.data_table_search()}
          searchFields={(r) => r.name}
          storageKey="pos-funnel-customers"
          canEdit={false}
          emptyMessage={m.pos_funnel_customers_empty()}
        />
      </section>
    </div>
  </PageBody>
</PageShell>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: var(--space-3);
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-card);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
  }
  .stages {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: var(--space-3);
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .stage {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-card-compact);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
</style>
