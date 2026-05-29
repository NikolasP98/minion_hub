<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { Button } from '$lib/components/ui';
  let {
    open = $bindable(false),
    onsave,
    ondiscard,
    oncancel,
  }: {
    open: boolean;
    onsave: () => void;
    ondiscard: () => void;
    oncancel: () => void;
  } = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      oncancel();
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    onclick={oncancel}
    onkeydown={handleKeydown}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="bg-card border border-border rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <h2 class="text-sm font-semibold text-foreground mb-2">{m.saveBar_unsaved()}</h2>
      <p class="text-xs text-muted-foreground mb-5">
        {m.config_unsavedChangesPrompt()}
      </p>
      <div class="flex gap-2 justify-end">
        <Button variant="secondary" size="sm" onclick={oncancel}>
          {m.common_cancel()}
        </Button>
        <Button variant="danger" size="sm" onclick={ondiscard}>
          {m.saveBar_discard()}
        </Button>
        <Button variant="primary" size="sm" onclick={onsave}>
          {m.config_saveAndLeave()}
        </Button>
      </div>
    </div>
  </div>
{/if}
