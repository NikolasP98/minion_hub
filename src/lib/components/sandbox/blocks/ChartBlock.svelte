<script lang="ts">
  /** Chart block (spec 049): a preset over the hub's own Chart component. */
  import Chart from '$lib/components/charts/Chart.svelte';
  import { chartColors } from '$lib/utils/chart-colors';
  import { theme } from '$lib/state/ui/theme.svelte';
  import { chartOption } from '$lib/sandbox/blocks/chart-option';
  import { formatAxis, formatValue } from '$lib/sandbox/blocks/format';
  import type { ChartSpec } from '$lib/sandbox/blocks/schema';
  import type { QueryResult } from '../BlockView.svelte';

  interface Props {
    spec: ChartSpec;
    title: string;
    rows: QueryResult;
  }

  let { spec, title, rows }: Props = $props();

  // The palette is resolved to concrete strings (canvas cannot read var());
  // reading the theme state makes it re-resolve on a theme switch.
  const options = $derived.by(() => {
    void theme.presetId;
    void theme.accentId;
    return chartOption(
      spec,
      rows,
      chartColors(),
      (v) => formatAxis(v, spec.format, spec.currency),
      (v) => formatValue(v, spec.format, spec.currency),
    );
  });
</script>

<div class="chart-box">
  <Chart {options} height="100%" ariaLabel={title} />
</div>

<style>
  .chart-box {
    min-height: 0;
    flex: 1;
    padding: var(--space-2) var(--space-2) 0;
  }
</style>
