<script lang="ts">
  import {
    workshopState,
    addPinboardItem,
    removePinboardItem,
  } from '$lib/state/workshop.svelte';

  let {
    elementId,
    onClose,
  }: {
    elementId: string;
    onClose: () => void;
  } = $props();

  let newPinContent = $state('');

  let element = $derived(workshopState.elements[elementId]);
  let pins = $derived(element?.pinboardItems ?? []);

  function handleAdd() {
    const trimmed = newPinContent.trim();
    if (!trimmed) return;
    addPinboardItem(elementId, trimmed, 'user');
    newPinContent = '';
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAdd();
    }
  }

  function formatRelativeTime(ts: number): string {
    const diff = Date.now() - ts;
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40"
  onclick={handleBackdropClick}
>
  <div class="w-full max-w-md rounded-lg border border-border bg-bg2 shadow-xl">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-border px-4 py-2">
      <span class="text-[10px] font-mono text-foreground font-semibold">Pinboard</span>
      <button
        class="text-[10px] font-mono text-muted hover:text-foreground"
        onclick={onClose}
      >
        x
      </button>
    </div>

    <!-- Pin list -->
    <div class="max-h-[300px] overflow-y-auto p-3 space-y-2">
      {#each pins as pin (pin.id)}
        <div class="flex items-start gap-2 rounded border border-border bg-bg3 p-2">
          <div class="flex-1 min-w-0">
            <div class="text-[10px] font-mono text-foreground break-words">{pin.content}</div>
            <div class="mt-1 text-[9px] font-mono text-muted">
              by {pin.pinnedBy} &middot; {formatRelativeTime(pin.pinnedAt)}
            </div>
          </div>
          <button
            class="shrink-0 text-[10px] font-mono text-muted hover:text-foreground"
            onclick={() => removePinboardItem(elementId, pin.id)}
          >
            x
          </button>
        </div>
      {:else}
        <div class="text-center text-[10px] font-mono text-muted py-4">No pins yet</div>
      {/each}
    </div>

    <!-- Add pin -->
    <div class="flex items-center gap-2 border-t border-border px-3 py-2">
      <input
        type="text"
        class="flex-1 rounded border border-border bg-bg3 px-2 py-1 text-[10px] font-mono text-foreground placeholder:text-muted outline-none focus:border-accent"
        placeholder="Add a pin..."
        bind:value={newPinContent}
        onkeydown={handleKeydown}
      />
      <button
        class="shrink-0 rounded bg-accent/10 px-2 py-1 text-[10px] font-mono text-accent hover:bg-accent/20 disabled:opacity-40"
        onclick={handleAdd}
        disabled={!newPinContent.trim()}
      >
        Pin
      </button>
    </div>
  </div>
</div>
