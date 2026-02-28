<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { AgentNodeData } from '$lib/state/flow-editor.svelte';
  import { flowEditorState } from '$lib/state/flow-editor.svelte';
  import { Bot } from 'lucide-svelte';

  let { data, id, selected }: NodeProps & { data: AgentNodeData } = $props();

  let showSettings = $state(false);
  const showHandles = $derived(flowEditorState.relationshipMode || selected);
</script>

<!-- Settings panel (shown above node when open) -->
{#if showSettings}
  <div
    class="absolute bottom-full mb-2 left-0 right-0 bg-bg2 border border-border rounded-lg p-3 shadow-xl z-50 min-w-48"
  >
    <div class="text-xs font-semibold text-muted mb-2">Default Values</div>
    {#each Object.entries(data.defaultValues ?? {}) as [key, value] (key)}
      <div class="flex items-center gap-2 mb-1.5">
        <span class="text-xs text-muted w-20 truncate">{key}</span>
        <input
          type="text"
          class="flex-1 text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
          value={value}
          readonly
        />
      </div>
    {/each}
    {#if Object.keys(data.defaultValues ?? {}).length === 0}
      <p class="text-xs text-muted/60 italic">No default values</p>
    {/if}
  </div>
{/if}

<!-- Input handles (left) -->
{#each data.inputHandles ?? [] as handle (handle.id)}
  <Handle
    type="target"
    position={Position.Left}
    id={handle.id}
    class="!w-3 !h-3 !border-2 !border-indigo-400 !bg-indigo-900 {showHandles ? '!opacity-100' : '!opacity-0'} transition-opacity"
  />
{/each}
{#if !data.inputHandles?.length}
  <Handle
    type="target"
    position={Position.Left}
    id="default-in"
    class="!w-3 !h-3 !border-2 !border-indigo-400 !bg-indigo-900 {showHandles ? '!opacity-100' : '!opacity-60'} transition-opacity"
  />
{/if}

<!-- Node body -->
<div
  class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-36 max-w-52 shadow-lg cursor-pointer select-none
    {selected ? 'border-accent shadow-accent/20' : 'border-border hover:border-border/80'}"
  role="button"
  tabindex="0"
  ondblclick={() => (showSettings = !showSettings)}
  onkeydown={(e) => e.key === 'Enter' && (showSettings = !showSettings)}
>
  <div class="flex items-center gap-2 mb-1">
    <div class="w-6 h-6 rounded-md bg-indigo-500/20 flex items-center justify-center shrink-0">
      <Bot size={12} class="text-indigo-400" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate">{data.label}</span>
  </div>
  {#if data.agentId}
    <div class="text-[10px] text-muted truncate font-mono">{data.agentId}</div>
  {/if}
</div>

<!-- Output handles (right) -->
{#each data.outputHandles ?? [] as handle (handle.id)}
  <Handle
    type="source"
    position={Position.Right}
    id={handle.id}
    class="!w-3 !h-3 !border-2 !border-emerald-400 !bg-emerald-900 {showHandles ? '!opacity-100' : '!opacity-60'} transition-opacity"
  />
{/each}
{#if !data.outputHandles?.length}
  <Handle
    type="source"
    position={Position.Right}
    id="default-out"
    class="!w-3 !h-3 !border-2 !border-emerald-400 !bg-emerald-900 {showHandles ? '!opacity-100' : '!opacity-60'} transition-opacity"
  />
{/if}

<!-- Context handles (bottom) -->
{#each data.contextHandles ?? [] as handle (handle.id)}
  <Handle
    type="source"
    position={Position.Bottom}
    id={handle.id}
    class="!w-3 !h-3 !border-2 !border-amber-400 !bg-amber-900 {showHandles ? '!opacity-100' : '!opacity-0'} transition-opacity"
  />
{/each}
{#if !data.contextHandles?.length}
  <Handle
    type="source"
    position={Position.Bottom}
    id="context-out"
    class="!w-3 !h-3 !border-2 !border-amber-400 !bg-amber-900 {showHandles ? '!opacity-100' : '!opacity-0'} transition-opacity"
  />
{/if}
