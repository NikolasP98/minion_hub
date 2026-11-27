<script lang="ts">
  import type { PageData as LoadedPageData } from './$types';
  import type { Granted } from '$lib/permissions';
  import { Funnel, Mail, Phone } from 'lucide-svelte';
  import ChannelBrandIcon from '$lib/components/channels/ChannelBrandIcon.svelte';
  import * as m from '$lib/paraglide/messages';
  import { goto } from '$lib/navigation';
  import { PageHeader, Badge, MathFormula, Tooltip, iconSizes } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import { applyFilters } from '$lib/components/data-table/apply-filters';
  import type { FilterGroup, FilterValue } from '$lib/components/data-table/filters';
  import DateRangeControls from '$lib/components/dashboard/DateRangeControls.svelte';
  import { formatDate, formatMoney, formatNumber } from '$lib/utils/format';
  import {
    REACH_KINDS,
    funnelMetrics,
    reachTotals,
    reachability,
    stageRates,
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

  // Customer list: loaded once; the table's own filter builder (property + And/Or
  // groups) does the filtering. The totals line follows the same filters.
  let tableFilters = $state<Record<string, FilterValue>>({});
  let tableAdvanced = $state<FilterGroup | null>(null);

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
    {
      key: 'name',
      label: m.pos_funnel_col_customer(),
      accessor: (r) => r.name,
      filter: { kind: 'text' },
    },
    {
      key: 'spend',
      money: true,
      label: m.pos_funnel_col_spend(),
      align: 'right',
      custom: true,
      accessor: (r) => r.spend,
      filter: { kind: 'number' },
    },
    {
      key: 'count',
      label: m.pos_funnel_col_purchases(),
      align: 'right',
      accessor: (r) => r.count,
      filter: { kind: 'number' },
    },
    {
      key: 'lastAt',
      label: m.pos_funnel_col_last(),
      custom: true,
      accessor: (r) => r.lastAt,
      filter: { kind: 'date' },
    },
    {
      key: 'tier',
      label: m.pos_funnel_col_tier(),
      accessor: (r) => tierLabel(r.tier),
      filter: {
        options: () => ([1, 2, 3] as const).map((t) => ({ value: String(t), label: tierLabel(t) })),
        match: (r) => String(r.tier),
      },
    },
    {
      key: 'reach',
      label: m.pos_funnel_col_reach(),
      custom: true,
      sortable: false,
      accessor: (r) => reachability(r).map(reachLabel).join(', '),
      // One multi-value property: "is Instagram", "is not WhatsApp", "is empty" = not reachable.
      filter: {
        icon: true,
        options: () => REACH_KINDS.map((k) => ({ value: k, label: reachLabel(k) })),
        match: (r) => reachability(r),
      },
    },
  ]);

  function matchOf(key: string): ((row: unknown) => unknown) | null {
    const col = columns.find((c) => c.key === key);
    if (!col?.filter) return null;
    const fn = col.filter.match ?? col.accessor;
    return fn ? (row: unknown) => fn(row as CustomerRow) : null;
  }
  const totals = $derived(
    reachTotals(applyFilters(data.customers, tableFilters, tableAdvanced, matchOf)),
  );

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
  const times = (v: number | null) =>
    v === null
      ? none
      : `${formatNumber(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×`;
  const pct = (v: number | null) =>
    v === null
      ? none
      : formatNumber(v, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const int = (v: number) => formatNumber(Math.round(v));

  // Each tile carries its formula twice for the tooltip, like the CRM score:
  // once with the terms named, once with the real values substituted.
  const txt = (v: string) => `\\text{${v.replace(/([%$#&_{}])/g, '\\$1')}}`;
  const frac = (n: string, d: string) => `\\dfrac{${txt(n)}}{${txt(d)}}`;
  // The card already names the metric, so the first line is only the named fraction:
  // with the name in front, long Spanish labels shrank the formula to fit.
  const calc = (terms: [string, string], values: [string, string], out: string) => ({
    sym: frac(...terms),
    val: `${frac(...values)} = ${txt(out)}`,
  });
  const tiles = $derived(
    [
      {
        id: 'cac',
        label: m.pos_funnel_metric_cac(),
        value: money(metrics.cac),
        terms: [m.pos_funnel_stage_spend(), m.pos_funnel_stage_first()],
        values: [formatMoney(f.spend), int(f.firstTime)],
      },
      {
        id: 'ltv',
        label: m.pos_funnel_metric_ltv(),
        value: money(metrics.ltv),
        terms: [m.pos_funnel_term_lifetime_sales(), m.pos_funnel_term_customers()],
        values: [formatMoney(f.lifetimeTotal), int(f.customers)],
      },
      {
        id: 'ltv-cac',
        label: m.pos_funnel_metric_ltv_cac(),
        value: times(metrics.ltvCac),
        terms: [m.pos_funnel_metric_ltv(), m.pos_funnel_metric_cac()],
        values: [money(metrics.ltv), money(metrics.cac)],
      },
      {
        id: 'roas',
        label: m.pos_funnel_metric_roas(),
        value: times(metrics.roas),
        terms: [m.pos_funnel_term_range_sales(), m.pos_funnel_stage_spend()],
        values: [formatMoney(f.revenue), formatMoney(f.spend)],
      },
      {
        id: 'ticket',
        label: m.pos_funnel_metric_ticket(),
        value: money(metrics.avgTicket),
        terms: [m.pos_funnel_term_range_sales(), m.pos_funnel_term_sales_count()],
        values: [formatMoney(f.revenue), int(f.sales)],
      },
      {
        id: 'repeat',
        label: m.pos_funnel_metric_repeat(),
        value: pct(metrics.repeatRate),
        terms: [m.pos_funnel_term_repeat_customers(), m.pos_funnel_term_customers()],
        values: [int(f.repeatCustomers), int(f.customers)],
      },
    ].map((t) => ({
      ...t,
      ...calc(t.terms as [string, string], t.values as [string, string], t.value),
    })),
  );

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

{#snippet channelIcon(k: string)}
  {#if k === 'phone'}<Phone size={iconSizes.sm} />
  {:else if k === 'email'}<Mail size={iconSizes.sm} />
  {:else}<ChannelBrandIcon channel={k} size={iconSizes.sm} />{/if}
{/snippet}
{#snippet reachCell(r: CustomerRow)}
  <span class="channels">
    {#each reachability(r) as k (k)}
      <span title={reachLabel(k)} aria-label={reachLabel(k)}>{@render channelIcon(k)}</span>
    {:else}—{/each}
  </span>
{/snippet}
{#snippet formula(sym: string, val: string)}
  <span class="calc">
    <MathFormula tex={sym} />
    <MathFormula tex={val} class="calc-values" />
  </span>
{/snippet}
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
            <Tooltip asChild>
              {#snippet content()}{@render formula(tile.sym, tile.val)}{/snippet}
              {#snippet children(tip)}
                <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                <div class="tile" tabindex="0" {...tip}>
                  <span class="t-display">{tile.value}</span>
                  <span class="t-caption">{tile.label}</span>
                </div>
              {/snippet}
            </Tooltip>
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
                <Tooltip>
                  {#snippet content()}
                    {@render formula(
                      frac(s.label, countStages[i - 1].label),
                      `${frac(int(s.n), int(countStages[i - 1].n))} = ${txt(pct(rates[i] ?? null))}`,
                    )}
                  {/snippet}
                  <span class="t-caption">{pct(rates[i] ?? null)}</span>
                </Tooltip>
              {/if}
            </li>
          {/each}
        </ol>
        <p class="t-caption">{m.pos_funnel_stages_note()}</p>
      </section>

      <section class="stack" aria-labelledby="funnel-customers">
        <h2 id="funnel-customers" class="t-title">{m.pos_funnel_customers_title()}</h2>
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
          ariaLabel={m.pos_funnel_customers_title()}
          variant="plain"
          {columns}
          cells={{
            spend: spendCell,
            lastAt: lastAtCell,
            reach: reachCell,
          }}
          data={data.customers}
          filterBar
          filterChips
          bind:filters={tableFilters}
          bind:advanced={tableAdvanced}
          filterOptionIcon={channelIcon}
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
  .calc {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: 15rem;
    padding: var(--space-1) 0;
  }
  .calc :global(.calc-values) {
    color: var(--color-text-secondary);
  }
  .channels {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
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
</style>
