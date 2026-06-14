<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { ChannelNodeData } from '$lib/state/features/flow-editor.svelte';
  import { openNodeContextMenu, openNodeConfig } from '$lib/state/features/flow-editor.svelte';
  import { Send, Settings2 } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  let { data, id }: NodeProps & { data: ChannelNodeData } = $props();

  const destCount = $derived(Array.isArray(data.destinations) ? data.destinations.length : 0);
  const channelLabel = $derived(data.channel ? data.channel : 'no channel');
</script>

<Handle type="target" position={Position.Left} id="in" class="!w-3 !h-3 !border-2 !border-cyan-400 !bg-cyan-900" />
<Handle type="source" position={Position.Right} id="out" class="!w-3 !h-3 !border-2 !border-cyan-400 !bg-cyan-900" />

<div
  class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-48 max-w-60 shadow-lg select-none border-border hover:border-border/80"
  oncontextmenu={(e) => openNodeContextMenu(e, id)}
  ondblclick={() => openNodeConfig(id)}
  role="presentation"
>
  <div class="flex items-center gap-2 mb-1">
    <div class="w-6 h-6 rounded-md bg-cyan-500/20 flex items-center justify-center shrink-0">
      <Send size={12} class="text-cyan-400" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate flex-1">{data.label || m.flownode_channel()}</span>
    <button
      class="shrink-0 text-muted/60 hover:text-foreground transition-colors"
      title={m.flownode_configureDestinations()}
      aria-label={m.flownode_configureDestinations()}
      onclick={(e) => { e.stopPropagation(); openNodeConfig(id); }}
    >
      <Settings2 size={12} />
    </button>
  </div>
  <div class="flex items-center gap-1.5">
    <span class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 capitalize">
      {channelLabel}
    </span>
    <span class="text-[10px] text-muted">
      {destCount} {m.flownode_destination({ count: destCount })}
    </span>
  </div>
  {#if destCount === 0 || !data.channel}
    <p class="text-[9px] text-amber-400/80 mt-1">{m.flownode_doubleClickPickChannelDestinations()}</p>
  {/if}
</div>
