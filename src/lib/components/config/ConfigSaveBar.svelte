<script lang="ts">
  import { configState, isDirty, dirtyPaths, save, discard } from '$lib/state/config/config.svelte';
  import { isAdmin } from '$lib/state/features/user.svelte';
  import { Button } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
</script>

<!-- Normal save bar: dirty state only -->
<div class="shrink-0 border-t border-border bg-bg2/80 backdrop-blur-sm px-6 py-3 flex items-center gap-3 animate-slide-up">
  {#if configState.saveError}
    <span class="text-destructive text-[length:var(--font-size-label)] flex-1 truncate">{configState.saveError}</span>
  {:else if configState.lastSavedAt && !isDirty.value}
    <span class="text-success text-[length:var(--font-size-label)] flex-1">{m.saveBar_saved()}</span>
  {:else}
    <span class="text-muted-foreground text-[length:var(--font-size-label)] flex-1">
      {dirtyPaths.value.size === 1
        ? m.saveBar_sectionsModified({ count: dirtyPaths.value.size })
        : m.saveBar_sectionsModifiedPlural({ count: dirtyPaths.value.size })}
    </span>
  {/if}

  {#if isAdmin.value}
    <Button
      variant="ghost"
      size="sm"
      disabled={!isDirty.value || configState.saving}
      onclick={() => discard()}
    >
      {m.saveBar_discard()}
    </Button>

    <Button
      variant="primary"
      size="sm"
      loading={configState.saving}
      disabled={!isDirty.value}
      onclick={() => save()}
    >
      {m.saveBar_saveChanges()}
    </Button>
  {/if}
</div>

<style>
  @keyframes slide-up {
    from { transform: translateY(100%); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }
  .animate-slide-up {
    animation: slide-up 0.2s ease-out;
  }
</style>
