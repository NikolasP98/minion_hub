<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { createDebouncer } from '$lib/pacer/index.svelte';
  import {
    workshopState,
    setMessageBoardContent,
  } from '$lib/state/workshop/workshop.svelte';
  import * as m from '$lib/paraglide/messages';

  let {
    elementId,
    onClose,
  }: {
    elementId: string;
    onClose: () => void;
  } = $props();

  let content = $state(untrack(() => workshopState.elements[elementId]?.messageBoardContent ?? ''));

  const saver = createDebouncer((value: string) => setMessageBoardContent(elementId, value), {
    wait: 500,
  });

  function handleInput() {
    saver.run(content);
  }

  function flush() {
    saver.flush();
  }

  onDestroy(flush);

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      flush();
      onClose();
    }
  }
</script>

<div
  class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40"
  role="button"
  tabindex="-1"
  aria-label={m.common_close()}
  onclick={handleBackdropClick}
  onkeydown={(e) => {
    if (e.key === 'Escape') {
      flush();
      onClose();
    }
  }}
>
  <div class="w-full max-w-md rounded-lg border border-border bg-bg2 shadow-xl">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-border px-4 py-2">
      <span class="text-[10px] font-mono text-foreground font-semibold">{m.workshop_messageboard()}</span>
      <button
        class="text-[10px] font-mono text-muted hover:text-foreground"
        onclick={() => {
          flush();
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
        placeholder={m.messageboard_placeholder()}
        bind:value={content}
        oninput={handleInput}
      ></textarea>
    </div>
  </div>
</div>
