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
  .track {
    display: flex;
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
    letter-spacing: 0.04em;
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
