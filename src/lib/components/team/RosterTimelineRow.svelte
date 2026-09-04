<script lang="ts">
  // One person's day track; mirrors the header scroller's offset (no scrollbar of its own).
  import { DAY_PX, type Timeline } from './timeline.svelte';

  let {
    tl,
    employeeId,
    resourceId,
    color,
  }: { tl: Timeline; employeeId: string; resourceId: string | null; color: string } = $props();
</script>

<div class="tl-row" onwheel={(e) => tl.wheel(e)}>
  <div
    class="track"
    style:width="{tl.count * DAY_PX}px"
    style:transform="translateX(-{tl.offset}px)"
  >
    {#each tl.days as d (d.key)}
      {@const lv = tl.leaveAt(employeeId, d.key)}
      {@const n = lv ? 0 : tl.bookingCount(resourceId, d.key)}
      <div class="d" class:today={d.today} class:off={d.off || !!d.holiday} class:ms={d.monthStart}>
        {#if lv}
          <span class="lv {lv.status}" class:first={lv.first} class:last={lv.last}></span>
        {:else if n}
          <span class="cnt" style:--c={color}>{n}</span>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .tl-row {
    width: 100%;
    overflow: hidden;
  }
  .track {
    display: flex;
    will-change: transform;
  }
  .d {
    flex: 0 0 auto;
    width: 2.5rem;
    height: 1.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
  }
  .d.ms {
    border-left: 1px solid var(--color-border-strong);
    border-radius: 0;
  }
  .d.off {
    background: var(--color-surface-2);
  }
  .d.today {
    background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  }
  .cnt {
    min-width: 1.25rem;
    padding: 0 var(--space-1);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--c) 18%, transparent);
    color: var(--c);
    font-size: var(--font-size-telemetry);
    font-weight: 600;
    text-align: center;
    line-height: 1.25rem;
    font-variant-numeric: tabular-nums;
  }
  /* Multi-day leave bar: contiguous across days, rounded only at its true ends. */
  .lv {
    display: block;
    width: 100%;
    height: 0.5rem;
    background: var(--color-success-fg);
  }
  .lv.pending {
    background: var(--color-warning-fg);
    opacity: 0.7;
  }
  .lv.first {
    border-top-left-radius: var(--radius-full);
    border-bottom-left-radius: var(--radius-full);
    margin-left: var(--space-1);
  }
  .lv.last {
    border-top-right-radius: var(--radius-full);
    border-bottom-right-radius: var(--radius-full);
    margin-right: var(--space-1);
  }
</style>
