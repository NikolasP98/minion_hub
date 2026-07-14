<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { createDebouncer } from '$lib/pacer/index.svelte';
  import { workshopState, autoSave } from '$lib/state/workshop/workshop.svelte';
  import * as m from '$lib/paraglide/messages';
  import { Button } from '$lib/components/ui';

  let {
    elementId,
    onClose,
  }: {
    elementId: string;
    onClose: () => void;
  } = $props();

  let label = $state(untrack(() => workshopState.elements[elementId]?.portalLabel ?? ''));

  function saveLabel() {
    const el = workshopState.elements[elementId];
    if (el) {
      el.portalLabel = label;
      autoSave(undefined, 'elements');
    }
  }

  const saver = createDebouncer(saveLabel, { wait: 500 });

  function handleInput() {
    saver.run();
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

  const targetWorkspaceId = $derived(workshopState.elements[elementId]?.portalTargetWorkspaceId);
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
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-border px-4 py-2">
      <div class="flex items-center gap-2">
        <span class="text-base">🌀</span>
        <span class="text-xs font-mono text-foreground font-semibold">{m.workshop_portal()}</span>
      </div>
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

    <!-- Label input -->
    <div class="border-b border-border px-3 py-2">
      <div class="flex flex-col gap-1">
        <span class="text-xs font-mono text-muted">{m.portal_label()}</span>
        <input
          type="text"
          class="w-full rounded border border-border bg-bg3 px-2 py-1 text-xs font-mono text-foreground placeholder:text-muted outline-none focus:border-accent"
          placeholder={m.portal_namePlaceholder()}
          bind:value={label}
          oninput={handleInput}
        />
      </div>
    </div>

    <!-- Workspace linking placeholder -->
    <div class="px-3 py-4">
      <div
        class="flex flex-col items-center gap-2 rounded border border-dashed border-border bg-bg3 px-4 py-6"
      >
        <span class="text-xs font-mono text-muted">{m.portal_comingSoon()}</span>
        <span class="text-xs font-mono text-accent">
          {targetWorkspaceId ? targetWorkspaceId : m.portal_unlinked()}
        </span>
      </div>
    </div>
  </div>
</div>
