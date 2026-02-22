<script lang="ts">
  import { configState, isDirty, dirtyPaths, save, discard } from '$lib/state/config.svelte';
  import * as m from '$lib/paraglide/messages';
</script>

<div class="shrink-0 border-t border-border bg-bg2/80 backdrop-blur-sm px-6 py-3 flex items-center gap-3">
  {#if configState.saveError}
    <span class="text-destructive text-[11px] flex-1 truncate">{configState.saveError}</span>
  {:else if configState.lastSavedAt && !isDirty.value}
    <span class="text-success text-[11px] flex-1">{m.saveBar_saved()}</span>
  {:else}
    <span class="text-muted-foreground text-[11px] flex-1">
      {dirtyPaths.value.size === 1 ? m.saveBar_sectionsModified({ count: dirtyPaths.value.size }) : m.saveBar_sectionsModifiedPlural({ count: dirtyPaths.value.size })}
    </span>
  {/if}

  <button
    type="button"
    class="bg-transparent border border-border rounded-[5px] text-muted-foreground cursor-pointer font-[inherit] text-xs py-[6px] px-3 transition-colors hover:text-foreground disabled:opacity-40 disabled:cursor-default"
    disabled={!isDirty.value || configState.saving}
    onclick={() => discard()}
  >
    {m.saveBar_discard()}
  </button>

  <button
    type="button"
    class="bg-accent border-none rounded-[5px] text-white cursor-pointer font-[inherit] text-xs font-semibold py-[6px] px-4 transition-[filter] hover:brightness-115 disabled:opacity-40 disabled:cursor-default flex items-center gap-2"
    disabled={!isDirty.value || configState.saving}
    onclick={() => save()}
  >
    {#if configState.saving}
      <span class="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
    {/if}
    {m.saveBar_saveChanges()}
  </button>
</div>
