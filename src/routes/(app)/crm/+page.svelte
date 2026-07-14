<script lang="ts">
  import type { PageData } from './$types';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import {
    LayoutDashboard,
    Users,
    UserPlus,
    Activity,
    TrendingDown,
    Info,
    Flame,
    Wallet,
  } from 'lucide-svelte';
  import { PageHeader, Button } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import StagePill from '$lib/components/crm/StagePill.svelte';
  import CrmFunnelRibbon from '$lib/components/crm/CrmFunnelRibbon.svelte';
  import ChannelBrandIcon from '$lib/components/channels/ChannelBrandIcon.svelte';
  import EditableGrid from '$lib/components/dashboard/EditableGrid.svelte';
  import { isAdmin } from '$lib/state/features/user.svelte';
  import { canAct } from '$lib/access/can.svelte';
  import { temperatureColor, type Temperature } from '$lib/components/crm/crm-format';
  import { funnelStageColor } from '$lib/components/crm/crm-funnel';
  import { stageLabel } from '$lib/components/crm/crm-i18n';

  let { data }: { data: PageData } = $props();
  const s = $derived(data.stats);

  const STAGES = ['New', 'Engaged', 'Active', 'Dormant', 'Churned'];
  const funnelMax = $derived(Math.max(1, ...STAGES.map((st) => s.stageCounts[st] ?? 0)));
  const bucketMax = $derived(Math.max(1, ...s.scoreBuckets));
  const channelTotal = $derived(s.channels.reduce((acc, c) => acc + c.count, 0));

  // ── Click-through to the filtered customer list. Each chart segment links to
  // /crm/customers with the matching filter as a query param (parsed there). ──
  const C = '/crm/customers';
  const stageHref = (st: string) => `${C}?stage=${encodeURIComponent(st)}`;
  const funnelHref = (f: string) => `${C}?funnel=${encodeURIComponent(f)}`;
  const channelHref = (ch: string) => `${C}?channel=${encodeURIComponent(ch)}`;
  const tempHref = (t: string) => `${C}?temp=${encodeURIComponent(t)}`;
  const bucketHref = (i: number) => `${C}?scoreMin=${i * 10}&scoreMax=${i * 10 + 9}`;

  // Per-stage definition tooltips (transparency: "what makes someone Active?").
  const STAGE_HELP: Record<string, string> = {
    New: m.crm_stage_help_New(),
    Engaged: m.crm_stage_help_Engaged(),
    Active: m.crm_stage_help_Active(),
    Dormant: m.crm_stage_help_Dormant(),
    Churned: m.crm_stage_help_Churned(),
  };

  // KPI cards. `href` filters the customer list by the closest lifecycle stage
  // (Total → no filter). Active(7d)/New(30d) are cohort counts, so the stage
  // filter is an approximation of intent, not an exact reproduction of the KPI.
  const kpis = $derived([
    {
      id: 'k-total',
      label: m.crm_dash_total(),
      value: s.total,
      icon: Users,
      help: m.crm_dash_total_help(),
      href: C,
    },
    {
      id: 'k-active',
      label: m.crm_dash_active(),
      value: s.activeWeek,
      icon: Activity,
      help: m.crm_dash_active_help(),
      href: stageHref('Active'),
    },
    {
      id: 'k-new',
      label: m.crm_dash_new(),
      value: s.newCount,
      icon: UserPlus,
      help: m.crm_dash_new_help(),
      href: stageHref('New'),
    },
    {
      id: 'k-churned',
      label: m.crm_dash_churned(),
      value: s.churned,
      icon: TrendingDown,
      help: m.crm_dash_churned_help(),
      href: stageHref('Churned'),
    },
  ]);
  const kpiById = $derived(new Map(kpis.map((k) => [k.id, k])));

  // Engagement-temperature breakdown (hot/warm/cold), computed server-side.
  const tempRows = $derived(
    (['hot', 'warm', 'cold'] as Temperature[]).map((t) => ({
      key: t,
      label: t === 'hot' ? m.crm_temp_hot() : t === 'warm' ? m.crm_temp_warm() : m.crm_temp_cold(),
      count: s.temperature[t],
      color: temperatureColor(t),
    })),
  );
  const tempTotal = $derived(s.temperature.hot + s.temperature.warm + s.temperature.cold);

  // Conversion funnel rows (leads → booked → bought), coloured by funnel stage.
  const convRows = $derived([
    {
      key: 'leads',
      label: m.crm_conv_leads(),
      count: s.conversion.leads,
      color: funnelStageColor('lead'),
      href: funnelHref('lead'),
    },
    {
      key: 'booked',
      label: m.crm_conv_booked(),
      count: s.conversion.booked,
      color: funnelStageColor('opportunity'),
      href: funnelHref('opportunity'),
    },
    {
      key: 'bought',
      label: m.crm_conv_bought(),
      count: s.conversion.bought,
      color: funnelStageColor('customer'),
      href: funnelHref('customer'),
    },
  ]);

  const fmtMoney = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

  // Acquisition-date range filter (server-side cohort scoping).
  const RANGES = [
    { id: 'all', label: () => m.crm_dash_range_all() },
    { id: '7d', label: () => m.crm_dash_range_7d() },
    { id: '30d', label: () => m.crm_dash_range_30d() },
    { id: '90d', label: () => m.crm_dash_range_90d() },
    { id: '365d', label: () => m.crm_dash_range_365d() },
  ];
  function setRange(r: string) {
    const url = new URL(page.url);
    if (r === 'all') url.searchParams.delete('range');
    else url.searchParams.set('range', r);
    url.searchParams.delete('from');
    url.searchParams.delete('to');
    goto(`${url.pathname}${url.search}`, { replaceState: true, keepFocus: true, noScroll: true });
  }

  // Score-bucket bar accent: low scores muted → high scores accent.
  function bucketColor(i: number): string {
    const pct = i / 9;
    return `color-mix(in srgb, var(--color-accent) ${Math.round(25 + pct * 75)}%, var(--color-muted))`;
  }

  // Grid items. KPIs span 1 col / 1 row; the funnel ribbon spans full width;
  // charts span 2 cols / 2 rows. Order + spans are user-editable (persisted).
  // 12-col / 56px grid → fine resize steps (thirds, quarters, half-rows). Default
  // spans reproduce the original 4-up KPIs + 2-up cards layout.
  const items = $derived([
    ...kpis.map((k) => ({ id: k.id, w: 3, h: 2 })),
    { id: 'funnel', w: 12, h: 2 },
    { id: 'stage', w: 6, h: 4 },
    { id: 'score', w: 6, h: 4 },
    { id: 'channels', w: 6, h: 4 },
    { id: 'temp', w: 6, h: 4 },
    ...(s.revenue ? [{ id: 'revenue', w: 6, h: 4 }] : []),
    { id: 'response', w: 6, h: 4 },
    { id: 'conversion', w: 6, h: 4 },
  ]);
</script>

<svelte:head><title>{m.crm_nav_dashboard()} — {m.crm_title()}</title></svelte:head>

<!-- One snippet keyed by item id — EditableGrid renders each cell by id. -->
{#snippet cellBody(id: string)}
  {#if id.startsWith('k-')}
    {@const k = kpiById.get(id)}
    {#if k}
      {@const Icon = k.icon}
      <a class="kpi" href={k.href}>
        <div class="kpi-icon"><Icon size={16} /></div>
        <div class="kpi-val">{k.value.toLocaleString()}</div>
        <div class="kpi-label">
          <span>{k.label}</span>
          <span class="kpi-help" title={k.help}><Info size={12} /></span>
        </div>
      </a>
    {/if}
  {:else if id === 'funnel'}
    <section class="card">
      <header class="card-h">{m.crm_funnel_title()}</header>
      <CrmFunnelRibbon counts={s.funnelCounts} hrefFor={funnelHref} />
    </section>
  {:else if id === 'stage'}
    <section class="card">
      <header class="card-h">{m.crm_dash_stage_funnel()}</header>
      <div class="funnel">
        {#each STAGES as st (st)}
          {@const n = s.stageCounts[st] ?? 0}
          <a
            class="funnel-row"
            href={stageHref(st)}
            title={`${stageLabel(st)} — ${STAGE_HELP[st]}`}
          >
            <span class="funnel-label"><StagePill stage={st} overridden={false} /></span>
            <span class="funnel-bar-wrap">
              <span class="funnel-bar" style:width={`${(n / funnelMax) * 100}%`}></span>
            </span>
            <span class="funnel-n">{n.toLocaleString()}</span>
          </a>
        {/each}
      </div>
    </section>
  {:else if id === 'score'}
    <section class="card">
      <header class="card-h">
        {m.crm_dash_score_dist()}
        <span class="avg">{m.crm_dash_avg_score({ score: s.avgScore })}</span>
      </header>
      <div class="dist">
        {#each s.scoreBuckets as count, i (i)}
          <a class="dist-col" href={bucketHref(i)} title={`${i * 10}–${i * 10 + 9}: ${count}`}>
            <span
              class="dist-bar"
              style:height={`${Math.max(2, (count / bucketMax) * 100)}%`}
              style:background={bucketColor(i)}
            ></span>
          </a>
        {/each}
      </div>
      <div class="dist-axis"><span>0</span><span>50</span><span>100</span></div>
    </section>
  {:else if id === 'channels'}
    <section class="card">
      <header class="card-h">{m.crm_dash_channels()}</header>
      {#if s.channels.length === 0}
        <p class="t-caption py-2">{m.crm_channels_none()}</p>
      {:else}
        <div class="chmix">
          {#each s.channels as c (c.channel)}
            {@const pct = channelTotal ? Math.round((c.count / channelTotal) * 100) : 0}
            <a class="chrow" href={channelHref(c.channel)}>
              <ChannelBrandIcon channel={c.channel} size={16} />
              <span class="ch-name">{c.channel.charAt(0).toUpperCase() + c.channel.slice(1)}</span>
              <span class="ch-bar-wrap"><span class="ch-bar" style:width={`${pct}%`}></span></span>
              <span class="ch-n">{c.count.toLocaleString()}</span>
              <span class="ch-pct">{pct}%</span>
            </a>
          {/each}
        </div>
      {/if}
    </section>
  {:else if id === 'temp'}
    <section class="card">
      <header class="card-h">
        <span class="flex items-center gap-1.5"><Flame size={13} /> {m.crm_dash_temperature()}</span
        >
        <span class="kpi-help" title={m.crm_dash_temperature_help()}><Info size={12} /></span>
      </header>
      <div class="chmix">
        {#each tempRows as t (t.key)}
          {@const pct = tempTotal ? Math.round((t.count / tempTotal) * 100) : 0}
          <a class="chrow" href={tempHref(t.key)}>
            <span class="temp-dot" style:background={t.color}></span>
            <span class="ch-name">{t.label}</span>
            <span class="ch-bar-wrap"
              ><span class="ch-bar" style:width={`${pct}%`} style:background={t.color}></span></span
            >
            <span class="ch-n">{t.count.toLocaleString()}</span>
            <span class="ch-pct">{pct}%</span>
          </a>
        {/each}
      </div>
    </section>
  {:else if id === 'revenue' && s.revenue}
    <section class="card">
      <header class="card-h">
        <span class="flex items-center gap-1.5"
          ><Wallet size={13} /> {m.crm_dash_revenue_title()}</span
        >
      </header>
      <div class="rev-grid">
        <div class="rev-stat">
          <span class="rev-val">{fmtMoney(s.revenue.revenue)}</span>
          <span class="rev-label">{m.crm_rev_total()}</span>
        </div>
        <div class="rev-stat">
          <span class="rev-val">{fmtMoney(s.revenue.avgTicket)}</span>
          <span class="rev-label">{m.crm_rev_avg_ticket()}</span>
        </div>
        <div class="rev-stat">
          <span class="rev-val">{s.revenue.buyers.toLocaleString()}</span>
          <span class="rev-label">{m.crm_rev_buyers()}</span>
        </div>
        <div class="rev-stat">
          <span class="rev-val">{s.revenue.invoices.toLocaleString()}</span>
          <span class="rev-label">{m.crm_rev_invoices()}</span>
        </div>
      </div>
      {#if s.revenue.reserved > 0}
        <a class="rev-cta" href="/crm/customers?reserved=1"
          >{m.crm_dash_reserved_cta({ count: s.revenue.reserved })}</a
        >
      {/if}
    </section>
  {:else if id === 'response'}
    <section class="card">
      <header class="card-h">
        <span>{m.crm_dash_response()}</span>
        <span class="kpi-help" title={m.crm_resp_help()}><Info size={12} /></span>
      </header>
      <div class="rev-grid">
        <div class="rev-stat">
          <span class="rev-val">{s.response.awaiting.toLocaleString()}</span>
          <span class="rev-label">{m.crm_resp_awaiting()}</span>
        </div>
        <div class="rev-stat">
          <span class="rev-val">{s.response.responseRate}%</span>
          <span class="rev-label">{m.crm_resp_rate()}</span>
        </div>
      </div>
      {#if s.response.awaitingByTemp.hot > 0}
        <a class="rev-cta" href="/crm/customers?awaiting=1"
          >{m.crm_resp_hot_awaiting({ count: s.response.awaitingByTemp.hot })}</a
        >
      {/if}
    </section>
  {:else if id === 'conversion'}
    <section class="card">
      <header class="card-h">
        <span>{m.crm_dash_conversion()}</span>
        <span class="kpi-help" title={m.crm_dash_conversion_help()}><Info size={12} /></span>
      </header>
      <div class="chmix">
        {#each convRows as r (r.key)}
          {@const pct = s.conversion.leads ? Math.round((r.count / s.conversion.leads) * 100) : 0}
          <a class="chrow" href={r.href}>
            <span class="temp-dot" style:background={r.color}></span>
            <span class="ch-name">{r.label}</span>
            <span class="ch-bar-wrap"
              ><span class="ch-bar" style:width={`${pct}%`} style:background={r.color}></span></span
            >
            <span class="ch-n">{r.count.toLocaleString()}</span>
            <span class="ch-pct">{pct}%</span>
          </a>
        {/each}
      </div>
    </section>
  {/if}
{/snippet}

<PageShell
  archetype="dashboard"
  scroll="region"
  labelledBy="crm-dashboard-title"
  class="crm-dashboard-surface"
>
  <PageHeader
    titleId="crm-dashboard-title"
    title={m.crm_nav_dashboard()}
    subtitle={m.crm_subtitle()}
  >
    {#snippet leading()}
      <LayoutDashboard size={16} class="text-accent shrink-0" />
    {/snippet}
  </PageHeader>

  <!-- Full-width scroller so the scrollbar hugs the screen edge; content padded. -->
  <PageBody padding="compact" scroll="region">
    <EditableGrid
      id="crm-dashboard-v2"
      {items}
      cols={12}
      rowHeight={56}
      canSetDefault={isAdmin.value}
      readonly={!canAct('crm', 'edit')}
    >
      <!-- Date-range cohort filter, inline with the Edit-layout button. -->
      {#snippet toolbar()}
        <div class="seg" role="group" title={m.crm_dash_range_hint()}>
          {#each RANGES as r (r.id)}
            <Button
              variant="ghost"
              size="sm"
              class={`seg-btn ${s.range === r.id ? 'active' : ''}`}
              aria-pressed={s.range === r.id}
              onclick={() => setRange(r.id)}>{r.label()}</Button
            >
          {/each}
        </div>
        <span class="t-caption">{m.crm_dash_range_hint()}</span>
      {/snippet}
      {#snippet cell(id)}{@render cellBody(id)}{/snippet}
    </EditableGrid>
  </PageBody>
</PageShell>

<style>
  .kpi {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 4px);
    padding: var(--space-3, 12px) var(--space-4, 16px);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    position: relative;
    text-decoration: none;
    color: inherit;
    transition: border-color var(--duration-fast) var(--ease-standard);
  }
  .kpi:hover {
    border-color: color-mix(in srgb, var(--color-accent) 50%, var(--hairline));
  }
  .kpi-icon {
    position: absolute;
    top: 0.85rem;
    right: 0.9rem;
    color: var(--color-muted-foreground);
    opacity: 0.6;
  }
  .kpi-val {
    font-size: var(--font-size-display, 28px);
    font-weight: 700;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }
  .kpi-label {
    display: flex;
    align-items: center;
    gap: var(--space-1, 4px);
    font-size: var(--font-size-caption, 12px);
    color: var(--color-muted-foreground);
  }
  .kpi-help {
    display: inline-flex;
    color: var(--color-muted-foreground);
    opacity: 0.5;
    cursor: help;
    transition: opacity var(--duration-fast) var(--ease-standard);
  }
  .kpi-help:hover {
    opacity: 1;
  }
  .card {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    padding: var(--space-3, 12px) var(--space-4, 16px);
  }
  .card-h {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    font-size: var(--font-size-caption, 12px);
    font-weight: 600;
    color: var(--color-muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-bottom: var(--space-3, 12px);
  }
  .avg {
    font-size: var(--font-size-caption, 12px);
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
    color: var(--color-accent);
  }

  /* funnel */
  .funnel {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
  }
  .funnel-row {
    display: grid;
    grid-template-columns: 5.5rem 1fr auto;
    align-items: center;
    gap: var(--space-2, 8px);
    width: 100%;
    text-align: left;
    text-decoration: none;
    color: inherit;
  }
  .funnel-label {
    display: inline-flex;
  }
  .funnel-bar-wrap {
    height: 0.6rem;
    border-radius: var(--radius-full);
    background: var(--color-bg3);
    overflow: hidden;
  }
  .funnel-bar {
    display: block;
    height: 100%;
    border-radius: var(--radius-full);
    background: var(--color-accent);
    transition: width var(--duration-fast) var(--ease-standard);
  }
  .funnel-n {
    font-size: var(--font-size-body, 14px);
    font-variant-numeric: tabular-nums;
    min-width: 2.5rem;
    text-align: right;
  }
  .funnel-row:hover .funnel-bar {
    filter: brightness(1.15);
  }

  /* score distribution */
  .dist {
    display: flex;
    align-items: flex-end;
    gap: var(--space-1, 4px);
    height: 7rem;
  }
  .dist-col {
    flex: 1;
    display: flex;
    align-items: flex-end;
    height: 100%;
  }
  .dist-bar {
    width: 100%;
    border-radius: var(--radius-sm, var(--radius-sm) var(--radius-sm, var(--radius-sm) 0 0;
    transition: height var(--duration-fast) var(--ease-standard);
  }
  .dist-col:hover .dist-bar {
    filter: brightness(1.2);
  }
  .dist-axis {
    display: flex;
    justify-content: space-between;
    font-size: var(--font-size-caption, 12px);
    color: var(--color-muted-foreground);
    margin-top: var(--space-2, 8px);
  }

  /* channel mix */
  .chmix {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
  }
  .chrow {
    display: grid;
    grid-template-columns: auto 5rem 1fr auto auto;
    align-items: center;
    gap: var(--space-2, 8px);
    font-size: var(--font-size-body, 14px);
    text-decoration: none;
    color: inherit;
  }
  .chrow:hover .ch-bar {
    filter: brightness(1.2);
  }
  .ch-name {
    font-weight: 500;
  }
  .ch-bar-wrap {
    height: 0.55rem;
    border-radius: var(--radius-full);
    background: var(--color-bg3);
    overflow: hidden;
  }
  .ch-bar {
    display: block;
    height: 100%;
    border-radius: var(--radius-full);
    background: var(--color-accent);
  }
  .ch-n {
    font-variant-numeric: tabular-nums;
    text-align: right;
    min-width: 2.5rem;
  }
  .ch-pct {
    font-variant-numeric: tabular-nums;
    color: var(--color-muted-foreground);
    min-width: 2.5rem;
    text-align: right;
  }

  /* date-range segmented control */
  .seg {
    display: inline-flex;
    gap: var(--space-1, 4px);
    padding: var(--space-1, 4px);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    background: var(--color-card);
  }
  :global(.crm-dashboard-surface .seg-btn) {
    padding: var(--space-1, 4px) var(--space-3, 12px);
    border-radius: var(--radius-sm, var(--radius-md);
    font-size: var(--font-size-caption, 12px);
    font-weight: 500;
    color: var(--color-muted-foreground);
    font-variant-numeric: tabular-nums;
    transition:
      color var(--duration-fast) var(--ease-standard),
      background-color var(--duration-fast) var(--ease-standard);
  }
  :global(.crm-dashboard-surface .seg-btn:hover) {
    color: var(--color-foreground);
  }
  :global(.crm-dashboard-surface .seg-btn.active) {
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 14%, transparent);
    font-weight: 600;
  }

  /* temperature breakdown (reuses .chmix/.chrow grid) */
  .temp-dot {
    width: 0.7rem;
    height: 0.7rem;
    border-radius: var(--radius-full);
  }

  /* revenue summary */
  .rev-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-3, 12px) var(--space-4, 16px);
  }
  .rev-stat {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5, 2px);
  }
  .rev-val {
    font-size: var(--font-size-display, 28px);
    font-weight: 700;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }
  .rev-label {
    font-size: var(--font-size-caption, 12px);
    color: var(--color-muted-foreground);
  }
  .rev-cta {
    display: inline-block;
    margin-top: var(--space-3, 12px);
    font-size: var(--font-size-caption, 12px);
    font-weight: 600;
    color: var(--color-warning);
    text-decoration: none;
  }
  .rev-cta:hover {
    text-decoration: underline;
  }
</style>
