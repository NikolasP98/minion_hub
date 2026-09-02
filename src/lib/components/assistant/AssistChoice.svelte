<script lang="ts">
  /**
   * Intent-choice buttons the assistant asks through `ui.choice`, rendered
   * INSIDE the assistant bubble that asked (MarkdownMessage). Picking one sends
   * the button's label as the user's next turn — natural text, never a token —
   * through the surface's own send path. One-shot per message.
   */
  import { Button } from '$lib/components/ui';
  import type { ChoiceOption } from '$lib/assistant/guide.svelte';

  interface Props {
    question: string;
    options: ChoiceOption[];
    onPick?: (text: string) => void;
  }
  const { question, options, onPick }: Props = $props();
  let picked = $state<string | null>(null);

  function pick(o: ChoiceOption) {
    if (picked || !onPick) return;
    picked = o.label;
    onPick(o.label);
  }
</script>

<div class="choice" data-assist="assistant.choice">
  {#if question}<p class="q">{question}</p>{/if}
  <div class="opts">
    {#each options as o (o.label)}
      <Button
        variant={picked === o.label ? 'primary' : 'secondary'}
        size="xs"
        type="button"
        disabled={!onPick || (!!picked && picked !== o.label)}
        onclick={() => pick(o)}>{o.label}</Button
      >
    {/each}
  </div>
</div>

<style>
  .choice {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-top: var(--space-1);
  }
  .q {
    margin: 0;
    font-size: var(--font-size-label);
  }
  .opts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
</style>
