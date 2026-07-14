<script lang="ts">
  /**
   * 7-day weekly hours editor (Sun–Sat): one row per weekday with an enable
   * toggle and start/end times. Parent owns the `week` model + persistence;
   * shared by the resource AvailabilityEditor and the per-service schedule in
   * EventTypeEditor.
   */
  import * as m from '$lib/paraglide/messages';

  type DayState = { enabled: boolean; start: string; end: string };
  let { week = $bindable() }: { week: DayState[] } = $props();

  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
</script>

<div class="week">
  {#each week as d, i (i)}
    <div class="day-row">
      <label class="day-toggle">
        <input type="checkbox" bind:checked={d.enabled} />
        <span>{DAY_LABELS[i]}</span>
      </label>
      {#if d.enabled}
        <input type="time" bind:value={d.start} class="time-in" aria-label={m.sched_start()} />
        <span class="dash">–</span>
        <input type="time" bind:value={d.end} class="time-in" aria-label={m.sched_end()} />
      {:else}
        <span class="t-caption off">—</span>
      {/if}
    </div>
  {/each}
</div>

<style>
  .week {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .day-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 28px;
  }
  .day-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    width: 64px;
    font-size: var(--font-size-body);
    cursor: pointer;
  }
  .time-in {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    padding: var(--space-0-5) var(--space-2);
    background: var(--color-card);
    font-size: var(--font-size-body);
  }
  .dash {
    color: var(--color-muted-foreground);
  }
  .off {
    opacity: 0.5;
  }
</style>
