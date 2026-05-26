<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { AgentNodeData } from '$lib/state/features/flow-editor.svelte';
  import { flowEditorState, setNodes } from '$lib/state/features/flow-editor.svelte';
  import { gw } from '$lib/state/gateway/gateway-data.svelte';
  import { agentDisplayName } from '$lib/utils/agent-display';
  import { Bot } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  let { data, id, selected }: NodeProps & { data: AgentNodeData } = $props();

  let showSettings = $state(false);
  let hovered = $state(false);
  const showHandles = $derived(flowEditorState.relationshipMode || selected || hovered);

  function isHandleConnected(handleId: string): boolean {
    return flowEditorState.edges.some(
      (e) =>
        (e.source === id && e.sourceHandle === handleId) ||
        (e.target === id && e.targetHandle === handleId),
    );
  }

  function pickAgent(e: Event) {
    const agentId = (e.target as HTMLSelectElement).value;
    const found = gw.agents.find((a) => a.id === agentId);
    const label = found ? agentDisplayName(found) : agentId;
    const next = flowEditorState.nodes.map((n) =>
      n.id === id
        ? { ...n, data: { ...n.data, agentId, label } }
        : n,
    );
    setNodes(next);
  }

  function setSessionMode(mode: 'ephemeral' | 'shared') {
    const next = flowEditorState.nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, sessionMode: mode } } : n,
    );
    setNodes(next);
  }
</script>

<!-- Settings panel (shown above node when open) -->
{#if showSettings}
  <div
    class="absolute bottom-full mb-2 left-0 right-0 bg-bg2 border border-border rounded-lg p-3 shadow-xl z-50 min-w-48"
  >
    <div class="text-xs font-semibold text-muted mb-2">{m.flow_defaultValues()}</div>
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
      <p class="text-xs text-muted/60 italic">{m.flow_noDefaultValues()}</p>
    {/if}
  </div>
{/if}

<!-- Input handles (left) -->
{#each data.inputHandles ?? [] as handle (handle.id)}
  <Handle
    type="target"
    position={Position.Left}
    id={handle.id}
    class="!w-3 !h-3 !border-2 !border-indigo-400 !bg-indigo-900 !z-10 {showHandles || isHandleConnected(handle.id) ? '!opacity-100' : '!opacity-0'} transition-opacity"
  />
{/each}
{#if !data.inputHandles?.length}
  <Handle
    type="target"
    position={Position.Left}
    id="default-in"
    class="!w-3 !h-3 !border-2 !border-indigo-400 !bg-indigo-900 !z-10 {showHandles || isHandleConnected('default-in') ? '!opacity-100' : '!opacity-0'} transition-opacity"
  />
{/if}

<!-- Node body -->
<div
  class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-36 max-w-52 shadow-lg cursor-pointer select-none
    {selected ? 'border-accent shadow-accent/20' : 'border-border hover:border-border/80'}"
  role="button"
  tabindex="0"
  onmouseenter={() => (hovered = true)}
  onmouseleave={() => (hovered = false)}
  ondblclick={() => (showSettings = !showSettings)}
  onkeydown={(e) => e.key === 'Enter' && (showSettings = !showSettings)}
  oncontextmenu={(e) => {
    e.preventDefault();
    e.stopPropagation();
    flowEditorState.contextMenu = { open: true, x: e.clientX, y: e.clientY, nodeId: id };
  }}
>
  <div class="flex items-center gap-2 mb-1">
    <div class="w-6 h-6 rounded-md bg-indigo-500/20 flex items-center justify-center shrink-0">
      <Bot size={12} class="text-indigo-400" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate">{data.label || data.agentId}</span>
  </div>

  <!-- Agent picker -->
  <select
    class="mt-1 w-full text-[10px] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground"
    value={data.agentId}
    onclick={(e) => e.stopPropagation()}
    onchange={pickAgent}
  >
    {#if gw.agents.length === 0}
      <option value={data.agentId} disabled>{data.label || 'No agents connected'}</option>
    {:else}
      {#each gw.agents as agent (agent.id)}
        <option value={agent.id}>{agentDisplayName(agent)}</option>
      {/each}
      {#if data.agentId && !gw.agents.some((a) => a.id === data.agentId)}
        <option value={data.agentId}>{data.label}</option>
      {/if}
    {/if}
  </select>

  <!-- Session mode toggle -->
  <div class="mt-1.5 flex gap-1">
    <button
      class="flex-1 text-[9px] font-semibold rounded px-1 py-0.5 transition-colors
        {(data.sessionMode ?? 'ephemeral') === 'ephemeral'
          ? 'bg-indigo-500/25 text-indigo-300 border border-indigo-500/40'
          : 'text-muted/60 hover:text-muted border border-transparent'}"
      onclick={(e) => { e.stopPropagation(); setSessionMode('ephemeral'); }}
    >
      Ephemeral
    </button>
    <button
      class="flex-1 text-[9px] font-semibold rounded px-1 py-0.5 transition-colors
        {(data.sessionMode ?? 'ephemeral') === 'shared'
          ? 'bg-amber-500/25 text-amber-300 border border-amber-500/40'
          : 'text-muted/60 hover:text-muted border border-transparent'}"
      onclick={(e) => { e.stopPropagation(); setSessionMode('shared'); }}
    >
      Shared
    </button>
  </div>
</div>

<!-- Output handles (right) -->
{#each data.outputHandles ?? [] as handle (handle.id)}
  <Handle
    type="source"
    position={Position.Right}
    id={handle.id}
    class="!w-3 !h-3 !border-2 !border-emerald-400 !bg-emerald-900 {showHandles || isHandleConnected(handle.id) ? '!opacity-100' : '!opacity-0'} transition-opacity"
  />
{/each}
{#if !data.outputHandles?.length}
  <Handle
    type="source"
    position={Position.Right}
    id="default-out"
    class="!w-3 !h-3 !border-2 !border-emerald-400 !bg-emerald-900 {showHandles || isHandleConnected('default-out') ? '!opacity-100' : '!opacity-0'} transition-opacity"
  />
{/if}

<!-- Context handles (bottom) -->
{#each data.contextHandles ?? [] as handle (handle.id)}
  <Handle
    type="source"
    position={Position.Bottom}
    id={handle.id}
    class="!w-3 !h-3 !border-2 !border-amber-400 !bg-amber-900 {showHandles || isHandleConnected(handle.id) ? '!opacity-100' : '!opacity-0'} transition-opacity"
  />
{/each}
{#if !data.contextHandles?.length}
  <Handle
    type="source"
    position={Position.Bottom}
    id="context-out"
    class="!w-3 !h-3 !border-2 !border-amber-400 !bg-amber-900 {showHandles || isHandleConnected('context-out') ? '!opacity-100' : '!opacity-0'} transition-opacity"
  />
{/if}
