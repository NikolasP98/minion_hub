<script lang="ts">
  import { untrack } from 'svelte';
  import {
    workshopState,
    setMessageBoardContent,
  } from '$lib/state/workshop.svelte';

  let {
    elementId,
    onClose,
  }: {
    elementId: string;
    onClose: () => void;
  } = $props();

  let content = $state(untrack(() => workshopState.elements[elementId]?.messageBoardContent ?? ''));

  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  function handleInput() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      setMessageBoardContent(elementId, content);
    }, 500);
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      // Flush pending save before closing
      if (saveTimer) {
        clearTimeout(saveTimer);
        setMessageBoardContent(elementId, content);
      }
      onClose();
    }
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
      <span class="text-[10px] font-mono text-foreground font-semibold">Message Board</span>
      <button
        class="text-[10px] font-mono text-muted hover:text-foreground"
        onclick={() => {
          if (saveTimer) {
            clearTimeout(saveTimer);
            setMessageBoardContent(elementId, content);
          }
          onClose();
        }}
      >
        x
      </button>
    </div>

    <!-- Textarea -->
    <div class="p-3">
      <textarea
        class="w-full min-h-[200px] resize-y rounded border border-border bg-bg3 p-2 text-[10px] font-mono text-foreground placeholder:text-muted outline-none focus:border-accent"
        placeholder="Write a message..."
        bind:value={content}
        oninput={handleInput}
      ></textarea>
    </div>
  </div>
</div>
