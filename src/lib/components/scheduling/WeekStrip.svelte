<script lang="ts">
  import { ChevronLeft, ChevronRight } from 'lucide-svelte';
  import { Button, iconSizes } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { formatDate } from '$lib/utils/format';
  import { dateKeyAddDays } from '$lib/time/zoned';
  import { mondayOf } from './runway';

  /** Phone week strip: the Monday–Sunday of the week holding `date`. Pure
   *  presentation — the host decides what a day tap or a week step does. */
  let {
    date,
    today,
    onday,
    onweek,
  }: {
    /** Selected day, `YYYY-MM-DD`. */
    date: string;
    today: string;
    onday: (day: string) => void;
    onweek: (dir: -1 | 1) => void;
  } = $props();

  const fmt = (key: string, opts: Intl.DateTimeFormatOptions) =>
    formatDate(new Date(`${key}T12:00:00.000Z`), { ...opts, timeZone: 'UTC' });

  const days = $derived.by(() => {
    const monday = mondayOf(date);
    return Array.from({ length: 7 }, (_, i) => {
      const key = dateKeyAddDays(monday, i) ?? monday;
      const isToday = key === today;
      const long = fmt(key, { weekday: 'long', day: 'numeric', month: 'long' });
      return {
        key,
        letter: fmt(key, { weekday: 'narrow' }),
        num: Number(key.slice(8, 10)),
        isToday,
        // Today is named, not only ringed.
        name: isToday ? `${long}, ${m.cal_strip_today()}` : long,
      };
    });
  });
</script>

<div class="strip">
  <Button
    variant="ghost"
    size="sm"
    shape="icon"
    aria-label={m.cal_strip_prev_week()}
    onclick={() => onweek(-1)}
  >
    <ChevronLeft size={iconSizes.md} />
  </Button>
  <div class="days">
    {#each days as day (day.key)}
      <Button
        variant="ghost"
        size="sm"
        class="ws-day {day.key === date ? 'is-selected' : ''} {day.isToday ? 'is-today' : ''}"
        aria-current={day.key === date ? 'date' : undefined}
        onclick={() => onday(day.key)}
      >
        <span class="ws-letter" aria-hidden="true">{day.letter}</span>
        <span class="ws-num" aria-hidden="true">{day.num}</span>
        <span class="sr-only">{day.name}</span>
      </Button>
    {/each}
  </div>
  <Button
    variant="ghost"
    size="sm"
    shape="icon"
    aria-label={m.cal_strip_next_week()}
    onclick={() => onweek(1)}
  >
    <ChevronRight size={iconSizes.md} />
  </Button>
</div>

<style>
  .strip {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    height: calc(var(--control-height-touch) + var(--space-3));
    padding: 0 var(--space-2);
  }
  .days {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: var(--space-0-5);
  }
  /* Forwarded classes on the shared Button ⇒ :global under a scoped ancestor;
     the primitive's inner row span needs its own rule to stack letter over number. */
  .days :global(.ws-day) {
    min-height: var(--control-height-touch);
    height: auto;
    padding: 0;
  }
  .days :global(.ws-day > span) {
    flex-direction: column;
    gap: 0;
    height: auto;
    line-height: 1.1;
  }
  .ws-letter {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
  }
  .ws-num {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .days :global(.ws-day.is-today) {
    outline: 1px solid var(--color-accent);
    outline-offset: -1px;
  }
  .days :global(.ws-day.is-selected) {
    background: color-mix(in srgb, var(--color-accent) 14%, transparent);
    color: var(--color-text-primary);
  }
  .days :global(.ws-day.is-selected .ws-letter) {
    color: inherit;
  }
  /* Landscape phone: the strip is the first thing to give up its height. Same
     idea as the (max-height: 500px) arm of `phone` in state/ui/phone.svelte.ts. */
  @media (max-height: 500px) {
    .strip {
      display: none;
    }
  }
</style>
