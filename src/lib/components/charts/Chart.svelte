<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    EChartsOption,
    ECharts,
    SeriesOption,
    LineSeriesOption,
    BarSeriesOption,
  } from 'echarts';
  import { Button } from '@minion-stack/ui';
  import * as m from '$lib/paraglide/messages';
  import { formatDate } from '$lib/utils/format';

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
     *  data-table disclosure's caption. Required: say what the chart shows
     *  (e.g. "Monthly customer-sentiment trend"), translated. */
    ariaLabel: string;
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

  const resolvedAriaLabel = $derived(ariaLabel);
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

  /** One cell of the data table. `item` is what a click on the same mark hands to
   *  `onItemClick`; with a handler the cell is a button that does the same. */
  type AltCell = { text: string | number; item?: Record<string, unknown>; label?: string };
  type AltTable = { head: string[]; rows: AltCell[][]; total?: number };
  const MAX_POINT_ROWS = 200;

  const seriesList = $derived(
    Array.isArray(options.series) ? options.series : options.series ? [options.series] : [],
  );
  /** A series name as the legend shows it: a chart may keep a stable id as the name and give
   *  the visible label through `legend.formatter`. */
  function shownName(name: string): string {
    const legend = Array.isArray(options.legend) ? options.legend[0] : options.legend;
    const formatter = (legend as { formatter?: unknown } | undefined)?.formatter;
    if (typeof formatter === 'string') return formatter.replace('{name}', name);
    if (typeof formatter === 'function') {
      try {
        const text: unknown = formatter(name);
        if (typeof text === 'string' && text.trim()) return text;
      } catch {
        /* a broken formatter must not hide the series */
      }
    }
    return name;
  }
  // An unnamed series is "Value" when it is the only one (the chart's own name says what it
  // measures) and numbered when there are several.
  const nameOf = (item: SeriesOption, index: number) =>
    typeof item.name === 'string' && item.name.trim()
      ? shownName(item.name)
      : seriesList.length === 1
        ? m.chart_table_value()
        : m.a11y0_chartSeriesN({ index: index + 1 });

  // TODO(handoff): dataset/encode, mixed category axes and chart kinds without a builder
  // below (radar, gauge, graph, treemap: none in use) still get no table; never infer a
  // misleading one. Root tracks consumer completion in
  // .planning/phases/13-ui-qualification/13-CANVAS-COVERAGE.md.
  const accessibleTable = $derived.by((): AltTable | null => {
    const series = seriesList;
    if (!series.length) return null;
    if (series.every((item) => item.type === 'pie')) return pieTable();
    if (series.length === 1 && series[0].type === 'sankey') return sankeyTable();
    if (series.every((item) => item.type === 'scatter')) return scatterTable();
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
      head: [resolvedCategoryLabel, ...cartesian.map(nameOf)],
      rows: categories.map((category, index) => {
        const label = formatAxis(categoryAxis, category!, index);
        return [
          { text: label },
          ...cartesian.map((item, seriesIndex): AltCell => {
            const raw = pointValue(Array.isArray(item.data) ? item.data[index] : null);
            if (raw === null || raw === '-') return { text: '—' };
            const text = formatAxis(
              axisAt(
                horizontal ? options.xAxis : options.yAxis,
                horizontal ? item.xAxisIndex : item.yAxisIndex,
              ),
              raw,
              index,
            );
            const seriesName = nameOf(item, seriesIndex);
            return {
              text,
              label: `${seriesName}, ${label}: ${text}`,
              item: {
                componentType: 'series',
                seriesType: item.type,
                seriesIndex,
                seriesName: item.name,
                name: String(category),
                dataIndex: index,
                value: raw,
              },
            };
          }),
        ];
      }),
    };
  });

  function pieTable(): AltTable | null {
    if (seriesList.length !== 1) return null;
    const item = seriesList[0];
    if (item.type !== 'pie' || !Array.isArray(item.data)) return null;
    const slices = item.data.map((point) => ({
      name: point && typeof point === 'object' && 'name' in point ? String(point.name ?? '') : '',
      value: pointValue(point),
    }));
    if (slices.some((slice) => !slice.name || typeof slice.value !== 'number')) return null;
    const total = slices.reduce((sum, slice) => sum + (slice.value as number), 0);
    return {
      head: [resolvedCategoryLabel, nameOf(item, 0), m.chart_table_share()],
      rows: slices.map((slice, dataIndex) => {
        const percent = total ? Math.round(((slice.value as number) / total) * 1000) / 10 : 0;
        return [
          {
            text: slice.name,
            label: `${slice.name}: ${slice.value}`,
            item: {
              componentType: 'series',
              seriesType: 'pie',
              seriesIndex: 0,
              seriesName: item.name,
              name: slice.name,
              dataIndex,
              value: slice.value,
              percent,
            },
          },
          { text: slice.value as number },
          { text: `${percent}%` },
        ];
      }),
    };
  }

  function sankeyTable(): AltTable | null {
    const item = seriesList[0] as SeriesOption & {
      links?: unknown;
      edges?: unknown;
      label?: { formatter?: unknown };
    };
    const links = (item.links ?? item.edges) as
      { source?: unknown; target?: unknown; value?: unknown }[] | undefined;
    if (!Array.isArray(links) || !links.length) return null;
    if (links.some((link) => typeof link.source !== 'string' || typeof link.target !== 'string'))
      return null;
    // A node's visible text is its label formatter's, when the caller set one.
    const shown = (name: string): string => {
      const formatter = item.label?.formatter;
      if (typeof formatter === 'function') {
        try {
          const text: unknown = formatter({ name, dataType: 'node' });
          if (typeof text === 'string' && text.trim()) return text;
        } catch {
          /* fall through to the raw name */
        }
      }
      return name;
    };
    const node = (name: string): AltCell => ({
      text: shown(name),
      label: shown(name),
      item: { componentType: 'series', seriesType: 'sankey', dataType: 'node', name },
    });
    return {
      head: [m.chart_table_from(), m.chart_table_to(), m.chart_table_value()],
      rows: links.map((link) => [
        node(link.source as string),
        node(link.target as string),
        { text: pointValue(link.value) ?? '—' },
      ]),
    };
  }

  function scatterTable(): AltTable | null {
    const rows: AltCell[][] = [];
    let total = 0;
    for (const [seriesIndex, item] of seriesList.entries()) {
      if (item.type !== 'scatter' || !Array.isArray(item.data) || item.encode) return null;
      if (item.coordinateSystem !== undefined && item.coordinateSystem !== 'cartesian2d')
        return null;
      const xAxis = axisAt(options.xAxis, item.xAxisIndex);
      const yAxis = axisAt(options.yAxis, item.yAxisIndex);
      const seriesName = nameOf(item, seriesIndex);
      for (const [dataIndex, point] of item.data.entries()) {
        const tuple =
          point && typeof point === 'object' && !Array.isArray(point) && 'value' in point
            ? point.value
            : point;
        if (!Array.isArray(tuple) || tuple.length < 2) return null;
        total += 1;
        if (rows.length >= MAX_POINT_ROWS) continue;
        const pointName =
          point && typeof point === 'object' && !Array.isArray(point) && 'name' in point
            ? String(point.name ?? '')
            : '';
        const cell = (axis: Axis | undefined, value: unknown) => {
          let plain = pointValue(value);
          if (plain === null) return '—';
          // On a category axis a number is the position of the category, not a value.
          if (axis?.type === 'category' && typeof plain === 'number')
            plain = pointValue(axis.data?.[plain]) ?? plain;
          if (axis?.type === 'time' && typeof axis.axisLabel?.formatter !== 'function')
            return formatDate(plain, { dateStyle: 'medium', timeStyle: 'short' });
          return formatAxis(axis, plain, dataIndex);
        };
        const x = cell(xAxis, tuple[0]);
        const y = cell(yAxis, tuple[1]);
        const first = pointName ? `${seriesName}: ${pointName}` : seriesName;
        rows.push([
          {
            text: first,
            label: `${first}, ${x}, ${y}`,
            item: {
              componentType: 'series',
              seriesType: 'scatter',
              seriesIndex,
              seriesName: item.name,
              name: pointName,
              dataIndex,
              value: tuple,
              data: point,
            },
          },
          { text: x },
          { text: y },
        ]);
      }
    }
    if (!rows.length) return null;
    const axisName = (axes: EChartsOption['xAxis'] | EChartsOption['yAxis'], fallback: string) => {
      const name = (axisAt(axes) as { name?: unknown } | undefined)?.name;
      return typeof name === 'string' && name.trim() ? name : fallback;
    };
    return {
      head: [
        m.chart_table_series(),
        axisName(options.xAxis, m.chart_table_x()),
        axisName(options.yAxis, m.chart_table_y()),
      ],
      rows,
      total,
    };
  }

  // The legend's keyboard twin: one toggle per legend entry, shown while it has focus.
  const legendNames = $derived.by((): string[] => {
    const legend = Array.isArray(options.legend) ? options.legend[0] : options.legend;
    if (!legend || legend.show === false) return [];
    const listed = (legend as { data?: unknown[] }).data;
    const names = Array.isArray(listed)
      ? listed.map((entry) =>
          typeof entry === 'string' ? entry : (entry as { name?: unknown } | null)?.name,
        )
      : seriesList.length === 1 && seriesList[0].type === 'pie' && Array.isArray(seriesList[0].data)
        ? seriesList[0].data.map((point) =>
            point && typeof point === 'object' && 'name' in point ? point.name : undefined,
          )
        : seriesList.map((item) => item.name);
    return [...new Set(names.filter((name): name is string => typeof name === 'string' && !!name))];
  });
  let hiddenSeries = $state<Record<string, boolean>>({});
  $effect(() => {
    const legend = Array.isArray(options.legend) ? options.legend[0] : options.legend;
    const selected = (legend as { selected?: Record<string, boolean> } | undefined)?.selected;
    hiddenSeries = Object.fromEntries(
      Object.entries(selected ?? {}).map(([name, on]) => [name, !on]),
    );
  });
  function toggleSeries(name: string) {
    // The engine answers with `legendselectchanged`, the same event a legend click sends.
    chart?.dispatchAction({ type: 'legendToggleSelect', name });
  }

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

  // Stable engine subscriptions read the current callback props, including removal.
  const handleItemClick = (params: unknown) => onItemClick?.(params);
  const handleLegendToggle = (params: unknown) => {
    const event = params as { name: string; selected: Record<string, boolean> };
    hiddenSeries = Object.fromEntries(
      Object.entries(event.selected ?? {}).map(([name, on]) => [name, !on]),
    );
    onLegendToggle?.(event);
  };

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

{#snippet altCell(cell: AltCell)}
  {#if onItemClick && cell.item}
    <Button
      variant="ghost"
      size="xs"
      aria-label={cell.label}
      onclick={() => onItemClick?.(cell.item)}>{cell.text}</Button
    >
  {:else}
    {cell.text}
  {/if}
{/snippet}

<div class="chart-a11y-wrap">
  <div class="chart-box">
    <div
      bind:this={container}
      class={className}
      style="width:100%;height:{height};{style}"
      data-dense
      role="img"
      aria-label={resolvedAriaLabel}
    ></div>
    {#if legendNames.length}
      <!-- Keyboard twin of the canvas legend: out of sight until it has focus. -->
      <div class="chart-series" role="group" aria-label={m.chart_series_toggle()}>
        {#each legendNames as name (name)}
          <Button
            variant="secondary"
            size="xs"
            aria-pressed={!hiddenSeries[name]}
            onclick={() => toggleSeries(name)}>{shownName(name)}</Button
          >
        {/each}
      </div>
    {/if}
  </div>
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
              {#each accessibleTable.head as column, i (i)}
                <th scope="col">{column}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each accessibleTable.rows as row, i (i)}
              <tr>
                {#each row as cell, ci (ci)}
                  {#if ci === 0}
                    <th scope="row">{@render altCell(cell)}</th>
                  {:else}
                    <td>{@render altCell(cell)}</td>
                  {/if}
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
        {#if accessibleTable.total && accessibleTable.total > accessibleTable.rows.length}
          <p class="t-caption">
            {m.chart_table_truncated({
              shown: accessibleTable.rows.length,
              total: accessibleTable.total,
            })}
          </p>
        {/if}
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

  .chart-box {
    position: relative;
  }

  .chart-series {
    position: absolute;
    inset: auto 0 0 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    padding: var(--space-1);
    background: var(--color-surface-1);
    border-top: 1px solid var(--color-border-subtle);
  }

  .chart-series:not(:focus-within) {
    width: 1px;
    height: 1px;
    padding: 0;
    border: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .chart-series :global([aria-pressed='false']) {
    color: var(--color-text-secondary);
    text-decoration: line-through;
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
