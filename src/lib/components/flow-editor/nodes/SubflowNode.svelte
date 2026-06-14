<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { SubflowNodeData } from '$lib/state/features/flow-editor.svelte';
  import { openNodeContextMenu, openNodeConfig } from '$lib/state/features/flow-editor.svelte';
  import { Workflow, Settings2 } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  let { data, id }: NodeProps & { data: SubflowNodeData } = $props();

  const flowLabel = $derived(data.flowName?.trim() || data.flowId || '');
</script>

<Handle type="target" position={Position.Left} id="in" class="!w-3 !h-3 !border-2 !border-fuchsia-400 !bg-fuchsia-900" />
<Handle type="source" position={Position.Right} id="out" class="!w-3 !h-3 !border-2 !border-fuchsia-400 !bg-fuchsia-900" />

<div
  class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-48 max-w-60 shadow-lg select-none border-border hover:border-border/80"
  oncontextmenu={(e) => openNodeContextMenu(e, id)}
  ondblclick={() => openNodeConfig(id)}
  role="presentation"
>
  <div class="flex items-center gap-2 mb-1">
    <div class="w-6 h-6 rounded-md bg-fuchsia-500/20 flex items-center justify-center shrink-0">
      <Workflow size={12} class="text-fuchsia-400" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate flex-1">{data.label || m.flownode_subflow()}</span>
    <button
      class="shrink-0 text-muted/60 hover:text-foreground transition-colors"
      title={m.flownode_pickFlowToRun()}
      aria-label={m.flownode_pickFlowToRun()}
      onclick={(e) => { e.stopPropagation(); openNodeConfig(id); }}
    >
      <Settings2 size={12} />
    </button>
  </div>
  {#if flowLabel}
    <span class="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded bg-fuchsia-500/15 text-fuchsia-300 truncate max-w-[200px]">
      ↳ {flowLabel}
    </span>
  {:else}
    <p class="text-[9px] text-amber-400/80">{m.flownode_doubleClickPickFlow()}</p>
  {/if}
</div>
