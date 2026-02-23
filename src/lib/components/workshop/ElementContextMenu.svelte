<script lang="ts">
  import { onMount } from 'svelte';

  let {
    label,
    x,
    y,
    onClose,
    onAction,
  }: {
    label: string;
    x: number;
    y: number;
    onClose: () => void;
    onAction: (action: string) => void;
  } = $props();

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.element-context-menu')) {
      onClose();
    }
  }

  onMount(() => {
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  });
</script>

<div
  class="element-context-menu fixed z-[900] min-w-[120px] rounded border border-border bg-bg2 py-1 shadow-lg"
  style="left: {x}px; top: {y}px;"
>
  <div class="border-b border-border px-3 py-1 text-[10px] font-mono text-muted truncate max-w-[180px]">
    {label}
  </div>
  <button
    class="w-full px-3 py-1 text-left text-[10px] font-mono text-foreground hover:bg-accent/10"
    onclick={() => onAction('open')}
  >
    Open
  </button>
  <button
    class="w-full px-3 py-1 text-left text-[10px] font-mono text-foreground hover:bg-accent/10"
    onclick={() => onAction('remove')}
  >
    Remove from canvas
  </button>
</div>
