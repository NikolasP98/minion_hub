<script lang="ts">
  import type { EChartsOption } from 'echarts';
  import {
    AlertTriangle,
    Database,
    Gauge,
    MemoryStick,
    ServerCog,
    Snowflake,
    Timer,
  } from 'lucide-svelte';
  import Chart from '$lib/components/charts/Chart.svelte';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import KpiRow, { type KpiItem } from '$lib/components/reliability/KpiRow.svelte';
  import { EmptyState, Spinner, iconSizes } from '$lib/components/ui';
  import { chartColors } from '$lib/utils/chart-colors';
  import type {
    PerformanceMonitorSnapshot,
    PerformanceRouteSummary,
  } from '$lib/types/performance-monitor';
  import * as m from '$lib/paraglide/messages';

  let {
    from,
    to,
    refreshKey = 0,
  }: {
    from: number;
    to: number;
    refreshKey?: number;
  } = $props();

  let snapshot = $state<PerformanceMonitorSnapshot | null>(null);
  let loading = $state(false);
  let loadError = $state<string | null>(null);

  $effect(() => {
    const rangeFrom = from;
    const rangeTo = to;
    void refreshKey;
    const controller = new AbortController();
    loading = true;
    loadError = null;
    void fetch(`/api/reliability/performance?from=${rangeFrom}&to=${rangeTo}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        snapshot = (await response.json()) as PerformanceMonitorSnapshot;
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        loadError = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) loading = false;
      });
    return () => controller.abort();
  });

  const number = new Intl.NumberFormat();
  const formatMs = (value: number) =>
    value >= 1_000 ? `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)}s` : `${value}ms`;
  const formatPct = (value: number) => `${(value * 100).toFixed(1)}%`;
  const formatTime = (value: number) =>
    new Date(value).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

  const kpis = $derived.by<KpiItem[]>(() => {
    if (!snapshot) return [];
    const summary = snapshot.summary;
    return [
      {
        key: 'cold-p95',
        Icon: Snowflake,
        color: summary.coldP95Ms >= 3_000 ? 'var(--color-warning)' : 'var(--color-info)',
        label: m.reliability_performanceColdP95(),
        value: formatMs(summary.coldP95Ms),
        subtext: m.reliability_performanceColdSamples({ count: summary.coldSamples }),
      },
      {
        key: 'p95',
        Icon: Gauge,
        color: summary.p95Ms >= 3_000 ? 'var(--color-warning)' : 'var(--color-accent)',
        label: m.reliability_performanceOverallP95(),
        value: formatMs(summary.p95Ms),
        subtext: m.reliability_performanceSamples({ count: summary.totalSamples }),
      },
      {
        key: 'db-p95',
        Icon: Database,
        color: summary.dbP95Ms >= 1_000 ? 'var(--color-warning)' : 'var(--color-purple)',
        label: m.reliability_performanceDbP95(),
        value: formatMs(summary.dbP95Ms),
        subtext: m.reliability_performanceDbHint(),
      },
      {
        key: 'cache-hit',
        Icon: MemoryStick,
        color: snapshot.cache.hitRate >= 0.8 ? 'var(--color-success)' : 'var(--color-warning)',
        label: m.reliability_performanceCacheHitRate(),
        value: formatPct(snapshot.cache.hitRate),
        subtext: m.reliability_performanceCacheCounts({
          hits: snapshot.cache.hits + snapshot.cache.staleHits,
          misses: snapshot.cache.misses,
          p95: formatMs(snapshot.cache.lookupP95Ms),
        }),
      },
      {
        key: 'isolates',
        Icon: ServerCog,
        color: 'var(--color-cyan)',
        label: m.reliability_performanceIsolateCold(),
        value: number.format(summary.isolateColdSamples),
        subtext: m.reliability_performanceIsolateHint(),
      },
      {
        key: 'slow',
        Icon: Timer,
        color: summary.slowSamples > 0 ? 'var(--color-destructive)' : 'var(--color-success)',
        label: m.reliability_performanceSlowSamples(),
        value: number.format(summary.slowSamples),
        subtext: m.reliability_performanceSlowHint(),
      },
    ];
  });

  const routeColumns: DataColumn<PerformanceRouteSummary>[] = [
    {
      key: 'route',
      label: m.reliability_performanceRoute(),
      accessor: (row) => row.route,
      custom: true,
      width: 310,
    },
    {
      key: 'samples',
      label: m.reliability_performanceSamplesLabel(),
      accessor: (row) => row.samples,
      custom: true,
      align: 'right',
      width: 92,
    },
    {
      key: 'coldP95Ms',
      label: m.reliability_performanceColdP95(),
      accessor: (row) => row.coldP95Ms,
      custom: true,
      align: 'right',
      width: 110,
    },
    {
      key: 'p95Ms',
      label: m.reliability_performanceOverallP95(),
      accessor: (row) => row.p95Ms,
      custom: true,
      align: 'right',
      width: 100,
    },
    {
      key: 'dbP95Ms',
      label: m.reliability_performanceDbP95(),
      accessor: (row) => row.dbP95Ms,
      custom: true,
      align: 'right',
      width: 100,
    },
    {
      key: 'cacheP95Ms',
      label: m.reliability_performanceCacheP95(),
      accessor: (row) => row.cacheP95Ms,
      custom: true,
      align: 'right',
      width: 110,
    },
    {
      key: 'cacheMissRate',
      label: m.reliability_performanceCacheMissRate(),
      accessor: (row) => row.cacheMissRate,
      custom: true,
      align: 'right',
      width: 110,
    },
    {
      key: 'slowRate',
      label: m.reliability_performanceSlowRate(),
      accessor: (row) => row.slowRate,
      custom: true,
      align: 'right',
      width: 100,
    },
    {
      key: 'lastSeenAt',
      label: m.reliability_performanceLastSeen(),
      accessor: (row) => row.lastSeenAt,
      custom: true,
      width: 155,
    },
  ];

  const trendOptions = $derived.by<EChartsOption>(() => {
    const colors = chartColors();
    const points = snapshot?.timeline ?? [];
    return {
      tooltip: { trigger: 'axis', valueFormatter: (value) => formatMs(Number(value)) },
      legend: { top: 0, textStyle: { fontSize: 10 } },
      grid: { top: 34, right: 18, bottom: 28, left: 52 },
      xAxis: {
        type: 'category',
        data: points.map((point) =>
          new Date(point.timestamp).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }),
        ),
        axisLabel: { fontSize: 10, hideOverlap: true },
        axisTick: { show: false },
      },
      yAxis: { type: 'value', name: 'ms', axisLabel: { fontSize: 10 } },
      series: [
        {
          name: m.reliability_performanceOverallP95(),
          type: 'line',
          data: points.map((point) => point.p95Ms),
          symbol: 'none',
          lineStyle: { color: colors.accent, width: 2 },
          itemStyle: { color: colors.accent },
        },
        {
          name: m.reliability_performanceColdP95(),
          type: 'line',
          data: points.map((point) => point.coldP95Ms),
          symbol: 'none',
          connectNulls: false,
          lineStyle: { color: colors.warning, width: 2 },
          itemStyle: { color: colors.warning },
        },
      ],
    } satisfies EChartsOption;
  });
</script>

{#if loading && !snapshot}
  <div class="flex items-center justify-center py-16"><Spinner /></div>
{:else if loadError && !snapshot}
  <EmptyState
    tone="error"
    icon={AlertTriangle}
    title={m.reliability_performanceLoadError()}
    description={loadError}
  />
{:else if snapshot && !snapshot.available}
  <EmptyState
    tone="error"
    icon={AlertTriangle}
    title={m.reliability_performanceUnavailable()}
    description={m.reliability_performanceUnavailableDesc()}
  />
{:else if snapshot && snapshot.summary.totalSamples === 0}
  <EmptyState
    icon={Snowflake}
    title={m.reliability_performanceEmpty()}
    description={m.reliability_performanceEmptyDesc()}
  />
{:else if snapshot}
  <div class="flex flex-col gap-4">
    <div
      class="surface-2 rounded-lg px-4 py-3 flex flex-wrap items-start gap-3 border border-border"
    >
      <Snowflake size={iconSizes.md} class="text-info shrink-0 mt-0.5" />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-foreground">{m.reliability_performanceDefinition()}</p>
        <p class="text-xs text-muted-strong mt-0.5">
          {m.reliability_performanceDefinitionDesc()}
        </p>
      </div>
      {#if loading}
        <span class="text-xs text-muted-strong">{m.common_loading()}</span>
      {/if}
    </div>

    <KpiRow items={kpis} cols={6} />

    {#if snapshot.truncated}
      <div class="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 flex gap-3">
        <AlertTriangle size={iconSizes.sm} class="text-warning shrink-0 mt-0.5" />
        <p class="text-xs text-muted-strong">
          {m.reliability_performanceTruncated({
            time: formatTime(snapshot.effectiveRange.from),
          })}
        </p>
      </div>
    {/if}

    {#if snapshot.timeline.length > 1}
      <section class="surface-2 rounded-lg overflow-hidden">
        <header class="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg3/20">
          <Gauge size={iconSizes.xs} class="text-accent" />
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {m.reliability_performanceTrend()}
          </h3>
        </header>
        <div class="px-3 py-2"><Chart options={trendOptions} height="260px" /></div>
      </section>
    {/if}

    <section class="surface-2 rounded-lg overflow-hidden min-h-[360px] flex flex-col">
      <header class="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg3/20">
        <Timer size={iconSizes.xs} class="text-warning" />
        <h3 class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {m.reliability_performanceSlowestRoutes()}
        </h3>
        <span class="ml-auto text-xs text-muted-strong">
          {m.reliability_performanceAsOf({ time: formatTime(snapshot.generatedAt) })}
        </span>
      </header>
      <DataTable
        class="flex-1 min-h-0"
        data={snapshot.routes}
        columns={routeColumns}
        getRowId={(row) => row.route}
        searchable={false}
        columnMenu={false}
        reorderable={false}
        resizable={false}
        initialSort={{ key: 'coldP95Ms', dir: 'desc' }}
        emptyMessage={m.reliability_performanceEmpty()}
      >
        {#snippet cell(row: PerformanceRouteSummary, column: DataColumn<PerformanceRouteSummary>)}
          {#if column.key === 'route'}
            <span class="font-mono text-xs text-foreground" title={row.route}>{row.route}</span>
          {:else if column.key === 'samples'}
            <span class="font-mono tabular-nums text-muted-strong"
              >{number.format(row.samples)}</span
            >
          {:else if column.key === 'coldP95Ms'}
            <span
              class="font-mono tabular-nums {row.coldP95Ms >= 3_000
                ? 'text-warning'
                : 'text-foreground'}">{formatMs(row.coldP95Ms)}</span
            >
          {:else if column.key === 'p95Ms'}
            <span class="font-mono tabular-nums text-foreground">{formatMs(row.p95Ms)}</span>
          {:else if column.key === 'dbP95Ms'}
            <span class="font-mono tabular-nums text-muted-strong">{formatMs(row.dbP95Ms)}</span>
          {:else if column.key === 'cacheP95Ms'}
            <span class="font-mono tabular-nums text-muted-strong"
              >{formatMs(row.cacheP95Ms)}</span
            >
          {:else if column.key === 'cacheMissRate'}
            <span class="font-mono tabular-nums text-muted-strong"
              >{formatPct(row.cacheMissRate)}</span
            >
          {:else if column.key === 'slowRate'}
            <span
              class="font-mono tabular-nums {row.slowRate > 0
                ? 'text-destructive'
                : 'text-muted-strong'}">{formatPct(row.slowRate)}</span
            >
          {:else if column.key === 'lastSeenAt'}
            <span class="text-xs text-muted-strong">{formatTime(row.lastSeenAt)}</span>
          {/if}
        {/snippet}
      </DataTable>
    </section>
  </div>
{/if}
