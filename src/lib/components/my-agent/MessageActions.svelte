<script lang="ts">
  import { iconSizes, Button } from '$lib/components/ui';

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
  // `reveal` (SmoothUI `ai-message`, MIT): the row stays MOUNTED — mounting on
  // hover changed its height and every message below jumped — and fades in when
  // the enclosing `.ai-message` is hovered OR holds keyboard focus, sliding out
  // from the bubble's own edge (`side`). Always visible on touch (no hover).
  const {
    actions,
    reveal = false,
    side = 'start',
  }: { actions: MessageAction[]; reveal?: boolean; side?: 'start' | 'end' } = $props();

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

<div class="acts" class:reveal data-side={side}>
  {#each actions as a, i (i)}
    <Button
      type="button"
      class="act"
      title={a.label}
      aria-label={a.label}
      aria-pressed={a.confirm ? doneIdx === i : undefined}
      style="--i: {i}"
      onclick={() => run(a, i)}
    >
      {#if doneIdx === i && a.confirm}
        <span class="pop"><Check size={iconSizes.sm} /></span>
      {:else}
        <a.icon size={iconSizes.sm} />
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
  .acts :global(.act) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: var(--control-height-xs);
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
  .acts :global(.act):hover {
    color: var(--color-foreground);
    background: color-mix(in srgb, var(--color-foreground) 8%, transparent);
  }
  .acts.reveal :global(.act) {
    --slide: calc(var(--space-1) * -1.5);
    opacity: 0;
    transform: translateX(var(--slide)) scale(0.9);
    transition:
      opacity var(--duration-normal) var(--ease-standard),
      transform var(--duration-normal) var(--ease-standard),
      color var(--duration-fast) ease,
      background var(--duration-fast) ease;
    transition-delay: calc(var(--duration-instant) * 0.4 * var(--i));
  }
  .acts.reveal[data-side='end'] :global(.act) {
    --slide: calc(var(--space-1) * 1.5);
  }
  :global(.ai-message:hover) .acts.reveal :global(.act),
  :global(.ai-message:focus-within) .acts.reveal :global(.act) {
    opacity: 1;
    transform: none;
  }
  @media (hover: none) {
    .acts.reveal :global(.act) {
      opacity: 1;
      transform: none;
    }
  }
  .pop {
    display: inline-flex;
    animation: msg-act-pop var(--duration-normal) var(--ease-standard);
  }
  @keyframes msg-act-pop {
    45% {
      transform: scale(1.25);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .acts.reveal :global(.act) {
      transform: none;
      transition-delay: 0s;
    }
    .pop {
      animation: none;
    }
  }
</style>
