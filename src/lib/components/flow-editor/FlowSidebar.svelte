<script lang="ts">
  import { gw } from '$lib/state/gateway/gateway-data.svelte';
  import { flowEditorState, setNodes } from '$lib/state/features/flow-editor.svelte';
  import type { FlowNode, AgentNodeData, PromptBoxData } from '$lib/state/features/flow-editor.svelte';
  import { Bot, Type, ChevronLeft, ChevronRight } from 'lucide-svelte';

  let collapsed = $state(false);

  function makeId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  /** Returns a position near the visible canvas center with a small random spread. */
  function getDropPosition() {
    const { x: vx, y: vy, zoom: vz } = flowEditorState.canvasViewport;
    return {
      x: (-vx + 600) / vz + (Math.random() - 0.5) * 160,
      y: (-vy + 350) / vz + (Math.random() - 0.5) * 100,
    };
  }

  function addAgentNode(agentId: string, label: string) {
    const node: FlowNode = {
      id: makeId(),
      type: 'agent',
      position: getDropPosition(),
      data: {
        agentId,
        label,
        defaultValues: {},
        contextRules: [],
        inputHandles: [{ id: 'in', label: 'input' }],
        outputHandles: [{ id: 'out', label: 'output' }],
        contextHandles: [{ id: 'ctx', label: 'context' }],
      } satisfies AgentNodeData,
    };
    setNodes([...flowEditorState.nodes, node]);
  }

  function addPromptBox() {
    const node: FlowNode = {
      id: makeId(),
      type: 'promptBox',
      position: getDropPosition(),
      data: {
        label: 'Prompt',
        value: '',
      } satisfies PromptBoxData,
    };
    setNodes([...flowEditorState.nodes, node]);
  }

  function handleDragStart(e: DragEvent, payload: { type: 'agent' | 'promptBox'; agentId?: string; label?: string }) {
    if (!e.dataTransfer) return;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/flow-node', JSON.stringify(payload));
  }
</script>

<aside
  class="shrink-0 bg-bg2 border-r border-border flex flex-col overflow-hidden transition-all duration-200 {collapsed
    ? 'w-9'
    : 'w-52'}"
>
  <!-- Header / collapse toggle -->
  <div class="flex items-center border-b border-border {collapsed ? 'justify-center px-0 py-2' : 'justify-between px-3 py-2.5'}">
    {#if !collapsed}
      <h2 class="text-[10px] font-semibold text-muted uppercase tracking-wider">Palette</h2>
    {/if}
    <button
      onclick={() => (collapsed = !collapsed)}
      class="flex items-center justify-center w-5 h-5 rounded text-muted/60 hover:text-foreground hover:bg-bg3 transition-colors"
      title={collapsed ? 'Expand palette' : 'Collapse palette'}
    >
      {#if collapsed}
        <ChevronRight size={12} />
      {:else}
        <ChevronLeft size={12} />
      {/if}
    </button>
  </div>

  {#if collapsed}
    <!-- Icon-only column when collapsed -->
    <div class="flex-1 overflow-y-auto py-2 flex flex-col items-center gap-1">
      <!-- Prompt Box icon -->
      <button
        onclick={addPromptBox}
        draggable="true"
        ondragstart={(e) => handleDragStart(e, { type: 'promptBox', label: 'Prompt' })}
        class="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
        title="Prompt Box"
      >
        <Type size={13} class="text-violet-400" />
      </button>

      {#if gw.agents.length > 0}
        <div class="w-4 h-px bg-border/40 my-0.5"></div>
        {#each gw.agents as agent (agent.id)}
          <button
            onclick={() => addAgentNode(agent.id, agent.name ?? agent.id)}
            draggable="true"
            ondragstart={(e) => handleDragStart(e, { type: 'agent', agentId: agent.id, label: agent.name ?? agent.id })}
            class="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-bg3 transition-colors border border-transparent hover:border-border/60 text-sm"
            title={agent.name ?? agent.id}
          >
            {#if agent.emoji}
              {agent.emoji}
            {:else}
              <Bot size={13} class="text-indigo-400" />
            {/if}
          </button>
        {/each}
      {/if}
    </div>
  {:else}
    <div class="flex-1 overflow-y-auto py-3 px-2 space-y-5">
      <!-- Inputs section -->
      <div>
        <p class="text-[9px] font-semibold text-muted/50 uppercase tracking-widest px-1 mb-1.5">
          Inputs
        </p>
        <button
          onclick={addPromptBox}
          draggable="true"
          ondragstart={(e) => handleDragStart(e, { type: 'promptBox', label: 'Prompt' })}
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
        >
          <div class="w-6 h-6 rounded bg-violet-500/20 flex items-center justify-center shrink-0">
            <Type size={12} class="text-violet-400" />
          </div>
          <div>
            <div class="text-xs font-medium text-foreground">Prompt Box</div>
            <div class="text-[10px] text-muted">Text input node</div>
          </div>
        </button>
      </div>

      <!-- Agents section -->
      <div>
        <p class="text-[9px] font-semibold text-muted/50 uppercase tracking-widest px-1 mb-1.5">
          Agents
        </p>
        {#if gw.agents.length === 0}
          <p class="text-[10px] text-muted/50 italic px-2 py-1">No agents connected.</p>
        {:else}
          <div class="flex flex-col gap-0.5">
            {#each gw.agents as agent (agent.id)}
              <button
                onclick={() => addAgentNode(agent.id, agent.name ?? agent.id)}
                draggable="true"
                ondragstart={(e) => handleDragStart(e, { type: 'agent', agentId: agent.id, label: agent.name ?? agent.id })}
                class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
              >
                <div class="w-6 h-6 rounded bg-indigo-500/20 flex items-center justify-center shrink-0 text-sm">
                  {#if agent.emoji}
                    {agent.emoji}
                  {:else}
                    <Bot size={12} class="text-indigo-400" />
                  {/if}
                </div>
                <div class="min-w-0">
                  <div class="text-xs font-medium text-foreground truncate">{agent.name ?? agent.id}</div>
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</aside>
