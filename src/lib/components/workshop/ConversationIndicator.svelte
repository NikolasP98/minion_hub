<script lang="ts">
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

<button
  class="conversation-indicator absolute z-30 pointer-events-auto flex items-center justify-center w-7 h-7 rounded-full border cursor-pointer transition-all duration-150
    {type === 'task' ? 'border-accent bg-accent/15 hover:border-accent hover:bg-accent/25' : 'border-purple-500 bg-purple-500/15 hover:border-purple-400 hover:bg-purple-500/25'}"
  style="left: {x}px; top: {y}px; transform: translate(-50%, -50%);"
  {onclick}
  aria-label="Open {type} conversation"
>
  <svg
    class="w-3.5 h-3.5 {type === 'task' ? 'text-accent' : 'text-purple-400'}"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
  <span class="pulse-dot absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-500"></span>
</button>

<style>
  .conversation-indicator {
    animation: scale-in 200ms ease-out;
  }

  .conversation-indicator:hover {
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
    0%, 100% {
      opacity: 1;
      box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.5);
    }
    50% {
      opacity: 0.7;
      box-shadow: 0 0 0 3px rgba(34, 197, 94, 0);
    }
  }
</style>
