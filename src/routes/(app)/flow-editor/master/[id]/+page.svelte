<script lang="ts">
  import { page } from '$app/state';
  import MasterFlowCanvas from '$lib/components/flow-editor/MasterFlowCanvas.svelte';
  import { getMasterFlow } from '$lib/flows/master-flows';
  import { ArrowLeft, Workflow, BookOpen } from 'lucide-svelte';

  const flow = $derived(getMasterFlow(page.params.id ?? ''));
</script>

<!-- Self-sufficient flex-column shell: Svelte Flow needs a definite-height
     ancestor, so don't rely on the parent layout being a flex column. -->
<div class="flex flex-col flex-1 min-h-0 h-full">
  <!-- Toolbar -->
  <div
    class="shrink-0 h-10 border-b border-border bg-bg2/80 flex items-center px-3 gap-3 md:pr-[var(--notch-clearance)]"
  >
    <a
      href="/flow-editor"
      class="flex items-center justify-center w-7 h-7 rounded text-muted hover:text-foreground hover:bg-bg3 transition-colors"
      title="Back to flows"
    >
      <ArrowLeft size={14} />
    </a>

    <div class="w-px h-4 bg-border/60"></div>

    <div class="flex items-center gap-1.5 min-w-0">
      <Workflow size={13} class="text-accent shrink-0" />
      <span class="text-sm font-semibold text-foreground truncate">{flow?.name ?? 'Master flow'}</span>
    </div>

    <div
      class="flex items-center gap-1 px-2 py-1 rounded-full bg-accent/15 text-accent text-[10px] font-mono uppercase tracking-wider ring-1 ring-accent/25 shrink-0"
      title="Read-only reference diagram of a standard gateway behavior"
    >
      <BookOpen size={11} />
      Master flow · read-only
    </div>

    <div class="flex-1"></div>

    {#if flow?.description}
      <p class="hidden lg:block text-[11px] text-muted truncate max-w-2xl">{flow.description}</p>
    {/if}
  </div>

  <!-- Canvas -->
  <div class="flex flex-1 min-h-0 overflow-hidden">
    {#if flow}
      <MasterFlowCanvas {flow} />
    {:else}
      <div class="flex-1 flex items-center justify-center">
        <div class="text-center">
          <p class="text-muted mb-4 text-sm">That master flow doesn't exist.</p>
          <a href="/flow-editor" class="text-xs text-accent hover:underline">Back to flows</a>
        </div>
      </div>
    {/if}
  </div>
</div>
