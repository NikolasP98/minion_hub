<script lang="ts">
  import { untrack } from 'svelte';
  import { workshopState, setRulebookContent } from '$lib/state/workshop.svelte';
  import * as m from '$lib/paraglide/messages';

  let {
    elementId,
    onClose,
  }: {
    elementId: string;
    onClose: () => void;
  } = $props();

  let content = $state(untrack(() => workshopState.elements[elementId]?.rulebookContent ?? ''));
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  function handleInput() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => setRulebookContent(elementId, content), 500);
  }

  function flush() {
    if (saveTimer) { clearTimeout(saveTimer); setRulebookContent(elementId, content); }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) { flush(); onClose(); }
  }

  function toggleAgentChats() {
    workshopState.settings.agentChatsEnabled = !workshopState.settings.agentChatsEnabled;
  }

  function toggleCrossWorkspaceChats() {
    workshopState.settings.crossWorkspaceChats = !workshopState.settings.crossWorkspaceChats;
  }
</script>

<div
  class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40"
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
        <span class="text-[10px] font-mono text-foreground font-semibold">{m.workshop_rulebook()}</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[9px] text-muted font-mono">{m.rulebook_subtitle()}</span>
        <button class="text-[10px] font-mono text-muted hover:text-foreground" onclick={() => { flush(); onClose(); }}>x</button>
      </div>
    </div>

    <!-- Agent-agent chat killswitch -->
    <div class="flex items-center justify-between border-b border-border px-3 py-2">
      <div class="flex flex-col gap-0.5">
        <span class="text-[10px] font-mono text-foreground font-medium">{m.rulebook_agentChats()}</span>
        <span class="text-[9px] font-mono text-muted">{m.rulebook_agentChatsDesc()}</span>
      </div>
      <div
        class="relative h-5 w-9 cursor-pointer rounded-full transition-colors duration-150 {workshopState.settings.agentChatsEnabled ? 'bg-accent' : 'bg-border'}"
        onclick={toggleAgentChats}
        role="switch"
        aria-checked={workshopState.settings.agentChatsEnabled}
        tabindex="0"
        onkeydown={(e) => e.key === 'Enter' || e.key === ' ' ? toggleAgentChats() : null}
      >
        <span
          class="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-150 {workshopState.settings.agentChatsEnabled ? 'translate-x-4' : 'translate-x-0.5'}"
        ></span>
      </div>
    </div>

    <!-- Cross-workspace chats toggle -->
    <div class="flex items-center justify-between border-b border-border px-3 py-2">
      <div class="flex flex-col gap-0.5">
        <span class="text-[10px] font-mono text-foreground font-medium">{m.rulebook_crossWorkspaceChats()}</span>
        <span class="text-[9px] font-mono text-muted">{m.rulebook_crossWorkspaceChatsDesc()}</span>
      </div>
      <div
        class="relative h-5 w-9 cursor-pointer rounded-full transition-colors duration-150 {workshopState.settings.crossWorkspaceChats ? 'bg-accent' : 'bg-border'}"
        onclick={toggleCrossWorkspaceChats}
        role="switch"
        aria-checked={workshopState.settings.crossWorkspaceChats}
        tabindex="0"
        onkeydown={(e) => e.key === 'Enter' || e.key === ' ' ? toggleCrossWorkspaceChats() : null}
      >
        <span
          class="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-150 {workshopState.settings.crossWorkspaceChats ? 'translate-x-4' : 'translate-x-0.5'}"
        ></span>
      </div>
    </div>

    <div class="p-3">
      <textarea
        class="w-full min-h-[200px] resize-y rounded border border-border bg-bg3 p-2 text-[10px] font-mono text-foreground placeholder:text-muted outline-none focus:border-accent"
        placeholder={m.rulebook_placeholder()}
        bind:value={content}
        oninput={handleInput}
      ></textarea>
    </div>
  </div>
</div>
