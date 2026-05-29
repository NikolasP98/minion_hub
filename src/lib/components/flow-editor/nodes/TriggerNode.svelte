<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { TriggerNodeData } from '$lib/state/features/flow-editor.svelte';
  import { flowEditorState, setNodes, openNodeContextMenu } from '$lib/state/features/flow-editor.svelte';
  import { Zap } from 'lucide-svelte';

  let { data, id }: NodeProps & { data: TriggerNodeData } = $props();

  const EVENT_LABELS: Record<TriggerNodeData['event'], string> = {
    'message:received': 'Message received',
    'message:sent': 'Message sent',
    'agent:bootstrap': 'Agent bootstrap',
    'memory:node_created': 'Memory created',
    'memory:node_updated': 'Memory updated',
    'memory:node_deleted': 'Memory deleted',
  };

  function handleEventChange(e: Event) {
    const event = (e.target as HTMLSelectElement).value as TriggerNodeData['event'];
    const label = EVENT_LABELS[event];
    const next = flowEditorState.nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, event, label } } : n,
    );
    setNodes(next);
  }

  function handleDeliverChange(e: Event) {
    const deliverResponse = (e.target as HTMLInputElement).checked;
    const next = flowEditorState.nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, deliverResponse } } : n,
    );
    setNodes(next);
  }
</script>

<Handle
  type="source"
  position={Position.Right}
  id="out"
  class="!w-3 !h-3 !border-2 !border-amber-400 !bg-amber-900"
/>

<div
  class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-48 max-w-60 shadow-lg select-none border-border hover:border-border/80"
  oncontextmenu={(e) => openNodeContextMenu(e, id)}
  role="presentation"
>
  <div class="flex items-center gap-2 mb-2">
    <div class="w-6 h-6 rounded-md bg-amber-500/20 flex items-center justify-center shrink-0">
      <Zap size={12} class="text-amber-400" />
    </div>
    <span class="text-xs font-semibold text-foreground">Trigger</span>
  </div>

  <select
    class="w-full text-[10px] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground mb-2"
    value={data.event}
    onclick={(e) => e.stopPropagation()}
    onchange={handleEventChange}
  >
    {#each Object.entries(EVENT_LABELS) as [val, lbl] (val)}
      <option value={val}>{lbl}</option>
    {/each}
  </select>

  <label class="flex items-center gap-1.5 cursor-pointer">
    <input
      type="checkbox"
      class="w-3 h-3 accent-amber-400"
      checked={data.deliverResponse}
      onclick={(e) => e.stopPropagation()}
      onchange={handleDeliverChange}
    />
    <span class="text-[10px] text-muted">Reply to channel</span>
  </label>
</div>
