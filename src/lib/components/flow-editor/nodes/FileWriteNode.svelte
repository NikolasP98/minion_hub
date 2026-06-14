<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { FileWriteNodeData } from '$lib/state/features/flow-editor.svelte';
  import { openNodeContextMenu, openNodeConfig } from '$lib/state/features/flow-editor.svelte';
  import { FileText, Settings2 } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  let { data, id }: NodeProps & { data: FileWriteNodeData } = $props();

  const target = $derived((data.path ?? '').trim());
</script>

<Handle type="target" position={Position.Left} id="in" class="!w-3 !h-3 !border-2 !border-slate-400 !bg-slate-800" />
<Handle type="source" position={Position.Right} id="out" class="!w-3 !h-3 !border-2 !border-slate-400 !bg-slate-800" />

<div
  class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-48 max-w-60 shadow-lg select-none border-border hover:border-border/80"
  oncontextmenu={(e) => openNodeContextMenu(e, id)}
  ondblclick={() => openNodeConfig(id)}
  role="presentation"
>
  <div class="flex items-center gap-2 mb-1">
    <div class="w-6 h-6 rounded-md bg-slate-500/20 flex items-center justify-center shrink-0">
      <FileText size={12} class="text-slate-300" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate flex-1">{data.label || m.flownode_writeFile()}</span>
    <button
      class="shrink-0 text-muted/60 hover:text-foreground transition-colors"
      title={m.flownode_configureFilePath()}
      aria-label={m.flownode_configureFilePath()}
      onclick={(e) => { e.stopPropagation(); openNodeConfig(id); }}
    >
      <Settings2 size={12} />
    </button>
  </div>
  {#if target}
    <div class="flex items-center gap-1.5">
      <code class="text-[10px] text-slate-300/90 truncate max-w-[170px]">{target}</code>
      <span class="text-[9px] text-muted shrink-0">· {data.mode === 'append' ? m.flownode_append() : m.flownode_overwrite()}</span>
    </div>
  {:else}
    <p class="text-[9px] text-amber-400/80">{m.flownode_doubleClickSetPath()}</p>
  {/if}
</div>
