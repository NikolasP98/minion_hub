<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import Topbar from '$lib/components/Topbar.svelte';
  import FlowCanvas from '$lib/components/flow-editor/FlowCanvas.svelte';
  import FlowSidebar from '$lib/components/flow-editor/FlowSidebar.svelte';
  import {
    flowEditorState,
    loadFlow,
    saveFlow,
  } from '$lib/state/flow-editor.svelte';
  import { ArrowLeft, Save, GitBranch, Loader } from 'lucide-svelte';

  const flowId = $derived(page.params.id);
  let loadError = $state<string | null>(null);

  onMount(async () => {
    try {
      await loadFlow(flowId);
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load flow';
    }
  });

  async function handleSave() {
    await saveFlow();
  }

  function handleNameInput(e: Event) {
    flowEditorState.flowName = (e.target as HTMLInputElement).value;
    flowEditorState.isDirty = true;
  }
</script>

<div class="flex flex-col h-screen bg-bg overflow-hidden">
  <Topbar />

  {#if loadError}
    <div class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <p class="text-red-400 mb-4">{loadError}</p>
        <button
          onclick={() => goto('/flow-editor')}
          class="text-xs text-muted hover:text-foreground transition-colors"
        >
          ← Back to flows
        </button>
      </div>
    </div>
  {:else}
    <!-- Toolbar -->
    <div
      class="shrink-0 h-10 border-b border-border bg-bg2/80 flex items-center px-3 gap-3"
    >
      <!-- Back -->
      <a
        href="/flow-editor"
        class="flex items-center justify-center w-7 h-7 rounded text-muted hover:text-foreground hover:bg-bg3 transition-colors"
        title="Back to flows"
      >
        <ArrowLeft size={14} />
      </a>

      <div class="w-px h-4 bg-border/60"></div>

      <!-- Flow name -->
      <div class="flex items-center gap-1.5 min-w-0">
        <GitBranch size={13} class="text-muted shrink-0" />
        <input
          type="text"
          class="bg-transparent text-sm font-semibold text-foreground focus:outline-none w-48 truncate placeholder:text-muted"
          value={flowEditorState.flowName}
          oninput={handleNameInput}
          placeholder="Untitled Flow"
        />
      </div>

      <!-- Mode indicator -->
      {#if flowEditorState.relationshipMode}
        <div
          class="flex items-center gap-1.5 px-2 py-1 rounded bg-amber-500/15 border border-amber-500/30"
        >
          <div class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></div>
          <span class="text-[10px] font-mono text-amber-300">RELATIONSHIP MODE</span>
        </div>
      {:else if flowEditorState.isDirty}
        <div class="flex items-center gap-1 text-[10px] text-muted font-mono">
          <div class="w-1.5 h-1.5 rounded-full bg-yellow-500/60"></div>
          Unsaved
        </div>
      {/if}

      <div class="flex-1"></div>

      <!-- Save button -->
      <button
        onclick={handleSave}
        disabled={flowEditorState.isSaving || !flowEditorState.isDirty}
        class="flex items-center gap-1.5 h-7 px-3 text-xs rounded border transition-colors
          {flowEditorState.isDirty
          ? 'border-accent/50 text-accent hover:bg-accent/10'
          : 'border-border text-muted/50 cursor-default'}"
      >
        {#if flowEditorState.isSaving}
          <Loader size={12} class="animate-spin" />
        {:else}
          <Save size={12} />
        {/if}
        Save
      </button>
    </div>

    <!-- Editor body -->
    <div class="flex flex-1 min-h-0 overflow-hidden">
      <FlowSidebar />
      <FlowCanvas />
    </div>
  {/if}
</div>
