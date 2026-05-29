<script lang="ts">
  import { flowEditorState, runFlow, saveFlow } from '$lib/state/features/flow-editor.svelte';
  import { Check, Loader, Play, Save } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  async function handleSave() {
    await saveFlow();
  }
</script>

<!--
  Floating action island — anchored bottom-center over the canvas. Holds the
  build/test loop (Test Run + Save); the publish/lifecycle control
  (Activate/Deactivate) stays in the top toolbar.
-->
<div
  class="pointer-events-none absolute bottom-6 left-1/2 z-20 -translate-x-1/2"
  role="toolbar"
  aria-label="Flow actions"
>
  <div
    class="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border/80 bg-bg2/90 p-1.5 shadow-2xl shadow-black/40 backdrop-blur-md"
  >
    <!-- Test Run -->
    <button
      onclick={runFlow}
      disabled={flowEditorState.isRunning}
      class="flex h-8 items-center gap-1.5 rounded-full border border-emerald-500/50 px-4 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/10 disabled:cursor-default disabled:opacity-50"
    >
      {#if flowEditorState.isRunning}
        <Loader size={13} class="animate-spin" />
      {:else}
        <Play size={13} />
      {/if}
      {m.flow_testRun()}
    </button>

    <div class="h-5 w-px bg-border/60"></div>

    <!-- Save (icon-only, status-colored): spinner=saving, save=pending, check=up-to-date -->
    <button
      onclick={handleSave}
      disabled={flowEditorState.isSaving || !flowEditorState.isDirty}
      title={flowEditorState.isSaving
        ? 'Saving…'
        : flowEditorState.isDirty
          ? 'Save changes'
          : 'All changes saved'}
      aria-label={flowEditorState.isSaving
        ? 'Saving'
        : flowEditorState.isDirty
          ? 'Save changes'
          : 'All changes saved'}
      class="flex h-8 w-8 items-center justify-center rounded-full border transition-colors
        {flowEditorState.isDirty && !flowEditorState.isSaving
        ? 'border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/10'
        : 'border-border text-muted/50 cursor-default'}"
    >
      {#if flowEditorState.isSaving}
        <Loader size={14} class="animate-spin" />
      {:else if flowEditorState.isDirty}
        <Save size={14} />
      {:else}
        <Check size={14} />
      {/if}
    </button>
  </div>
</div>
