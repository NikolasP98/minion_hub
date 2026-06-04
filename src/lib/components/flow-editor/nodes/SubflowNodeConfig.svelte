<script lang="ts">
  import { flowEditorState, updateNodeData } from '$lib/state/features/flow-editor.svelte';
  import type { SubflowNodeData } from '$lib/state/features/flow-editor.svelte';

  let { nodeId }: { nodeId: string } = $props();

  const node = $derived(flowEditorState.nodes.find((n) => n.id === nodeId));
  const data = $derived((node?.data ?? {}) as SubflowNodeData);

  type FlowMeta = { id: string; name: string; nodeCount?: number };
  let flows = $state<FlowMeta[]>([]);
  let loaded = $state(false);
  let loadError = $state(false);

  // Load the flow list once (the picker's options). Exclude THIS flow so the
  // obvious self-reference isn't a one-click mistake — the runner guards cycles
  // at execution time regardless, but keeping it out of the list is clearer.
  $effect(() => {
    if (loaded) return;
    void (async () => {
      try {
        const res = await fetch('/api/flows');
        if (!res.ok) { loadError = true; return; }
        const body = (await res.json()) as { flows?: FlowMeta[] };
        flows = (body.flows ?? []).filter((f) => f.id !== flowEditorState.flowId);
        loaded = true;
      } catch {
        loadError = true;
      }
    })();
  });

  function setFlow(flowId: string) {
    const picked = flows.find((f) => f.id === flowId);
    updateNodeData(nodeId, {
      flowId: flowId || undefined,
      flowName: picked?.name ?? (flowId || undefined),
    });
  }
  function setLabel(label: string) {
    updateNodeData(nodeId, { label });
  }
</script>

<div class="px-3 py-3 flex flex-col gap-3">
  <div class="flex flex-col gap-1">
    <label for="sf-flow" class="text-[11px] font-medium text-foreground">Flow to run</label>
    <select
      id="sf-flow"
      class="w-full text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
      value={data.flowId ?? ''}
      onchange={(e) => setFlow((e.target as HTMLSelectElement).value)}
    >
      <option value="">Select a flow…</option>
      {#each flows as f (f.id)}
        <option value={f.id}>{f.name}</option>
      {/each}
      {#if data.flowId && !flows.some((f) => f.id === data.flowId)}
        <!-- Keep a stale/self reference visible rather than silently blanking it. -->
        <option value={data.flowId}>{data.flowName || data.flowId}</option>
      {/if}
    </select>
    {#if loadError}
      <p class="text-[10px] text-amber-400/80 leading-snug">Couldn't load flows — type is saved, but pick again once flows load.</p>
    {:else if loaded && flows.length === 0}
      <p class="text-[10px] text-muted leading-snug">No other flows yet. Create one first, then reference it here.</p>
    {:else}
      <p class="text-[10px] text-muted leading-snug">
        Runs the chosen flow with this node's input; its final output continues downstream.
      </p>
    {/if}
  </div>

  <div class="flex flex-col gap-1">
    <label for="sf-label" class="text-[11px] font-medium text-foreground">Label</label>
    <input
      id="sf-label"
      type="text"
      class="w-full text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
      placeholder="Subflow"
      value={data.label ?? ''}
      oninput={(e) => setLabel((e.target as HTMLInputElement).value)}
    />
  </div>
</div>
