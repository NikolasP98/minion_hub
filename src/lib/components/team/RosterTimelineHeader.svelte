<script lang="ts">
  // The ONE horizontal scroller of the roster timeline (rows mirror its offset).
  import { onMount } from 'svelte';
  import { Tooltip } from '$lib/components/ui';
  import { DAY_PX, type Timeline } from './timeline.svelte';

  let { tl }: { tl: Timeline } = $props();
  let el: HTMLDivElement;
  onMount(() => tl.attach(el));
</script>

<div class="tl-head" bind:this={el} onscroll={() => tl.onScroll()}>
  <!-- Month rail: each month spans its days; the label is sticky to the scroller's
       left edge, so the next month's label slides the current one out of view. -->
  <div class="months" style:width="{tl.count * DAY_PX}px">
    {#each tl.months as mo (mo.key)}
      <div class="mo" style:width="{mo.days * DAY_PX}px">
        <span class="ml">{mo.label}</span>
      </div>
    {/each}
  </div>
  <div class="track" style:width="{tl.count * DAY_PX}px">
    {#each tl.days as d (d.key)}
      <div
        class="d"
        class:today={d.today}
        class:off={d.off}
        class:hol={!!d.holiday}
        class:ms={d.monthStart}
      >
        {#if d.holiday}
          <Tooltip label={d.holiday}>
            <span class="wd">{d.label}</span>
            <span class="n">{d.num}</span>
          </Tooltip>
        {:else}
          <span class="wd">{d.label}</span>
          <span class="n">{d.num}</span>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .tl-head {
    width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
    font-weight: normal;
    text-transform: none;
    letter-spacing: normal;
  }
  .track,
  .months {
    display: flex;
  }
  .mo {
    flex: 0 0 auto;
    display: flex;
    min-width: 0;
  }
  .ml {
    position: sticky;
    left: 0;
    padding: 0 var(--space-1);
    font-size: var(--font-size-telemetry);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-accent);
    white-space: nowrap;
    line-height: 1.2;
  }
  .d {
    flex: 0 0 auto;
    width: 2.5rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
    padding: var(--space-0-5) 0;
    border-radius: var(--radius-sm);
    font-variant-numeric: tabular-nums;
    color: var(--color-text-secondary);
  }
  .d.ms {
    border-left: 1px solid var(--color-border-strong);
    border-radius: 0;
  }
  .d.off,
  .d.hol {
    background: var(--color-surface-2);
  }
  .d.hol {
    color: var(--color-info-fg);
  }
  .d.today {
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    color: var(--color-accent);
  }
  .wd {
    font-size: var(--font-size-telemetry);
    text-transform: uppercase;
    letter-spacing: 0.02em;
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
  }
  .n {
    font-size: var(--font-size-caption);
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .d.today .n {
    color: var(--color-accent);
  }
</style>
