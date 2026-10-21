<script lang="ts">
  import { onMount } from 'svelte';
  import { Button, iconSizes } from '$lib/components/ui';
  import { Minus, Square, X } from 'lucide-svelte';
  import { toastError } from '$lib/state/ui/toast.svelte';
  import * as m from '$lib/paraglide/messages';
  let native = $state(false);
  onMount(() => {
    native = !!(window as Window & { __MINION_DESKTOP__?: boolean }).__MINION_DESKTOP__;
  });
  async function control(action: 'minimize' | 'toggleMaximize' | 'close') {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow()[action]();
    } catch {
      toastError(m.shell_window_failed());
    }
  }
</script>

{#if native}
  <header class="desktop-titlebar" data-tauri-drag-region>
    <span class="t-label" data-tauri-drag-region>Minion Hub</span>
    <div class="window-actions">
      <Button
        variant="ghost"
        size="sm"
        shape="icon"
        aria-label={m.shell_window_minimize()}
        onclick={() => void control('minimize')}><Minus size={iconSizes.sm} /></Button
      >
      <Button
        variant="ghost"
        size="sm"
        shape="icon"
        aria-label={m.shell_window_maximize()}
        onclick={() => void control('toggleMaximize')}><Square size={iconSizes.sm} /></Button
      >
      <Button
        variant="ghost"
        size="sm"
        shape="icon"
        aria-label={m.shell_window_close()}
        onclick={() => void control('close')}><X size={iconSizes.sm} /></Button
      >
    </div>
  </header>
{/if}

<style>
  .desktop-titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: var(--control-height-lg);
    padding-inline-start: var(--space-4);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    border-bottom: 1px solid var(--color-border);
    user-select: none;
    flex-shrink: 0;
  }
  .window-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
</style>
