<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { createDebouncer } from '$lib/pacer/index.svelte';
  import { workshopState, setRulebookContent } from '$lib/state/workshop/workshop.svelte';
  import * as m from '$lib/paraglide/messages';
  import { Button, Toggle } from '$lib/components/ui';

  let {
    elementId,
    onClose,
  }: {
    elementId: string;
    onClose: () => void;
  } = $props();

  let content = $state(untrack(() => workshopState.elements[elementId]?.rulebookContent ?? ''));

  const saver = createDebouncer((value: string) => setRulebookContent(elementId, value), {
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

  function toggleAgentChats() {
    workshopState.settings.agentChatsEnabled = !workshopState.settings.agentChatsEnabled;
  }

  function toggleCrossWorkspaceChats() {
    workshopState.settings.crossWorkspaceChats = !workshopState.settings.crossWorkspaceChats;
  }
</script>

<div
  class="fixed inset-0 z-[var(--layer-modal)] flex items-center justify-center bg-[color-mix(in_srgb,var(--color-bg)_40%,transparent)]"
  role="button"
  tabindex="-1"
  aria-label={m.common_close()}
  onclick={handleBackdropClick}
  onkeydown={(e) => e.key === 'Escape' && (flush(), onClose())}
>
  <div class="w-full max-w-md rounded-lg border border-border bg-bg2 shadow-xl">
    <div class="flex items-center justify-between border-b border-border px-4 py-2">
      <div class="flex items-center gap-2">
        <span class="text-base">📖</span>
        <span class="text-xs font-mono text-foreground font-semibold">{m.workshop_rulebook()}</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs text-muted font-mono">{m.rulebook_subtitle()}</span>
        <Button
          variant="ghost"
          size="icon"
          class="font-mono text-muted"
          aria-label={m.common_close()}
          onclick={() => {
            flush();
            onClose();
          }}>x</Button
        >
      </div>
    </div>

    <!-- Agent-agent chat killswitch -->
    <div class="flex items-center justify-between border-b border-border px-3 py-2">
      <div class="flex flex-col gap-0.5">
        <span class="text-xs font-mono text-foreground font-medium">{m.rulebook_agentChats()}</span>
        <span class="text-xs font-mono text-muted">{m.rulebook_agentChatsDesc()}</span>
      </div>
      <Toggle
        checked={workshopState.settings.agentChatsEnabled}
        ariaLabel={m.rulebook_agentChats()}
        onchange={toggleAgentChats}
      />
    </div>

    <!-- Cross-workspace chats toggle -->
    <div class="flex items-center justify-between border-b border-border px-3 py-2">
      <div class="flex flex-col gap-0.5">
        <span class="text-xs font-mono text-foreground font-medium"
          >{m.rulebook_crossWorkspaceChats()}</span
        >
        <span class="text-xs font-mono text-muted">{m.rulebook_crossWorkspaceChatsDesc()}</span>
      </div>
      <Toggle
        checked={workshopState.settings.crossWorkspaceChats}
        ariaLabel={m.rulebook_crossWorkspaceChats()}
        onchange={toggleCrossWorkspaceChats}
      />
    </div>

    <div class="p-3">
      <textarea
        class="w-full min-h-[200px] resize-y rounded border border-border bg-bg3 p-2 text-xs font-mono text-foreground placeholder:text-muted outline-none focus:border-accent"
        placeholder={m.rulebook_placeholder()}
        bind:value={content}
        oninput={handleInput}></textarea>
    </div>
  </div>
</div>
