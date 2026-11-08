<script lang="ts">
  /** KPI tile (spec 049): one number, optional delta chip, sparkline and goal bar. */
  import { Chip, ProgressBar } from '$lib/components/ui';
  import Sparkline from '$lib/components/charts/Sparkline.svelte';
  import { formatDelta, formatValue, toNumber } from '$lib/sandbox/blocks/format';
  import { VALUE } from '$lib/sandbox/blocks/query';
  import type { KpiSpec, Tone } from '$lib/sandbox/blocks/schema';
  import type { QueryResult } from '../BlockView.svelte';
  import * as m from '$lib/paraglide/messages';

  interface Props {
    spec: KpiSpec;
    value: QueryResult;
    compare?: QueryResult;
    trend?: QueryResult;
  }

  let { spec, value, compare, trend }: Props = $props();

  // Status tones map to the status-fg tokens; accent/neutral to their own roles
  // (governance: a tone is a semantic token, never a raw colour).
  const TONE_COLOR: Record<Tone, string> = {
    accent: 'var(--color-accent)',
    info: 'var(--color-info-fg)',
    success: 'var(--color-success-fg)',
    warning: 'var(--color-warning-fg)',
    danger: 'var(--color-danger-fg)',
    neutral: 'var(--color-text-secondary)',
  };

  const n = $derived(toNumber(value.rows[0]?.[VALUE]));
  const text = $derived(formatValue(n, spec.format, spec.currency));
  const delta = $derived(compare ? formatDelta(n, compare.rows[0]?.[VALUE]) : null);
  const deltaStatus = $derived(
    delta?.startsWith('+') ? 'success' : delta?.startsWith('-') ? 'danger' : undefined,
  );
  const bins = $derived((trend?.rows ?? []).map((row) => toNumber(row[VALUE]) ?? 0));
  const color = $derived(TONE_COLOR[spec.tone]);
</script>

<div class="kpi">
  <span class="kpi-value t-display" style:color={color}>
    {text}{#if spec.unit}<span class="kpi-unit t-caption">{spec.unit}</span>{/if}
  </span>
  {#if delta}
    <span class="kpi-delta">
      <Chip status={deltaStatus}>{delta}</Chip>
      <span class="t-caption kpi-muted">{m.sandbox_block_vs_previous()}</span>
    </span>
  {/if}
  {#if spec.target !== undefined && n !== null}
    <ProgressBar
      value={n}
      max={spec.target}
      size="sm"
      detail={m.sandbox_block_of_target({
        target: formatValue(spec.target, spec.format, spec.currency),
      })}
    />
  {/if}
  {#if bins.length > 1}
    <div class="kpi-trend"><Sparkline {bins} {color} /></div>
  {/if}
</div>

<style>
  .kpi {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
  }
  .kpi-value {
    overflow: hidden;
    font-variant-numeric: tabular-nums;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .kpi-unit {
    margin-left: var(--space-1);
    color: var(--color-text-secondary);
  }
  .kpi-delta {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .kpi-muted {
    color: var(--color-text-tertiary);
  }
  .kpi-trend {
    margin-top: auto;
  }
</style>
