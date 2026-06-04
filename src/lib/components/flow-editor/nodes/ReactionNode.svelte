<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { ReactionNodeData } from '$lib/state/features/flow-editor.svelte';
  import { openNodeContextMenu, openNodeConfig } from '$lib/state/features/flow-editor.svelte';
  import { SmilePlus, Settings2 } from 'lucide-svelte';

  let { data, id }: NodeProps & { data: ReactionNodeData } = $props();
  const emoji = $derived((data.emoji ?? '').trim());
</script>

<Handle type="target" position={Position.Left} id="in" class="!w-3 !h-3 !border-2 !border-pink-400 !bg-pink-900" />
<Handle type="source" position={Position.Right} id="out" class="!w-3 !h-3 !border-2 !border-pink-400 !bg-pink-900" />

<div
  class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-48 max-w-60 shadow-lg select-none border-border hover:border-border/80"
  oncontextmenu={(e) => openNodeContextMenu(e, id)}
  ondblclick={() => openNodeConfig(id)}
  role="presentation"
>
  <div class="flex items-center gap-2 mb-1">
    <div class="w-6 h-6 rounded-md bg-pink-500/20 flex items-center justify-center shrink-0">
      <SmilePlus size={12} class="text-pink-400" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate flex-1">{data.label || 'Set Reaction'}</span>
    <button
      class="shrink-0 text-muted/60 hover:text-foreground transition-colors"
      title="Configure reaction"
      aria-label="Configure reaction"
      onclick={(e) => { e.stopPropagation(); openNodeConfig(id); }}
    >
      <Settings2 size={12} />
    </button>
  </div>
  <div class="flex items-center gap-1.5">
    {#if emoji}
      <span class="text-sm leading-none">{emoji}</span>
      <span class="text-[10px] text-muted">on trigger message</span>
    {:else}
      <span class="text-[9px] text-amber-400/80">Double-click to pick an emoji</span>
    {/if}
  </div>
</div>
