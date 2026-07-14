<script lang="ts">
  import { scoreColor } from './crm-format';
  let {
    score,
    r = null,
    f = null,
    m = null,
    bars = true,
  }: {
    score: number;
    r?: number | null;
    f?: number | null;
    m?: number | null;
    bars?: boolean;
  } = $props();

  const color = $derived(scoreColor(score));
  const components = $derived(
    [
      { key: 'R', v: r },
      { key: 'F', v: f },
      { key: 'M', v: m },
    ].filter((c) => c.v != null) as { key: string; v: number }[],
  );
</script>

<div class="wrap">
  <span class="num" style:color>{Math.round(score)}</span>
  {#if bars && components.length > 0}
    <div class="bars" aria-hidden="true">
      {#each components as c (c.key)}
        <div class="bar" title="{c.key} = {c.v}">
          <div
            class="fill"
            style:height="{Math.max(2, Math.min(100, c.v))}%"
            style:background={color}
          ></div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .wrap {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .num {
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    font-size: var(--font-size-page-title);
    min-width: 1.6ch;
    text-align: right;
  }
  .bars {
    display: flex;
    align-items: flex-end;
    gap: var(--space-0-5);
    height: 16px;
  }
  .bar {
    width: 4px;
    height: 100%;
    background: var(--color-muted);
    border-radius: var(--radius-xs);
    display: flex;
    align-items: flex-end;
    overflow: hidden;
  }
  .fill {
    width: 100%;
    border-radius: var(--radius-xs);
    opacity: 0.85;
  }
</style>
