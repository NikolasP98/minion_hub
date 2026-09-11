<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    EChartsOption,
    ECharts,
    SeriesOption,
    LineSeriesOption,
    BarSeriesOption,
  } from 'echarts';
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
  let tableViewport: HTMLDivElement | undefined = $state();
  let tableOverflows = $state(false);
  $effect(() => {
    const viewport = tableViewport;
    if (!viewport) return;
    const measure = () => {
      tableOverflows = viewport.scrollWidth > viewport.clientWidth;
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    measure();
    return () => observer.disconnect();
  });
  // Reflects `prefers-reduced-motion` at mount and on live OS/browser changes
  // (same matchMedia + addEventListener('change', …) pattern as DraggableWindow's
  // breakpoint watcher). Read inside applyDefaults so both the effect that calls
  // setOption on option changes AND the one below that reruns purely on this flag
  // pick it up.
  let prefersReducedMotion = $state(false);

  const resolvedAriaLabel = $derived(ariaLabel ?? m.a11y0_chartRegion());
  const resolvedCategoryLabel = $derived(tableCategoryLabel ?? m.a11y0_chartTableCategory());

  type Axis = { type?: string; data?: unknown[]; axisLabel?: { formatter?: unknown } };
  function axisAt(
    axes: EChartsOption['xAxis'] | EChartsOption['yAxis'],
    index = 0,
  ): Axis | undefined {
    return (Array.isArray(axes) ? axes[index] : index === 0 ? axes : undefined) as Axis | undefined;
  }

  function pointValue(point: unknown): string | number | null {
    if (typeof point === 'string') return point;
    if (typeof point === 'number') return Number.isFinite(point) ? point : null;
    if (point && typeof point === 'object' && 'value' in point) {
      return pointValue((point as { value: unknown }).value);
    }
    return null;
  }

  function formatAxis(axis: Axis | undefined, value: string | number, index: number) {
    const formatter = axis?.axisLabel?.formatter;
    if (typeof formatter === 'string') return formatter.replace('{value}', String(value));
    if (typeof formatter === 'function') {
      try {
        const formatted: unknown = formatter(value, index);
        if (typeof formatted === 'string' || typeof formatted === 'number') return formatted;
      } catch {
        /* A broken label formatter must not remove the underlying value. */
      }
    }
    return value;
  }

  // TODO(handoff): dataset/encode, tuple points, mixed category axes and non-Cartesian
  // charts need explicit alternatives; never infer a misleading table. Root tracks
  // consumer completion in .planning/phases/13-ui-qualification/13-CANVAS-COVERAGE.md.
  const accessibleTable = $derived.by(() => {
    const series = Array.isArray(options.series)
      ? options.series
      : options.series
        ? [options.series]
        : [];
    if (!series.length) return null;
    const cartesian = series.filter(
      (item): item is LineSeriesOption | BarSeriesOption =>
        item.type === 'line' || item.type === 'bar',
    );
    if (cartesian.length !== series.length) return null;
    const first = cartesian[0];
    const horizontal = axisAt(options.yAxis, first.yAxisIndex)?.type === 'category';
    const categoryIndex = (horizontal ? first.yAxisIndex : first.xAxisIndex) ?? 0;
    const categoryAxis = axisAt(horizontal ? options.yAxis : options.xAxis, categoryIndex);
    if (
      !categoryAxis ||
      (categoryAxis.type !== 'category' && categoryAxis.type !== undefined) ||
      !categoryAxis.data?.length
    )
      return null;
    const categories = categoryAxis.data.map(pointValue);
    if (categories.some((value) => value === null)) return null;
    for (const item of cartesian) {
      if (
        (item.type !== 'line' && item.type !== 'bar') ||
        (item.coordinateSystem !== undefined && item.coordinateSystem !== 'cartesian2d') ||
        item.xAxisId !== undefined ||
        item.yAxisId !== undefined ||
        item.encode ||
        item.datasetIndex !== undefined ||
        ((horizontal ? item.yAxisIndex : item.xAxisIndex) ?? 0) !== categoryIndex ||
        !Array.isArray(item.data) ||
        item.data.length > categories.length ||
        item.data.some((point) => {
          const value =
            point && typeof point === 'object' && 'value' in point ? point.value : point;
          return (
            value !== null &&
            value !== undefined &&
            typeof value !== 'string' &&
            typeof value !== 'number'
          );
        })
      )
        return null;
    }
    return {
      columns: cartesian.map((item, index) =>
        typeof item.name === 'string' && item.name.trim()
          ? item.name
          : m.a11y0_chartSeriesN({ index: index + 1 }),
      ),
      rows: categories.map((category, index) => ({
        category: formatAxis(categoryAxis, category!, index),
        values: cartesian.map((item) => {
          const value = pointValue(Array.isArray(item.data) ? item.data[index] : null);
          if (value === null || value === '-') return '—';
          return formatAxis(
            axisAt(
              horizontal ? options.xAxis : options.yAxis,
              horizontal ? item.xAxisIndex : item.yAxisIndex,
            ),
            value,
            index,
          );
        }),
      })),
    };
  });

  function applyDefaults(opts: EChartsOption): EChartsOption {
    const reduced = prefersReducedMotion;
    // Merge updates retain omitted keys. Write undefined explicitly when the
    // caller omits animation so ECharts restores its own parent/default policy
    // (notably markArea defaults to false). Preserve merge-mode legend state.
    // TODO(handoff): effectScatter/lines effects need engine-specific reduced-motion
    // qualification; track .planning/phases/13-ui-qualification/13-CANVAS-COVERAGE.md.
    const motionSeries = (item: SeriesOption) => ({
      ...item,
      animation: reduced ? false : item.animation,
      ...(reduced && 'universalTransition' in item ? { universalTransition: false } : {}),
      ...('markLine' in item && item.markLine
        ? { markLine: { ...item.markLine, animation: reduced ? false : item.markLine.animation } }
        : {}),
      ...('markPoint' in item && item.markPoint
        ? {
            markPoint: { ...item.markPoint, animation: reduced ? false : item.markPoint.animation },
          }
        : {}),
      ...('markArea' in item && item.markArea
        ? { markArea: { ...item.markArea, animation: reduced ? false : item.markArea.animation } }
        : {}),
    });
    return {
      ...opts,
      animation: reduced ? false : (opts.animation ?? true),
      ...(opts.series
        ? {
            series: Array.isArray(opts.series)
              ? opts.series.map(motionSeries)
              : motionSeries(opts.series),
          }
        : {}),
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

  // TODO(handoff): clickable filter and legend consumers still need keyboard action
  // parity; track .planning/phases/13-ui-qualification/13-CANVAS-COVERAGE.md.
  // Stable engine subscriptions read the current callback props, including removal.
  const handleItemClick = (params: unknown) => onItemClick?.(params);
  const handleLegendToggle = (params: unknown) =>
    onLegendToggle?.(params as { name: string; selected: Record<string, boolean> });

  onMount(() => {
    let disposed = false;
    let resizeFrame: number | undefined;
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
      chart.on('click', handleItemClick);
      chart.on('legendselectchanged', handleLegendToggle);

      // ECharts measures the container at init; inside a flex/grid that hasn't
      // laid out yet that can be ~0, leaving the chart rendered tiny. Re-measure
      // after the first frame so it fills its container.
      resizeFrame = requestAnimationFrame(() => {
        if (!disposed) chart?.resize();
      });

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
        chart.on('click', handleItemClick);
        chart.on('legendselectchanged', handleLegendToggle);
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme', 'style'],
      });
    });

    return () => {
      disposed = true;
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      motionQuery.removeEventListener('change', updateMotionPref);
      themeObserver?.disconnect();
      resizeObs?.disconnect();
      chart?.dispatchAction({ type: 'hideTip' });
      chart?.dispose();
      chart = undefined;
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
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Only an overflowing region is focusable, enabling native keyboard scrolling.) -->
      <div
        bind:this={tableViewport}
        class="chart-alt-viewport"
        role={tableOverflows ? 'region' : undefined}
        aria-label={tableOverflows
          ? `${resolvedAriaLabel}: ${m.a11y0_chartDataTable()}`
          : undefined}
        tabindex={tableOverflows ? 0 : undefined}
      >
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
      </div>
    </details>
  {/if}
</div>

<style>
  .chart-a11y-wrap,
  .chart-alt,
  .chart-alt-viewport {
    min-width: 0;
    max-width: 100%;
  }

  .chart-alt-viewport {
    overflow-x: auto;
  }

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
