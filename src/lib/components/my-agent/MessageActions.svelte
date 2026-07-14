<script lang="ts">
  import { Button } from '$lib/components/ui';

  import type { LucideIcon } from '$lib/nav/routes';
  import { Check } from 'lucide-svelte';

  export interface MessageAction {
    icon: LucideIcon;
    label: string;
    onclick: () => void;
    /** Show a transient check after click (e.g. copy confirmation). */
    confirm?: boolean;
  }

  // Horizontal, icon-only action row placed directly under a message bubble
  // (Claude-style): no resting background, native tooltip on hover.
  const { actions }: { actions: MessageAction[] } = $props();

  let doneIdx = $state<number | null>(null);
  let doneTimer: ReturnType<typeof setTimeout> | null = null;

  function run(a: MessageAction, i: number) {
    a.onclick();
    if (a.confirm) {
      doneIdx = i;
      if (doneTimer) clearTimeout(doneTimer);
      doneTimer = setTimeout(() => (doneIdx = null), 1400);
    }
  }
</script>

<div class="acts">
  {#each actions as a, i (i)}
    <Button
      type="button"
      class="act"
      title={a.label}
      aria-label={a.label}
      onclick={() => run(a, i)}
    >
      {#if doneIdx === i && a.confirm}
        <Check size={14} />
      {:else}
        <a.icon size={14} />
      {/if}
    </Button>
  {/each}
</div>

<style>
  .acts {
    display: flex;
    gap: 1px;
    margin-top: 1px;
  }
  :global(.act) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: color-mix(in srgb, var(--color-foreground) 42%, transparent);
    cursor: pointer;
    transition:
      color var(--duration-fast) ease,
      background var(--duration-fast) ease;
  }
  :global(.act):hover {
    color: var(--color-foreground);
    background: color-mix(in srgb, var(--color-foreground) 8%, transparent);
  }
</style>
