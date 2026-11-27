<script lang="ts">
  import Dialog from '$lib/components/ui/foundations/Dialog.svelte';
  import { onDestroy, untrack } from 'svelte';
  import { createDebouncer } from '$lib/pacer/index.svelte';
  import { workshopState, setMessageBoardContent } from '$lib/state/workshop/workshop.svelte';
  import * as m from '$lib/paraglide/messages';
  import { Button } from '$lib/components/ui';

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

  const titleId = $props.id();
</script>

<!-- Escape, a click outside, the focus trap and focus return belong to the shared Dialog.
     `clear`: the canvas stays visible behind the panel, as it always did. -->
<Dialog
  open
  presentation="bare"
  backdrop="clear"
  labelledBy={titleId}
  hideClose
  guardDismiss={false}
  onclose={onClose}
>
  <div class="w-full max-w-md rounded-lg border border-border bg-bg2 shadow-xl">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-border px-4 py-2">
      <span id={titleId} class="text-xs font-mono text-foreground font-semibold"
        >{m.workshop_messageboard()}</span
      >
      <Button
        variant="ghost"
        size="icon"
        class="font-mono text-muted"
        aria-label={m.common_close()}
        onclick={() => {
          flush();
          onClose();
        }}
      >
        x
      </Button>
    </div>

    <!-- Textarea -->
    <div class="p-3">
      <textarea
        class="w-full min-h-[200px] resize-y rounded border border-border bg-bg3 p-2 text-xs font-mono text-foreground placeholder:text-muted outline-none focus:border-focus-ring"
        placeholder={m.messageboard_placeholder()}
        bind:value={content}
        oninput={handleInput}></textarea>
    </div>
  </div>
</Dialog>
