<script lang="ts">
  /**
   * Intent-choice chips the assistant asks through `ui.choice` ("Show me how"
   * vs "Do it for me"). Picking one sends it as the user's next turn through
   * the surface's own send path. Also shows the last actions the assistant
   * took (navigate / fill / guide) as a quiet trail.
   */
  import { Button } from '$lib/components/ui';
  import { guide, clearChoice } from '$lib/assistant/guide.svelte';

  interface Props {
    onPick: (text: string) => void;
    compact?: boolean;
  }
  const { onPick, compact = false }: Props = $props();

  function pick(label: string, value?: string) {
    clearChoice();
    onPick(value?.trim() || label);
  }
</script>

{#if guide.choice}
  <div class="choice" class:compact data-assist="assistant.choice">
    <div class="q">{guide.choice.question}</div>
    <div class="opts">
      {#each guide.choice.options as o (o.label)}
        <Button variant="secondary" size="xs" type="button" onclick={() => pick(o.label, o.value)}
          >{o.label}</Button
        >
      {/each}
    </div>
  </div>
{/if}

<style>
  .choice {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border-top: 1px solid var(--color-border);
    background: var(--color-surface-2);
  }
  .choice.compact {
    padding: var(--space-1) var(--space-2);
  }
  .q {
    font-size: var(--font-size-label);
    color: var(--color-foreground);
  }
  .opts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
</style>
