<script lang="ts">
  import { Button } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';

  let {
    x,
    y,
    type,
    onclick,
  }: {
    x: number;
    y: number;
    type: 'task' | 'banter';
    onclick: () => void;
  } = $props();
</script>

<Button
  variant="ghost"
  class="conversation-indicator absolute z-[var(--layer-dropdown)] pointer-events-auto flex items-center justify-center w-7 h-7 rounded-full border cursor-pointer transition-all duration-[var(--duration-fast)]
    {type === 'task'
    ? 'border-accent bg-accent/15 hover:border-accent hover:bg-accent/25'
    : 'border-border bg-bg3/70 hover:border-muted-strong hover:bg-bg3'}"
  style="left: {x}px; top: {y}px; transform: translate(-50%, -50%);"
  {onclick}
  aria-label={m.workshop_openConversation({ type })}
>
  <svg
    class="w-3.5 h-3.5 {type === 'task' ? 'text-accent' : 'text-muted-strong'}"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
  <span
    class="pulse-dot absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[var(--color-success-surface)]"
  ></span>
</Button>

<style>
  :global(.conversation-indicator) {
    animation: scale-in var(--duration-normal) var(--ease-exit);
  }

  :global(.conversation-indicator:hover) {
    transform: translate(-50%, -50%) scale(1.12);
  }

  .pulse-dot {
    animation: pulse-glow 2s ease-in-out infinite;
  }

  @keyframes scale-in {
    0% {
      opacity: 0;
      transform: translate(-50%, -50%) scale(0);
    }
    100% {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
  }

  @keyframes pulse-glow {
    0%,
    100% {
      opacity: 1;
      box-shadow: var(--shadow-elevation-1);
    }
    50% {
      opacity: 0.7;
      box-shadow: var(--shadow-elevation-1);
    }
  }
</style>
