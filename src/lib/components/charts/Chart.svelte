<script lang="ts">
  import { onMount } from 'svelte';
  import type { EChartsOption, ECharts } from 'echarts';
  import * as m from '$lib/paraglide/messages';

  let {
    options,
    class: className = '',
    style = '',
    height = '300px',
    onItemClick,
    onLegendToggle,
    notMergeUpdate = true,
    ariaLabel,
    tableCategoryLabel,
  }: {
    options: EChartsOption;
    class?: string;
    style?: string;
    height?: string;
    /** Optional ECharts click handler (receives the click params). */
    onItemClick?: (params: unknown) => void;
    /** Optional legend show/hide handler (ECharts `legendselectchanged`). */
    onLegendToggle?: (params: { name: string; selected: Record<string, boolean> }) => void;
    /** Default replaces the whole option on update (full re-render/intro anim).
     *  Set false to MERGE updates so ECharts tweens changed values in place —
     *  needed for stacked areas that toggle series (vertical morph, no L→R wipe).
     *  Requires stable series names across renders or the changed series re-intros. */
    notMergeUpdate?: boolean;
    /** Accessible name for the chart, used as the `role="img"` label and the
     *  data-table disclosure's caption. Pass a specific label describing what
     *  the chart shows (e.g. "Monthly customer-sentiment trend") — falls back
     *  to a generic translated "Chart" when omitted. */
    ariaLabel?: string;
    /** Header for the category (first) column of the nonvisual data table.
     *  Falls back to a generic translated "Category" when omitted. */
    tableCategoryLabel?: string;
  } = $props();

  let container: HTMLDivElement;
  let chart: ECharts | undefined = $state();
  let resizeObs: ResizeObserver | undefined;
  // Reflects `prefers-reduced-motion` at mount and on live OS/browser changes
  // (same matchMedia + addEventListener('change', …) pattern as DraggableWindow's
  // breakpoint watcher). Read inside applyDefaults so both the effect that calls
  // setOption on option changes AND the one below that reruns purely on this flag
  // pick it up.
  let prefersReducedMotion = $state(false);

  const resolvedAriaLabel = $derived(ariaLabel ?? m.a11y0_chartRegion());
  const resolvedCategoryLabel = $derived(tableCategoryLabel ?? m.a11y0_chartTableCategory());

  function firstCategoryAxis(axis: EChartsOption['xAxis']): (string | number)[] | null {
    const candidate = Array.isArray(axis) ? axis[0] : axis;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const { type, data } = candidate as { type?: string; data?: unknown };
    if (type !== 'category' || !Array.isArray(data)) return null;
    return data as (string | number)[];
  }

  /** Reuses the same `axisLabel.formatter` the chart already draws with, so
   *  the table's category column reads the visible label ("Aug 1") rather
   *  than the raw axis value ("2026-08-01") — one formatter, two renderings,
   *  never two independent copies to drift apart. */
  function formatCategory(
    axis: EChartsOption['xAxis'],
    raw: string | number,
    index: number,
  ): string | number {
    const candidate = Array.isArray(axis) ? axis[0] : axis;
    const formatter = (candidate as { axisLabel?: { formatter?: unknown } } | undefined)?.axisLabel
      ?.formatter;
    if (typeof formatter !== 'function') return raw;
    try {
      return (formatter as (value: string | number, idx: number) => string)(raw, index);
    } catch {
      return raw;
    }
  }

  function pointValue(point: unknown): string | number | null {
    if (typeof point === 'number' || typeof point === 'string') return point;
    if (point && typeof point === 'object' && 'value' in point) {
      const v = (point as { value: unknown }).value;
      if (typeof v === 'number' || typeof v === 'string') return v;
    }
    return null;
  }

  /** Real text/table alternative to the canvas: derived straight from the
   *  actual series values on every render, so it can never drift from what's
   *  drawn. Only understands the category-axis + series-array shape used by
   *  Chart's current callers; charts that don't fit this shape (pie, graph,
   *  sankey, …) get the aria-label/role=img name only — tracked as a gap in
   *  13-CANVAS-COVERAGE.md rather than guessed at here. */
  const accessibleTable = $derived.by(() => {
    const categories = firstCategoryAxis(options.xAxis);
    const seriesList = Array.isArray(options.series)
      ? options.series
      : options.series
        ? [options.series]
        : [];
    if (!categories || categories.length === 0 || seriesList.length === 0) return null;

    const columns = seriesList.map((s, i) => {
      const name = (s as { name?: unknown }).name;
      return typeof name === 'string' && name.trim()
        ? name
        : m.a11y0_chartSeriesN({ index: i + 1 });
    });
    const rows = categories.map((category, rowIndex) => ({
      category: formatCategory(options.xAxis, category, rowIndex),
      values: seriesList.map((s) => {
        const data = (s as { data?: unknown }).data;
        const raw = Array.isArray(data) ? pointValue(data[rowIndex]) : null;
        return raw ?? '—';
      }),
    }));
    return { columns, rows };
  });

  function applyDefaults(opts: EChartsOption): EChartsOption {
    return {
      ...opts,
      // Reduced motion wins over whatever the caller's option asked for —
      // this is an accessibility floor, not a per-chart preference.
      animation: prefersReducedMotion ? false : (opts.animation ?? true),
      tooltip: {
        appendToBody: true,
        ...(typeof opts.tooltip === 'object' && !Array.isArray(opts.tooltip) ? opts.tooltip : {}),
      },
    };
  }

  function getCSSVar(name: string, fallback: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function buildTheme() {
    const card = getCSSVar('--color-card', '#0c0c0e');
    const border = getCSSVar('--color-border', '#27272a');
    const fg = getCSSVar('--color-foreground', '#fafafa');
    const muted = getCSSVar('--color-muted', '#a1a1aa');
    const mutedFg = getCSSVar('--color-muted-foreground', '#71717a');
    const bg2 = getCSSVar('--color-bg2', '#18181b');

    // Default ECharts auto-color palette, resolved from theme tokens so series
    // without an explicit color follow the active theme. Order matches the prior
    // hardcoded ramp: info, success, warning, destructive, purple, pink.
    const palette = [
      getCSSVar('--color-info', '#3b82f6'),
      getCSSVar('--color-success', '#22c55e'),
      getCSSVar('--color-warning', '#f59e0b'),
      getCSSVar('--color-destructive', '#ef4444'),
      getCSSVar('--color-purple', '#a855f7'),
      getCSSVar('--color-pink', '#ec4899'),
    ];

    return {
      color: palette,
      backgroundColor: 'transparent',
      textStyle: { color: fg },
      title: {
        textStyle: { color: fg },
        subtextStyle: { color: muted },
      },
      legend: {
        textStyle: { color: muted },
      },
      tooltip: {
        backgroundColor: card,
        borderColor: border,
        textStyle: { color: fg },
      },
      categoryAxis: {
        axisLine: { lineStyle: { color: border } },
        axisTick: { lineStyle: { color: border } },
        axisLabel: { color: mutedFg },
        splitLine: { lineStyle: { color: bg2 } },
      },
      valueAxis: {
        axisLine: { lineStyle: { color: border } },
        axisTick: { lineStyle: { color: border } },
        axisLabel: { color: mutedFg },
        splitLine: { lineStyle: { color: bg2 } },
      },
      line: {
        symbolSize: 4,
        smooth: false,
      },
      grid: {
        containLabel: true,
      },
    };
  }

  onMount(() => {
    let disposed = false;
    let echartsLib: typeof import('echarts') | undefined;
    let themeObserver: MutationObserver | undefined;

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotionPref = () => {
      prefersReducedMotion = motionQuery.matches;
    };
    updateMotionPref();
    motionQuery.addEventListener('change', updateMotionPref);

    import('echarts').then((echarts) => {
      if (disposed) return;
      echartsLib = echarts;

      echarts.registerTheme('minion-dark', buildTheme());
      chart = echarts.init(container, 'minion-dark');
      chart.setOption(applyDefaults(options));
      if (onItemClick) chart.on('click', onItemClick);
      if (onLegendToggle) chart.on('legendselectchanged', onLegendToggle as (p: unknown) => void);

      // ECharts measures the container at init; inside a flex/grid that hasn't
      // laid out yet that can be ~0, leaving the chart rendered tiny. Re-measure
      // after the first frame so it fills its container.
      requestAnimationFrame(() => chart?.resize());

      resizeObs = new ResizeObserver(() => {
        chart?.resize();
      });
      resizeObs.observe(container);

      // Re-register theme when CSS variables change (theme switch)
      themeObserver = new MutationObserver(() => {
        if (!echartsLib || !chart) return;
        echartsLib.registerTheme('minion-dark', buildTheme());
        // Re-init with updated theme
        const currentOpts = chart.getOption() as EChartsOption;
        // appendToBody tooltips live on <body>; hide before dispose or they orphan
        chart.dispatchAction({ type: 'hideTip' });
        chart.dispose();
        chart = echartsLib.init(container, 'minion-dark');
        chart.setOption(applyDefaults(currentOpts));
        if (onItemClick) chart.on('click', onItemClick);
        if (onLegendToggle) chart.on('legendselectchanged', onLegendToggle as (p: unknown) => void);
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme', 'style'],
      });
    });

    return () => {
      disposed = true;
      motionQuery.removeEventListener('change', updateMotionPref);
      themeObserver?.disconnect();
      resizeObs?.disconnect();
      chart?.dispatchAction({ type: 'hideTip' });
      chart?.dispose();
    };
  });

  $effect(() => {
    if (chart) {
      // notMerge re-renders detach the body-appended tooltip from its chart;
      // hide it first or it lingers after the pointer leaves.
      chart.dispatchAction({ type: 'hideTip' });
      chart.setOption(applyDefaults(options), { notMerge: notMergeUpdate });
    }
  });
</script>

<div class="chart-a11y-wrap">
  <div
    bind:this={container}
    class={className}
    style="width:100%;height:{height};{style}"
    role="img"
    aria-label={resolvedAriaLabel}
  ></div>
  {#if accessibleTable}
    <details class="chart-alt">
      <summary class="t-caption">{m.a11y0_chartDataTable()}</summary>
      <table class="chart-alt-table">
        <caption class="sr-only">{resolvedAriaLabel}</caption>
        <thead>
          <tr>
            <th scope="col">{resolvedCategoryLabel}</th>
            {#each accessibleTable.columns as column, i (i)}
              <th scope="col">{column}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each accessibleTable.rows as row, i (i)}
            <tr>
              <th scope="row">{row.category}</th>
              {#each row.values as value, i (i)}
                <td>{value}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </details>
  {/if}
</div>

<style>
  .chart-alt {
    margin-top: var(--space-1);
  }

  .chart-alt summary {
    cursor: pointer;
    color: var(--color-text-secondary);
  }

  .chart-alt-table {
    width: 100%;
    margin-top: var(--space-1);
    border-collapse: collapse;
    font-size: var(--font-size-body);
  }

  .chart-alt-table th,
  .chart-alt-table td {
    padding: var(--space-0-5) var(--space-1);
    text-align: left;
    border-bottom: 1px solid var(--color-border-subtle);
  }
</style>
