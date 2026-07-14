<script lang="ts">
  import * as msg from '$lib/paraglide/messages';
  import { scoreColor } from './crm-format';
  import ScoreBadge from './ScoreBadge.svelte';
  let { score, r, f, m }: { score: number; r: number; f: number; m: number } = $props();

  const parts = $derived([
    { k: 'R', label: msg.crm_recency(), v: r, hint: msg.crm_score_recency_hint() },
    { k: 'F', label: msg.crm_frequency(), v: f, hint: msg.crm_score_frequency_hint() },
    { k: 'M', label: msg.crm_score_m_label(), v: m, hint: msg.crm_score_engagement_hint() },
  ]);
</script>

<div class="cell">
  <ScoreBadge {score} {r} {f} {m} />
  <div class="tip" role="tooltip">
    <div class="tip-head">
      <span class="big" style:color={scoreColor(score)}>{Math.round(score)}</span>
      <span class="tip-title">{msg.crm_engagement_score()}</span>
    </div>
    <div class="tip-formula">0.5·R + 0.3·F + 0.2·M</div>
    {#each parts as p (p.k)}
      <div class="tip-row">
        <span class="tip-k" style:color={scoreColor(p.v)}>{p.k}</span>
        <span class="tip-label">{p.label}</span>
        <div class="tip-bar">
          <div
            class="tip-fill"
            style:width="{Math.max(2, Math.min(100, p.v))}%"
            style:background={scoreColor(p.v)}
          ></div>
        </div>
        <span class="tip-val">{p.v}</span>
      </div>
    {/each}
  </div>
</div>

<style>
  .cell {
    position: relative;
    display: inline-flex;
  }
  .tip {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: var(--layer-modal);
    width: 15rem;
    padding: var(--space-2) var(--space-3);
    pointer-events: none;
    background: var(--color-card);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-overlay);
    opacity: 0;
    transform: translateY(-3px);
    transition:
      opacity var(--duration-fast),
      transform var(--duration-fast);
  }
  .cell:hover .tip {
    opacity: 1;
    transform: translateY(0);
  }
  .tip-head {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    margin-bottom: var(--space-0-5);
  }
  .big {
    font-size: var(--font-size-display);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .tip-title {
    font-size: var(--font-size-caption);
    color: var(--color-muted-foreground);
  }
  .tip-formula {
    font-size: var(--font-size-caption);
    color: var(--color-muted-foreground);
    font-family: var(--font-mono, monospace);
    margin-bottom: var(--space-2);
  }
  .tip-row {
    display: grid;
    grid-template-columns: 1rem 1fr 3.5rem 2rem;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-0-5) 0;
  }
  .tip-k {
    font-weight: 700;
    font-size: var(--font-size-caption);
  }
  .tip-label {
    font-size: var(--font-size-caption);
    color: var(--color-muted-foreground);
  }
  .tip-bar {
    height: 5px;
    border-radius: var(--radius-full);
    background: var(--color-muted);
    overflow: hidden;
  }
  .tip-fill {
    height: 100%;
    border-radius: var(--radius-full);
  }
  .tip-val {
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
    text-align: right;
    font-weight: 600;
  }
</style>
