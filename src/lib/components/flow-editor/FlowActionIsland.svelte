<script lang="ts">
  import { Button } from '$lib/components/ui';
import {
    flowEditorState,
    runFlow,
    saveFlow,
    toggleHistory,
  } from '$lib/state/features/flow-editor.svelte';
  import { Check, History, Loader, Play, Save } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  async function handleSave() {
    await saveFlow();
  }
</script>

<!--
  Floating action island — anchored bottom-center over the canvas. Order:
  History · Test Run · Save. Build/test loop lives here; the publish/lifecycle
  control (Activate/Deactivate) stays in the top toolbar.
-->
<div
  class="pointer-events-none absolute bottom-6 left-1/2 z-[var(--layer-navigation)] -translate-x-1/2"
  role="toolbar"
  aria-label="Flow actions"
>
  <div
    class="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border/80 bg-bg2/90 p-1.5 shadow-2xl shadow-black/40 backdrop-blur-md"
  >
    <!-- History (icon-only) -->
    <Button variant="ghost"
      onclick={toggleHistory}
      title="Run history"
      aria-label="Run history"
      aria-pressed={flowEditorState.historyOpen}
      class="flex h-8 w-8 items-center justify-center rounded-full border transition-colors
        {flowEditorState.historyOpen
        ? 'border-accent/50 text-accent bg-accent/10'
        : 'border-border text-muted hover:text-foreground hover:bg-bg3'}"
    >
      <History size={14} />
    </Button>

    <div class="h-5 w-px bg-border/60"></div>

    <!-- Test Run -->
    <Button variant="ghost"
      onclick={runFlow}
      disabled={flowEditorState.isRunning}
      class="flex h-8 items-center gap-1.5 rounded-full border border-[var(--color-success-border)] px-4 text-xs font-medium text-[var(--color-success-fg)] transition-colors hover:bg-[var(--color-success-fg)]/10 disabled:cursor-default disabled:opacity-50"
    >
      {#if flowEditorState.isRunning}
        <Loader size={13} class="animate-spin" />
      {:else}
        <Play size={13} />
      {/if}
      {m.flow_testRun()}
    </Button>

    <div class="h-5 w-px bg-border/60"></div>

    <!-- Save (icon-only, status-colored): spinner=saving, save=pending, check=up-to-date -->
    <Button variant="ghost"
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
        ? 'border-[var(--color-warning-border)] text-[var(--color-warning-fg)] hover:bg-[var(--color-warning-surface)]'
        : 'border-border text-muted/50 cursor-default'}"
    >
      {#if flowEditorState.isSaving}
        <Loader size={14} class="animate-spin" />
      {:else if flowEditorState.isDirty}
        <Save size={14} />
      {:else}
        <Check size={14} />
      {/if}
    </Button>
  </div>
</div>
