<script lang="ts">
  import { onMount } from 'svelte';
  import { Button, iconSizes } from '$lib/components/ui';
  import { X } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import {
    interruptedEffects,
    dismissInterruptedEffect,
    discardInterruptedOwner,
    refreshInterruptedEffects,
    sameInterruptionOwner,
    type InterruptionOwner,
  } from '$lib/assistant/interrupted-effects';

  let { owner }: { owner: InterruptionOwner } = $props();
  let previousOwner: InterruptionOwner | undefined;
  $effect(() => {
    if (previousOwner && !sameInterruptionOwner(previousOwner, owner))
      discardInterruptedOwner(previousOwner);
    previousOwner = { ...owner };
  });
  const visible = $derived(
    $interruptedEffects.filter(
      (record) => Date.now() < record.expiresAt && sameInterruptionOwner(record.owner, owner),
    ),
  );
  onMount(() => {
    refreshInterruptedEffects();
    const timer = setInterval(refreshInterruptedEffects, 30_000);
    return () => clearInterval(timer);
  });
</script>

{#each visible as record (record.runId)}
  <div class="interruption-notice" role="status" aria-live="polite">
    <div class="notice-copy">
      <p class="t-label">{m.assistant_interruption_title()}</p>
      <p class="t-caption">
        {#if record.started === 0}
          {m.assistant_interruption_notStarted()}
        {:else if record.confirmed > 0 && (record.unknown > 0 || record.returned > 0)}
          {m.assistant_interruption_partial()}
        {:else if record.unknown > 0}
          {m.assistant_interruption_unknown({ count: record.unknown })}
        {:else if record.confirmed > 0}
          {m.assistant_interruption_confirmed()}
        {:else if record.returned > 0}
          {m.assistant_interruption_returned()}
        {:else}
          {m.assistant_interruption_read()}
        {/if}
      </p>
      <p class="t-caption">{m.assistant_interruption_noReplay()}</p>
    </div>
    <Button
      variant="ghost"
      size="xs"
      aria-label={m.assistant_interruption_dismiss()}
      onclick={() => dismissInterruptedEffect(record.runId, owner)}
    >
      <X size={iconSizes.xs} />
    </Button>
  </div>
{/each}

<style>
  .interruption-notice {
    display: flex;
    align-items: flex-start;
    gap: var(--space-control-gap);
    padding: var(--space-card-compact);
    border: 1px solid var(--color-warning-border);
    border-radius: var(--radius-md);
    background: var(--color-warning-surface);
    color: var(--color-warning-fg);
  }
  .notice-copy {
    min-width: 0;
    flex: 1;
  }
  p {
    margin: 0;
    overflow-wrap: anywhere;
  }
  p + p {
    margin-top: var(--space-1);
  }
</style>
