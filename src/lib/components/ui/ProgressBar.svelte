<script lang="ts" module>
  import type { Snippet } from 'svelte';

  export type ProgressBarSize = 'sm' | 'md';

  export interface ProgressBarProps {
    /**
     * Current progress. `null` = INDETERMINATE — renders the sweeping bar,
     * never a misleading static fill.
     */
    value: number | null;
    /** Upper bound. Non-positive / non-finite values fall back to 100. */
    max?: number;
    /** Leading meta text (string or snippet for custom typography). */
    label?: string | Snippet;
    /** Trailing meta text — counts, percentage, ETA. */
    detail?: string | Snippet;
    /** `sm` = 4px track / tight gap, `md` = 6px track. */
    size?: ProgressBarSize;
    class?: string;
  }
</script>

<script lang="ts">
  import * as progress from '@zag-js/progress';
  import { useMachine, normalizeProps } from '@zag-js/svelte';

  let {
    value,
    max = 100,
    label,
    detail,
    size = 'md',
    class: cls = '',
  }: ProgressBarProps = $props();

  const uid = $props.id();

  const safeMax = $derived(Number.isFinite(max) && max > 0 ? max : 100);
  // Callers routinely report `processed > total` on the final batch (and the
  // occasional negative from a reset race). zag's progress machine THROWS on
  // value > max — uncaught, which kills client-side navigation. Clamp once,
  // here, for every consumer. See finance-sync.svelte.ts for the original bug.
  const safeValue = $derived(
    value == null || !Number.isFinite(value) ? null : Math.max(0, Math.min(value, safeMax)),
  );
  const pct = $derived(safeValue == null ? 0 : (safeValue / safeMax) * 100);

  const service = useMachine(progress.machine as any, () => ({
    id: uid,
    value: safeValue,
    max: safeMax,
  }));
  const api = $derived(progress.connect(service as unknown as progress.Service, normalizeProps));

  // zag's track carries role="progressbar" + aria-valuemin/max/now already;
  // only the label needs overriding when the caller supplied a real one.
  const trackProps = $derived({
    ...api.getTrackProps(),
    ...(typeof label === 'string' && label ? { 'aria-label': label } : {}),
  });
</script>

<div {...api.getRootProps()} class="prg prg-{size} {cls}">
  {#if label !== undefined || detail !== undefined}
    <div class="prg-meta">
      <span class="prg-label t-caption">
        {#if typeof label === 'function'}{@render label()}{:else}{label ?? ''}{/if}
      </span>
      <span class="prg-detail">
        {#if typeof detail === 'function'}{@render detail()}{:else}{detail ?? ''}{/if}
      </span>
    </div>
  {/if}
  <div {...trackProps} class="prg-track">
    <div
      {...api.getRangeProps()}
      class="prg-range"
      class:indeterminate={safeValue == null}
      class:complete={safeValue != null && pct >= 100}
    ></div>
  </div>
</div>

<style>
  .prg {
    display: flex;
    flex-direction: column;
  }
  .prg-sm {
    gap: var(--space-1);
  }
  .prg-md {
    gap: var(--space-2);
  }
  .prg-meta {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-2);
  }
  .prg-detail {
    font-size: var(--font-size-body);
    font-family: var(--font-mono, monospace);
    color: var(--color-text-secondary);
  }
  .prg-track {
    border-radius: var(--radius-full);
    background: var(--color-surface-3);
    overflow: hidden;
  }
  .prg-sm .prg-track {
    height: 4px;
  }
  .prg-md .prg-track {
    height: 6px;
  }
  .prg-range {
    height: 100%;
    background: var(--color-accent);
    border-radius: var(--radius-full);
    transition: width var(--duration-fast) var(--ease-standard);
  }
  .prg-range.complete {
    background: var(--color-success);
  }
  /* Total unknown (still counting): a sweeping bar, not a misleading static fill. */
  .prg-range.indeterminate {
    width: 40%;
    transition: none;
    animation: prg-indeterminate 1.2s ease-in-out infinite;
  }
  @keyframes prg-indeterminate {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(250%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .prg-range.indeterminate {
      animation: none;
    }
  }
</style>
