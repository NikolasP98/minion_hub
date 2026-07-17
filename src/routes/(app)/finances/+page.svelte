<script lang="ts">
  import { goto } from '$lib/navigation';
  import type { PageData } from './$types';
  import * as m from '$lib/paraglide/messages';
  import { Wallet } from 'lucide-svelte';
  import { PageHeader, Button, Skeleton, EmptyState } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import Chart from '$lib/components/charts/Chart.svelte';
  import EditableGrid from '$lib/components/dashboard/EditableGrid.svelte';
  import { isAdmin } from '$lib/state/features/user.svelte';
  import { canAct } from '$lib/access/can.svelte';
  import { chartColors } from '$lib/utils/chart-colors';
  import { locale } from '$lib/state/ui/locale.svelte';
  import type { EChartsOption } from 'echarts';

  let { data }: { data: PageData } = $props();

  // Theme-resolved colors (ECharts can't read CSS var() in series colors).
  const c = $derived(chartColors());

  // Localized bucket label: month → "MMM yyyy", day/week → "dd MMM yyyy".
  // The day-first pattern is fixed by request; only the month NAME is localized
  // (toLocaleDateString would otherwise reorder parts per locale, e.g. en → "May 20").
  // Bucket values are UTC YYYY-MM-DD; read in UTC so the day doesn't shift.
  function fmtBucket(iso: string): string {
    const d = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return iso;
    const mon = d.toLocaleDateString(locale.current, { month: 'short', timeZone: 'UTC' });
    const year = d.getUTCFullYear();
    if (bucket === 'month') return `${mon} ${year}`;
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${day} ${mon} ${year}`;
  }

  // svelte-ignore state_referenced_locally
  let fromDate = $state(data.period.from ? data.period.from.slice(0, 10) : '');
  // svelte-ignore state_referenced_locally
  let toDate = $state(data.period.to ? data.period.to.slice(0, 10) : '');
  // svelte-ignore state_referenced_locally
  let bucket = $state(data.period.bucket);

  let mode = $state<'period' | 'cumulative'>('period');
  let prodMode = $state<'revenue' | 'qty'>('revenue');

  // Which revenue-chart bands are hidden (keyed by localized series name). Taxes
  // and operational cost are REALIZED deductions: while visible they carve out of
  // the net-revenue band (revenue shrinks); hiding one lets net absorb it back.
  // Discount/void are UNREALIZED ("could've been"), stacked on top — no effect on net.
  let hiddenBands = $state<Record<string, boolean>>({});
  // Net band has a dynamic name (netName), so track its visibility with a stable
  // flag rather than a name key that shifts as deductions toggle.
  let netHidden = $state(false);
  function onLegendToggle(p: { name: string; selected: Record<string, boolean> }) {
    netHidden = p.selected['net-band'] === false; // net keyed by its stable id
    hiddenBands = Object.fromEntries(Object.entries(p.selected).map(([k, v]) => [k, !v]));
  }

  function navigate(f: string, t: string, b: string) {
    const p = new URLSearchParams();
    if (f) p.set('from', f);
    if (t) p.set('to', t);
    p.set('bucket', b);
    goto(`/finances?${p}`, { keepFocus: true, noScroll: true });
  }

  function preset30d() {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 30);
    const f = from.toISOString().slice(0, 10);
    const t = to.toISOString().slice(0, 10);
    fromDate = f;
    toDate = t;
    navigate(f, t, 'day');
  }

  function preset12m() {
    const to = new Date();
    const from = new Date();
    from.setMonth(from.getMonth() - 12);
    const f = from.toISOString().slice(0, 10);
    const t = to.toISOString().slice(0, 10);
    fromDate = f;
    toDate = t;
    navigate(f, t, 'month');
  }

  function presetYTD() {
    const now = new Date();
    const f = `${now.getFullYear()}-01-01`;
    const t = now.toISOString().slice(0, 10);
    fromDate = f;
    toDate = t;
    navigate(f, t, 'month');
  }

  function presetAll() {
    fromDate = '';
    toDate = '';
    navigate('', '', 'month');
  }

  type FinData = Awaited<PageData['streamed']['data']>;

  const buckets: Array<{ key: 'day' | 'week' | 'month'; label: () => string }> = [
    { key: 'day', label: m.fin_bucket_day },
    { key: 'week', label: m.fin_bucket_week },
    { key: 'month', label: m.fin_bucket_month },
  ];
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  // Everything below depends on the resolved (streamed) finance data — built
  // once per `{:then d}` render rather than as top-level $derived (the raw
  // promise isn't a value to derive from). Stays reactive to mode/prodMode/
  // hiddenBands/netHidden/c since those $state/derived reads happen inside
  // the call, evaluated live in the template's {@const}.
  function buildView(d: FinData) {
    const s = d.summary;

    function formatMoney(val: number): string {
      try {
        return val.toLocaleString('es-PE', {
          style: 'currency',
          currency: s.currency || 'PEN',
          maximumFractionDigits: 0,
        });
      } catch {
        return `${s.currency || 'S/'} ${Math.round(val).toLocaleString()}`;
      }
    }

    // Compact money for crowded value axes (e.g. horizontal bar charts) so labels
    // like "S/ 10,000" don't overlap. Tooltips still use the full formatMoney.
    function moneyShort(val: number): string {
      const cur = !s.currency || s.currency === 'PEN' ? 'S/' : s.currency;
      const a = Math.abs(val);
      if (a >= 1_000_000) return `${cur} ${(val / 1_000_000).toFixed(a % 1_000_000 ? 1 : 0)}M`;
      if (a >= 1_000) return `${cur} ${Math.round(val / 1000)}k`;
      return `${cur} ${Math.round(val)}`;
    }

    const periodGrowth = (() => {
      const series = d.series;
      if (series.length < 2) return null;
      const curr = series[series.length - 1].revenue;
      const prev = series[series.length - 2].revenue;
      return prev > 0 ? ((curr - prev) / prev) * 100 : null;
    })();

    // Localized band names double as ECharts series ids + legend/hidden-map keys.
    const bandNames = {
      tax: m.fin_chart_tax(),
      op: m.fin_chart_op_cost(),
      discount: m.fin_chart_discount(),
      void: m.fin_chart_void(),
    };
    // A deduction is "active" only when its band is visible.
    const taxActive = !hiddenBands[bandNames.tax];
    const opActive = !hiddenBands[bandNames.op];
    // Stable series identity for the net band (so ECharts morphs it vertically on
    // toggle instead of re-introing). The dynamic label is applied via legend.formatter.
    const netId = 'net-band';
    // Net-band label names only the deductions actually folded into it.
    const netName =
      taxActive && opActive
        ? m.fin_chart_net_after()
        : taxActive
          ? m.fin_chart_net_after_tax()
          : opActive
            ? m.fin_chart_net_after_cost()
            : m.fin_chart_net();

    const revenueOpts = (() => {
      const L = bandNames;
      const xData = d.series.map((r) => fmtBucket(r.bucket));
      const pick = (sel: (r: (typeof d.series)[number]) => number) => {
        if (mode !== 'cumulative') return d.series.map(sel);
        let sum = 0;
        return d.series.map((r) => (sum += sel(r)));
      };
      // Realized deductions (taxes, op-cost) carve OUT of net; each absorbs back
      // into net when its band is hidden. Floor at 0 so a cost-heavy month can't
      // push the net band below the axis. Unrealized bands (discount/void) stack
      // on top and never touch net.
      const netSel = (r: (typeof d.series)[number]) =>
        Math.max(0, r.revenue - (taxActive ? r.tax : 0) - (opActive ? r.opCost : 0));
      const netData = pick(netSel);
      const taxData = pick((r) => r.tax);
      const opCostData = pick((r) => r.opCost);
      const discountData = pick((r) => r.discount);
      const voidData = pick((r) => r.voided);
      const area = (color: string) => ({
        name: '',
        type: 'line' as const,
        stack: 'total',
        areaStyle: { color, opacity: 0.85 },
        lineStyle: { width: 1 },
        itemStyle: { color },
        symbol: 'circle',
        symbolSize: 4,
        smooth: true,
      });
      return {
        grid: { left: 8, right: 18, top: 16, bottom: 30, containLabel: true },
        tooltip: {
          trigger: 'axis',
          formatter: (params) => {
            const arr = (Array.isArray(params) ? params : [params]) as Array<{
              marker?: string;
              seriesName?: string;
              value?: unknown;
              axisValueLabel?: string;
            }>;
            const head = arr[0]?.axisValueLabel ?? '';
            const body = arr
              .map(
                (p) =>
                  `${p.marker ?? ''}${p.seriesName === netId ? netName : (p.seriesName ?? '')}: ${formatMoney(Number(p.value ?? 0))}`,
              )
              .join('<br/>');
            return `${head}<br/>${body}`;
          },
        },
        legend: {
          // Order = bottom→top of the stack. All bands (net included) are toggleable.
          // Net uses a stable id; formatter renders its dynamic label.
          data: [L.tax, L.op, netId, L.discount, L.void],
          bottom: 0,
          formatter: (name: string) => (name === netId ? netName : name),
          selected: {
            [L.tax]: taxActive,
            [L.op]: opActive,
            [netId]: !netHidden,
            [L.discount]: !hiddenBands[L.discount],
            [L.void]: !hiddenBands[L.void],
          },
        },
        xAxis: { type: 'category', data: xData, axisLabel: { hideOverlap: true } },
        yAxis: { type: 'value', axisLabel: { formatter: (v: number) => formatMoney(v) } },
        series: [
          { ...area(c.warning), name: L.tax, data: taxData },
          { ...area(c.purple), name: L.op, data: opCostData },
          { ...area(c.info), name: netId, data: netData },
          { ...area(c.success), name: L.discount, data: discountData },
          { ...area(c.destructive), name: L.void, data: voidData },
        ],
      } satisfies EChartsOption;
    })();

    const avgTicketOpts = {
      grid: { left: 8, right: 18, top: 16, bottom: 24, containLabel: true },
      tooltip: { trigger: 'axis', valueFormatter: (v) => formatMoney(Number(v)) },
      xAxis: {
        type: 'category',
        data: d.series.map((r) => fmtBucket(r.bucket)),
        axisLabel: { hideOverlap: true },
      },
      yAxis: { type: 'value', axisLabel: { formatter: (v: number) => formatMoney(v) } },
      series: [
        {
          name: m.fin_chart_avg_ticket(),
          type: 'line',
          data: d.series.map((r) => (r.invoices > 0 ? Math.round(r.revenue / r.invoices) : 0)),
          smooth: true,
        },
      ],
    } satisfies EChartsOption;

    const topProductsOpts = (() => {
      const sorted = [...d.products]
        .sort((a, b) => (prodMode === 'revenue' ? b.revenue - a.revenue : b.qty - a.qty))
        .slice(0, 12);
      const fmt = (v: number) =>
        prodMode === 'revenue' ? formatMoney(v) : Math.round(v).toLocaleString();
      const fmtAxis = (v: number) =>
        prodMode === 'revenue' ? moneyShort(v) : Math.round(v).toLocaleString();
      return {
        grid: { left: 8, right: 24, top: 16, bottom: 24, containLabel: true },
        tooltip: { trigger: 'axis', valueFormatter: (v) => fmt(Number(v)) },
        // Items on Y, amount on X (horizontal bars), highest at top.
        yAxis: {
          type: 'category',
          data: sorted.map((p) => p.name ?? p.code ?? '—'),
          inverse: true,
        },
        xAxis: {
          type: 'value',
          axisLabel: { formatter: (v: number) => fmtAxis(v), hideOverlap: true },
        },
        series: [
          {
            type: 'bar',
            data: sorted.map((p) => (prodMode === 'revenue' ? Math.round(p.revenue) : p.qty)),
          },
        ],
      } satisfies EChartsOption;
    })();

    const topClientsOpts = (() => {
      const sorted = [...d.clients].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
      return {
        grid: { left: 8, right: 24, top: 16, bottom: 24, containLabel: true },
        tooltip: { trigger: 'axis', valueFormatter: (v) => formatMoney(Number(v)) },
        yAxis: {
          type: 'category',
          data: sorted.map((c) => c.name ?? c.docNumber ?? '—'),
          inverse: true,
        },
        xAxis: {
          type: 'value',
          axisLabel: { formatter: (v: number) => moneyShort(v), hideOverlap: true },
        },
        series: [{ type: 'bar', data: sorted.map((c) => Math.round(c.revenue)) }],
      } satisfies EChartsOption;
    })();

    // KPI cards rendered by the editable grid (id-keyed).
    const kpis = [
    // Revenue composition: billed → −taxes → −COGS → = net revenue (margin).
    { id: 'k-net', label: m.fin_kpi_revenue(), value: formatMoney(s.totalNet) },
    ...(s.sensitiveMasked
      ? []
      : [
          { id: 'k-net-after', label: m.fin_kpi_net_revenue(), value: formatMoney(s.netRevenue) },
          { id: 'k-margin', label: m.fin_kpi_margin_rate(), value: pct(s.marginRate) },
          { id: 'k-cogs', label: m.fin_kpi_cogs(), value: formatMoney(s.totalCogs) },
        ]),
    { id: 'k-tax-rate', label: m.fin_kpi_tax_rate(), value: pct(s.taxRate) },
    { id: 'k-avg', label: m.fin_kpi_avg_ticket(), value: formatMoney(s.avgTicket) },
    {
      id: 'k-invoices',
      label: m.fin_kpi_invoices(),
      value: s.invoiceCount.toLocaleString(),
    },
    {
      id: 'k-clients',
      label: m.fin_kpi_unique_clients(),
      value: s.uniqueClients.toLocaleString(),
    },
    {
      id: 'k-newclients',
      label: m.fin_kpi_new_clients(),
      value: s.newClients.toLocaleString(),
    },
    {
      id: 'k-discount',
      label: m.fin_kpi_discount_rate(),
      value: `${(s.discountRate * 100).toFixed(1)}%`,
      href: '/finances/invoices?discounted=1',
    },
    {
      id: 'k-growth',
      label: m.fin_kpi_growth(),
      value:
        periodGrowth !== null ? `${periodGrowth >= 0 ? '+' : ''}${periodGrowth.toFixed(1)}%` : '—',
    },
    {
      id: 'k-void',
      label: m.fin_kpi_void_rate(),
      value: `${(s.voidRate * 100).toFixed(1)}%`,
      href: '/finances/invoices?status=void',
    },
    ];
    const kpiById = new Map(kpis.map((k) => [k.id, k]));

    // Grid items: 8 KPIs (3×2) then the four charts. Order/spans are user-editable
    // and persisted (localStorage personal + org default). Chart heights are sized
    // to roughly match their default span so the plot fills the cell.
    // ponytail: fixed chart px-heights; vertical resize sets the floor, not the chart
    // height (EditableGrid rows are minmax(row, auto) — no definite height to fill).
    const items = [
      ...kpis.map((k) => ({ id: k.id, w: 3, h: 2 })),
      { id: 'revenue', w: 12, h: 6 },
      { id: 'avgticket', w: 12, h: 5 },
      { id: 'products', w: 6, h: 6 },
      { id: 'clients', w: 6, h: 6 },
    ];

    return { d, s, kpiById, items, revenueOpts, avgTicketOpts, topProductsOpts, topClientsOpts };
  }
  type View = ReturnType<typeof buildView>;
</script>

<svelte:head><title>{m.nav_finance()}</title></svelte:head>

<!-- Period controls — shared between the empty state and the grid toolbar. -->
{#snippet periodControls()}
  <div class="period-controls">
    <div class="date-range">
      <label class="date-label">
        <span>{m.fin_date_from()}</span>
        <input
          type="date"
          bind:value={fromDate}
          oninput={() => navigate(fromDate, toDate, bucket)}
        />
      </label>
      <label class="date-label">
        <span>{m.fin_date_to()}</span>
        <input type="date" bind:value={toDate} oninput={() => navigate(fromDate, toDate, bucket)} />
      </label>
    </div>
    <div class="seg-group">
      {#each buckets as b (b.key)}
        <Button
          variant={bucket === b.key ? 'primary' : 'ghost'}
          size="sm"
          aria-pressed={bucket === b.key}
          onclick={() => {
            bucket = b.key;
            navigate(fromDate, toDate, b.key);
          }}>{b.label()}</Button
        >
      {/each}
    </div>
    <div class="presets">
      <Button variant="outline" size="sm" onclick={preset30d}>{m.fin_preset_30d()}</Button>
      <Button variant="outline" size="sm" onclick={preset12m}>{m.fin_preset_12m()}</Button>
      <Button variant="outline" size="sm" onclick={presetYTD}>{m.fin_preset_ytd()}</Button>
      <Button variant="outline" size="sm" onclick={presetAll}>{m.fin_preset_all()}</Button>
    </div>
  </div>
{/snippet}

<!-- One snippet keyed by item id — EditableGrid renders each cell by id. -->
{#snippet cellBody(id: string, view: View)}
  {@const { kpiById, revenueOpts, avgTicketOpts, topProductsOpts, topClientsOpts } = view}
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
  {:else if id === 'revenue'}
    <div class="card">
      <div class="card-h-row">
        <span class="card-h">{m.fin_chart_revenue_area()}</span>
        <div class="chart-toggle">
          <Button
            variant={mode === 'period' ? 'primary' : 'ghost'}
            size="sm"
            aria-pressed={mode === 'period'}
            onclick={() => (mode = 'period')}>{m.fin_toggle_period()}</Button
          >
          <Button
            variant={mode === 'cumulative' ? 'primary' : 'ghost'}
            size="sm"
            aria-pressed={mode === 'cumulative'}
            onclick={() => (mode = 'cumulative')}>{m.fin_toggle_cumulative()}</Button
          >
        </div>
      </div>
      <Chart options={revenueOpts} height="330px" {onLegendToggle} notMergeUpdate={false} />
      <p class="chart-note">{m.fin_chart_deduct_note()}</p>
    </div>
  {:else if id === 'avgticket'}
    <div class="card">
      <div class="card-h">{m.fin_chart_avg_ticket()}</div>
      <Chart options={avgTicketOpts} height="270px" />
    </div>
  {:else if id === 'products'}
    <div class="card">
      <div class="card-h-row">
        <span class="card-h">{m.fin_chart_top_products()}</span>
        <div class="chart-toggle">
          <Button
            variant={prodMode === 'revenue' ? 'primary' : 'ghost'}
            size="sm"
            aria-pressed={prodMode === 'revenue'}
            onclick={() => (prodMode = 'revenue')}>{m.fin_toggle_revenue()}</Button
          >
          <Button
            variant={prodMode === 'qty' ? 'primary' : 'ghost'}
            size="sm"
            aria-pressed={prodMode === 'qty'}
            onclick={() => (prodMode = 'qty')}>{m.fin_toggle_qty()}</Button
          >
        </div>
      </div>
      <Chart options={topProductsOpts} height="330px" />
    </div>
  {:else if id === 'clients'}
    <div class="card">
      <div class="card-h">{m.fin_chart_top_clients()}</div>
      <Chart options={topClientsOpts} height="330px" />
    </div>
  {/if}
{/snippet}

<PageShell archetype="dashboard" scroll="region" labelledBy="finances-title">
  <PageHeader
    titleId="finances-title"
    title={m.nav_finance()}
    subtitle={m.fin_dashboard_subtitle()}
  >
    {#snippet leading()}<Wallet size={16} class="text-accent shrink-0" />{/snippet}
  </PageHeader>

  <!-- Full-width scroller so the scrollbar hugs the screen edge; content padded. -->
  <PageBody padding="compact" scroll="region">
    <div class="w-full max-w-6xl mx-auto">
      <!-- Period controls paint instantly, independent of the streamed data. -->
      {@render periodControls()}

      {#await data.streamed.data}
        <div class="skel-grid">
          {#each { length: 8 } as _, i (i)}
            <Skeleton height="4.5rem" rounded="rounded-lg" />
          {/each}
          <div class="skel-wide"><Skeleton height="16rem" rounded="rounded-lg" /></div>
          <div class="skel-wide"><Skeleton height="14rem" rounded="rounded-lg" /></div>
          <Skeleton height="16rem" rounded="rounded-lg" />
          <Skeleton height="16rem" rounded="rounded-lg" />
        </div>
      {:then d}
        {#if !d.hasData}
          <p class="t-caption mt-4">{m.fin_empty()}</p>
        {:else}
          {@const view = buildView(d)}
          <EditableGrid
            id="finances-dashboard-v2"
            items={view.items}
            cols={12}
            rowHeight={56}
            canSetDefault={isAdmin.value}
            readonly={!canAct('finance', 'edit')}
          >
            {#snippet cell(id)}{@render cellBody(id, view)}{/snippet}
          </EditableGrid>
        {/if}
      {:catch}
        <EmptyState title="Couldn't load finance dashboard data" icon={Wallet} compact />
      {/await}
    </div>
  </PageBody>
</PageShell>

<style>
  .period-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3, 12px);
  }
  .date-range {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
  }
  .date-label {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: var(--space-2, 8px);
    font-size: var(--font-size-caption, 12px);
    color: var(--color-muted-foreground);
    white-space: nowrap;
  }
  .date-label input {
    padding: var(--space-1, 4px) var(--space-2, 8px);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    background: var(--color-card);
    color: var(--color-foreground);
    font-size: var(--font-size-body, 14px);
    /* Render the native calendar picker icon + popup in dark mode so the
		   indicator contrasts against the dark input (hub convention). */
    color-scheme: dark;
  }
  .seg-group {
    display: flex;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .presets {
    display: flex;
    gap: var(--space-2, 8px);
  }

  /* loading skeleton — rough shape of the KPI row + chart cards below */
  .skel-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-3, 12px);
    margin-top: var(--space-3, 12px);
  }
  .skel-wide {
    grid-column: 1 / -1;
  }
  .kpi {
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: var(--space-3, 12px) var(--space-4, 16px);
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
    font-size: var(--font-size-display, 28px);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .kpi-label {
    font-size: var(--font-size-caption, 12px);
    color: var(--color-muted-foreground);
    margin-top: var(--space-1, 4px);
  }
  .card {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    padding: var(--space-3, 12px) var(--space-4, 16px);
  }
  .card-h {
    font-size: var(--font-size-caption, 12px);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-muted-foreground);
    margin-bottom: var(--space-3, 12px);
    display: block;
  }
  .card-h-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-3, 12px);
  }
  .card-h-row .card-h {
    margin-bottom: 0;
  }
  .chart-note {
    margin: var(--space-2, 8px) 0 0;
    font-size: var(--font-size-caption, 12px);
    color: var(--color-muted-foreground);
    text-align: center;
  }
  .chart-toggle {
    display: flex;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
</style>
