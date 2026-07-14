<script lang="ts">
  import { Select } from '$lib/components/ui';
import { flowEditorState, updateNodeData } from '$lib/state/features/flow-editor.svelte';
  import type { SubflowNodeData } from '$lib/state/features/flow-editor.svelte';
  import * as m from '$lib/paraglide/messages';

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
    <label for="sf-flow" class="text-[length:var(--font-size-caption)] font-medium text-foreground">Flow to run</label>
    <Select size="sm"
      id="sf-flow"
      class="w-full text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
      value={data.flowId ?? ''}
      onchange={(next) => setFlow(String(next))}
    >
      <option value="">{m.flowcfg_selectFlow()}</option>
      {#each flows as f (f.id)}
        <option value={f.id}>{f.name}</option>
      {/each}
      {#if data.flowId && !flows.some((f) => f.id === data.flowId)}
        <!-- Keep a stale/self reference visible rather than silently blanking it. -->
        <option value={data.flowId}>{data.flowName || data.flowId}</option>
      {/if}
    </Select>
    {#if loadError}
      <p class="text-[length:var(--font-size-telemetry)] text-[var(--color-warning-fg)]/80 leading-snug">{m.flowcfg_couldntLoadFlows()}</p>
    {:else if loaded && flows.length === 0}
      <p class="text-[length:var(--font-size-telemetry)] text-muted leading-snug">{m.flowcfg_noOtherFlows()}</p>
    {:else}
      <p class="text-[length:var(--font-size-telemetry)] text-muted leading-snug">
        {m.flowcfg_subflowRunsDesc()}
      </p>
    {/if}
  </div>

  <div class="flex flex-col gap-1">
    <label for="sf-label" class="text-[length:var(--font-size-caption)] font-medium text-foreground">Label</label>
    <input
      id="sf-label"
      type="text"
      class="w-full text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
      placeholder={m.flowcfg_subflow()}
      value={data.label ?? ''}
      oninput={(e) => setLabel((e.target as HTMLInputElement).value)}
    />
  </div>
</div>
