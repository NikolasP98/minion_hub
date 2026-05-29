<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { PluginTriggerNodeData, PluginActionNodeData } from '$lib/state/features/flow-editor.svelte';
  import { flowEditorState, setNodes, openNodeContextMenu, openNodeConfig, descriptorForNode } from '$lib/state/features/flow-editor.svelte';
  import { Puzzle, Settings2 } from 'lucide-svelte';

  let { data, id }: NodeProps & { data: PluginTriggerNodeData | PluginActionNodeData } = $props();

  const isTrigger = $derived('event' in data);
  const node = $derived(flowEditorState.nodes.find((n) => n.id === id));
  const configurable = $derived((descriptorForNode(node)?.config?.length ?? 0) > 0);

  function handleDeliverChange(e: Event) {
    const deliverResponse = (e.target as HTMLInputElement).checked;
    const next = flowEditorState.nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, deliverResponse } } : n,
    );
    setNodes(next);
  }
</script>

{#if !isTrigger}
  <Handle type="target" position={Position.Left} id="in" class="!w-3 !h-3 !border-2 !border-violet-400 !bg-violet-900" />
{/if}
<Handle type="source" position={Position.Right} id="out" class="!w-3 !h-3 !border-2 !border-violet-400 !bg-violet-900" />

<div
  class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-48 max-w-60 shadow-lg select-none border-border hover:border-border/80"
  oncontextmenu={(e) => openNodeContextMenu(e, id)}
  ondblclick={() => configurable && openNodeConfig(id)}
  role="presentation"
>
  <div class="flex items-center gap-2 mb-1">
    <div class="w-6 h-6 rounded-md bg-violet-500/20 flex items-center justify-center shrink-0">
      <Puzzle size={12} class="text-violet-400" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate flex-1">{data.label}</span>
    {#if configurable}
      <button
        class="shrink-0 text-muted/60 hover:text-foreground transition-colors"
        title="Configure"
        aria-label="Configure node"
        onclick={(e) => { e.stopPropagation(); openNodeConfig(id); }}
      >
        <Settings2 size={12} />
      </button>
    {/if}
  </div>
  <div class="text-[9px] text-muted/70 mb-1">
    {data.pluginId} · {isTrigger ? (data as PluginTriggerNodeData).event : (data as PluginActionNodeData).method}
  </div>

  {#if isTrigger}
    <label class="flex items-center gap-1.5 cursor-pointer">
      <input
        type="checkbox"
        class="w-3 h-3 accent-violet-400"
        checked={(data as PluginTriggerNodeData).deliverResponse}
        onclick={(e) => e.stopPropagation()}
        onchange={handleDeliverChange}
      />
      <span class="text-[10px] text-muted">Reply to channel</span>
    </label>
  {/if}
</div>
