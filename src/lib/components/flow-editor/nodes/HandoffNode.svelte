<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { HandoffNodeData } from '$lib/state/features/flow-editor.svelte';
  import { openNodeContextMenu, openNodeConfig } from '$lib/state/features/flow-editor.svelte';
  import { Headset, Settings2 } from 'lucide-svelte';

  let { data, id }: NodeProps & { data: HandoffNodeData } = $props();
  const count = $derived(Array.isArray(data.destinations) ? data.destinations.length : 0);
</script>

<Handle type="target" position={Position.Left} id="in" class="!w-3 !h-3 !border-2 !border-rose-400 !bg-rose-900" />

<div
  class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-48 max-w-60 shadow-lg select-none border-border hover:border-border/80"
  oncontextmenu={(e) => openNodeContextMenu(e, id)}
  ondblclick={() => openNodeConfig(id)}
  role="presentation"
>
  <div class="flex items-center gap-2 mb-1">
    <div class="w-6 h-6 rounded-md bg-rose-500/20 flex items-center justify-center shrink-0">
      <Headset size={12} class="text-rose-400" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate flex-1">{data.label || 'Human Handoff'}</span>
    <button
      class="shrink-0 text-muted/60 hover:text-foreground transition-colors"
      title="Configure handoff"
      aria-label="Configure handoff"
      onclick={(e) => { e.stopPropagation(); openNodeConfig(id); }}
    >
      <Settings2 size={12} />
    </button>
  </div>
  <div class="text-[9px] text-muted/70">
    {data.priority ? `${data.priority} · ` : ''}{count} owner{count === 1 ? '' : 's'} · relay until /end
  </div>
</div>
