<script lang="ts">
  import { Button } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { formatDate } from '$lib/utils/format';
  import type { CalendarWindowState } from './kit/window-cache.svelte';

  interface Props {
    windows: CalendarWindowState[];
    onretry: (key: string) => void;
  }

  let { windows, onretry }: Props = $props();
  const failed = $derived(windows.filter((window) => window.status === 'error'));

  function dateLabel(key: string): string {
    return formatDate(new Date(`${key}T00:00:00.000Z`), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  function rangeLabel(window: CalendarWindowState): string {
    return `${dateLabel(window.from)} – ${dateLabel(window.to)}`;
  }
</script>

{#if failed.length > 0}
  <div class="issues">
    {#each failed as window (window.key)}
      {@const range = rangeLabel(window)}
      <div class="issue" role="alert" data-window-key={window.key}>
        <span class="message">
          {window.hasData
            ? m.cal_window_refresh_failed({ range })
            : m.cal_window_load_failed({ range })}
        </span>
        <!-- TODO(handoff): UI-002 — on a coarse pointer this Retry is the `sm`
             28px control (measured 56×28 at 390×844 in evidence-ui002); the
             toolbar's 44px floor does not reach it. Governance asks shared
             error/retry controls for the same touch-height check as toolbars. -->
        <Button
          variant="outline"
          size="sm"
          aria-label={m.cal_window_retry({ range })}
          onclick={() => onretry(window.key)}>{m.common_retry()}</Button
        >
      </div>
    {/each}
  </div>
{/if}

<style>
  .issues {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .issue {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-danger-border);
    border-radius: var(--radius-md);
    background: var(--color-danger-surface);
    color: var(--color-danger-fg);
  }

  .message {
    min-width: 0;
    font-size: var(--font-size-caption);
  }

  @media (max-width: 640px) {
    .issue {
      align-items: flex-start;
      flex-wrap: wrap;
    }
  }
</style>
