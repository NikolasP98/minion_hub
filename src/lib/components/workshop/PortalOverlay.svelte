<script lang="ts">
  import { untrack } from 'svelte';
  import { workshopState, autoSave } from '$lib/state/workshop.svelte';

  let {
    elementId,
    onClose,
  }: {
    elementId: string;
    onClose: () => void;
  } = $props();

  let label = $state(untrack(() => workshopState.elements[elementId]?.portalLabel ?? ''));
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  function saveLabel() {
    const el = workshopState.elements[elementId];
    if (el) {
      el.portalLabel = label;
      autoSave(undefined, 'elements');
    }
  }

  function handleInput() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveLabel(), 500);
  }

  function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveLabel(); }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) { flush(); onClose(); }
  }

  const targetWorkspaceId = $derived(
    workshopState.elements[elementId]?.portalTargetWorkspaceId
  );
</script>

<div
  class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40"
  role="button"
  tabindex="-1"
  aria-label="Close"
  onclick={handleBackdropClick}
  onkeydown={(e) => e.key === 'Escape' && (flush(), onClose())}
>
  <div class="w-full max-w-md rounded-lg border border-border bg-bg2 shadow-xl">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-border px-4 py-2">
      <div class="flex items-center gap-2">
        <span class="text-base">🌀</span>
        <span class="text-[10px] font-mono text-foreground font-semibold">Portal</span>
      </div>
      <button class="text-[10px] font-mono text-muted hover:text-foreground" onclick={() => { flush(); onClose(); }}>x</button>
    </div>

    <!-- Label input -->
    <div class="border-b border-border px-3 py-2">
      <div class="flex flex-col gap-1">
        <span class="text-[9px] font-mono text-muted">Label</span>
        <input
          type="text"
          class="w-full rounded border border-border bg-bg3 px-2 py-1 text-[10px] font-mono text-foreground placeholder:text-muted outline-none focus:border-accent"
          placeholder="Portal name..."
          bind:value={label}
          oninput={handleInput}
        />
      </div>
    </div>

    <!-- Workspace linking placeholder -->
    <div class="px-3 py-4">
      <div class="flex flex-col items-center gap-2 rounded border border-dashed border-border bg-bg3 px-4 py-6">
        <span class="text-[10px] font-mono text-muted">Workspace linking coming soon</span>
        <span class="text-[9px] font-mono text-accent">
          {targetWorkspaceId ? targetWorkspaceId : 'Unlinked'}
        </span>
      </div>
    </div>
  </div>
</div>
