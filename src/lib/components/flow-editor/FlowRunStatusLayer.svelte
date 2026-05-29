<script lang="ts">
  import { flowEditorState } from '$lib/state/features/flow-editor.svelte';
  import { Check, X, Minus, Loader } from 'lucide-svelte';

  // Screen position of a node's top-left corner = flow-coord * zoom + pan.
  // canvasViewport is bound to Svelte Flow, so this tracks pan/zoom live.
  const badges = $derived(
    flowEditorState.nodes
      .map((n) => {
        const run = flowEditorState.nodeRuns[n.id];
        if (!run) return null;
        const vp = flowEditorState.canvasViewport;
        return {
          id: n.id,
          status: run.status,
          x: n.position.x * vp.zoom + vp.x,
          y: n.position.y * vp.zoom + vp.y,
        };
      })
      .filter((b): b is NonNullable<typeof b> => b !== null),
  );

  const styleByStatus: Record<string, string> = {
    running: 'bg-amber-500 text-black ring-2 ring-amber-300/50 animate-pulse',
    done: 'bg-emerald-500 text-black',
    error: 'bg-red-500 text-white',
    skipped: 'bg-bg3 text-muted/70 ring-1 ring-border',
  };
</script>

<!-- Live per-node run status, anchored to each node's top-left corner. -->
<div class="pointer-events-none absolute inset-0 z-10 overflow-hidden">
  {#each badges as b (b.id)}
    <div
      class="absolute flex h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full shadow-md {styleByStatus[
        b.status
      ] ?? 'bg-bg3 text-muted'}"
      style="left: {b.x}px; top: {b.y}px;"
    >
      {#if b.status === 'running'}
        <Loader size={11} class="animate-spin" />
      {:else if b.status === 'done'}
        <Check size={11} strokeWidth={3} />
      {:else if b.status === 'error'}
        <X size={11} strokeWidth={3} />
      {:else}
        <Minus size={11} strokeWidth={3} />
      {/if}
    </div>
  {/each}
</div>
