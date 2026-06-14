<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { DatabaseNodeData } from '$lib/state/features/flow-editor.svelte';
  import { openNodeContextMenu, openNodeConfig } from '$lib/state/features/flow-editor.svelte';
  import { Database, Settings2 } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  let { data, id }: NodeProps & { data: DatabaseNodeData } = $props();

  const action = $derived(data.action ?? 'read');
  const ACTION_LABELS: Record<string, string> = {
    read: m.flownode_read(), create: m.flownode_create(), update: m.flownode_update(), delete: m.flownode_delete(),
  };
  const summary = $derived((data.sql ?? '').trim().replace(/\s+/g, ' '));
</script>

<Handle type="target" position={Position.Left} id="in" class="!w-3 !h-3 !border-2 !border-teal-400 !bg-teal-900" />
<Handle type="source" position={Position.Right} id="out" class="!w-3 !h-3 !border-2 !border-teal-400 !bg-teal-900" />

<div
  class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-48 max-w-60 shadow-lg select-none border-border hover:border-border/80"
  oncontextmenu={(e) => openNodeContextMenu(e, id)}
  ondblclick={() => openNodeConfig(id)}
  role="presentation"
>
  <div class="flex items-center gap-2 mb-1">
    <div class="w-6 h-6 rounded-md bg-teal-500/20 flex items-center justify-center shrink-0">
      <Database size={12} class="text-teal-300" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate flex-1">{data.label || 'Database'}</span>
    <span class="text-[9px] font-medium px-1.5 py-0.5 rounded bg-teal-500/15 text-teal-300 shrink-0">
      {ACTION_LABELS[action] ?? action}
    </span>
    <button
      class="shrink-0 text-muted/60 hover:text-foreground transition-colors"
      title={m.flownode_configureDatabaseAction()}
      aria-label={m.flownode_configureDatabaseAction()}
      onclick={(e) => { e.stopPropagation(); openNodeConfig(id); }}
    >
      <Settings2 size={12} />
    </button>
  </div>
  {#if summary}
    <code class="block text-[10px] text-teal-200/80 bg-bg3/60 rounded px-1.5 py-1 truncate">{summary}</code>
  {:else}
    <p class="text-[9px] text-amber-400/80">{m.flownode_doubleClickWriteSQL()}</p>
  {/if}
</div>
