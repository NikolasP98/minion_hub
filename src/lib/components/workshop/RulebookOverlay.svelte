<script lang="ts">
  import { untrack } from 'svelte';
  import { workshopState, setRulebookContent } from '$lib/state/workshop.svelte';

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
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40"
  onclick={handleBackdropClick}
>
  <div class="w-full max-w-md rounded-lg border border-border bg-bg2 shadow-xl">
    <div class="flex items-center justify-between border-b border-border px-4 py-2">
      <div class="flex items-center gap-2">
        <span class="text-base">📖</span>
        <span class="text-[10px] font-mono text-foreground font-semibold">Rulebook</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[9px] text-muted font-mono">Standing instructions injected into all agent prompts</span>
        <button class="text-[10px] font-mono text-muted hover:text-foreground" onclick={() => { flush(); onClose(); }}>x</button>
      </div>
    </div>
    <div class="p-3">
      <textarea
        class="w-full min-h-[200px] resize-y rounded border border-border bg-bg3 p-2 text-[10px] font-mono text-foreground placeholder:text-muted outline-none focus:border-accent"
        placeholder="Write standing instructions for all agents...&#10;&#10;Example:&#10;- Always respond in English&#10;- Never reveal API keys or secrets&#10;- Format code in markdown blocks"
        bind:value={content}
        oninput={handleInput}
      ></textarea>
    </div>
  </div>
</div>
