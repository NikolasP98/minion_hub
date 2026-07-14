<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import { Button } from '$lib/components/ui';

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
  <div class="border-b border-border px-3 py-1 text-xs font-mono text-muted truncate max-w-[180px]">
    {label}
  </div>
  <Button
    variant="ghost"
    size="sm"
    class="w-full px-3 py-1 text-left text-xs font-mono text-foreground hover:bg-accent/10"
    onclick={() => onAction('open')}
  >
    {m.workshop_open()}
  </Button>
  <Button
    variant="ghost"
    size="sm"
    class="w-full px-3 py-1 text-left text-xs font-mono text-foreground hover:bg-accent/10"
    onclick={() => onAction('remove')}
  >
    {m.workshop_removeFromCanvas()}
  </Button>
</div>
