<script lang="ts">
  import { flowEditorState, setNodes } from '$lib/state/features/flow-editor.svelte';
  import type { FlowNode, AgentNodeData, PromptBoxData, LLMNodeData, TriggerNodeData } from '$lib/state/features/flow-editor.svelte';
  import { loadBuiltAgents } from '$lib/state/builder';
  import { Bot, Type, ChevronLeft, ChevronRight, Cpu, Zap } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import { sendRequest } from '$lib/services/gateway.svelte';

  let collapsed = $state(false);

  interface FlowNodeDescriptor {
    pluginId: string; id: string; kind: 'trigger' | 'action';
    label: string; description?: string; icon?: string;
    event?: string; method?: string;
  }
  let pluginNodes = $state<FlowNodeDescriptor[]>([]);

  const pluginGroups = $derived(
    Object.entries(
      pluginNodes.reduce<Record<string, FlowNodeDescriptor[]>>((acc, n) => {
        (acc[n.pluginId] ??= []).push(n);
        return acc;
      }, {}),
    ),
  );

  onMount(() => {
    loadBuiltAgents();
    (async () => {
      try {
        const res = (await sendRequest('flows.nodes.list', {})) as { nodes?: FlowNodeDescriptor[] } | null;
        if (res?.nodes) pluginNodes = res.nodes;
      } catch {
        pluginNodes = [];
      }
    })();
  });

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

  function addAgentNode() {
    const node: FlowNode = {
      id: makeId(),
      type: 'agent',
      position: getDropPosition(),
      data: {
        agentId: '',
        label: 'Agent',
        sessionMode: 'ephemeral',
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

  function addLLMNode() {
    const node: FlowNode = {
      id: makeId(),
      type: 'llm',
      position: getDropPosition(),
      data: {
        modelId: 'claude-haiku-4-5-20251001',
        label: 'LLM',
      } satisfies LLMNodeData,
    };
    setNodes([...flowEditorState.nodes, node]);
  }

  function addTriggerNode() {
    const node: FlowNode = {
      id: makeId(),
      type: 'trigger',
      position: getDropPosition(),
      data: { event: 'message:received', label: 'Message received', deliverResponse: false } satisfies TriggerNodeData,
    };
    setNodes([...flowEditorState.nodes, node]);
  }

  function addPluginNode(d: FlowNodeDescriptor) {
    const data =
      d.kind === 'trigger'
        ? { pluginId: d.pluginId, contributionId: d.id, event: d.event ?? '', label: d.label, deliverResponse: false }
        : { pluginId: d.pluginId, contributionId: d.id, method: d.method ?? '', label: d.label };
    const node: FlowNode = {
      id: makeId(),
      type: d.kind === 'trigger' ? 'pluginTrigger' : 'pluginAction',
      position: getDropPosition(),
      data: data as FlowNode['data'],
    };
    setNodes([...flowEditorState.nodes, node]);
  }

  function handleDragStart(
    e: DragEvent,
    payload:
      | { type: 'agent' | 'promptBox' | 'llm' | 'trigger'; agentId?: string; label?: string }
      | { type: 'pluginTrigger' | 'pluginAction'; descriptor: FlowNodeDescriptor },
  ) {
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
      <h2 class="text-[10px] font-semibold text-muted uppercase tracking-wider">{m.flow_palette()}</h2>
    {/if}
    <button
      onclick={() => (collapsed = !collapsed)}
      class="flex items-center justify-center w-5 h-5 rounded text-muted/60 hover:text-foreground hover:bg-bg3 transition-colors"
      title={collapsed ? m.flow_expandPalette() : m.flow_collapsePalette()}
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
      <!-- Trigger icon -->
      <button
        onclick={addTriggerNode}
        draggable="true"
        ondragstart={(e) => handleDragStart(e, { type: 'trigger' })}
        class="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
        title="Trigger"
      >
        <Zap size={13} class="text-amber-400" />
      </button>

      <!-- Prompt Box icon -->
      <button
        onclick={addPromptBox}
        draggable="true"
        ondragstart={(e) => handleDragStart(e, { type: 'promptBox', label: 'Prompt' })}
        class="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
        title={m.flow_promptBox()}
      >
        <Type size={13} class="text-violet-400" />
      </button>

      <!-- LLM icon -->
      <button
        onclick={addLLMNode}
        draggable="true"
        ondragstart={(e) => handleDragStart(e, { type: 'llm' })}
        class="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
        title="LLM"
      >
        <Cpu size={13} class="text-violet-400" />
      </button>

      <!-- Agent icon -->
      <button
        onclick={addAgentNode}
        draggable="true"
        ondragstart={(e) => handleDragStart(e, { type: 'agent' })}
        class="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
        title="Agent"
      >
        <Bot size={13} class="text-indigo-400" />
      </button>
    </div>
  {:else}
    <div class="flex-1 overflow-y-auto py-3 px-2 space-y-5">
      <!-- Inputs section -->
      <div>
        <p class="text-[9px] font-semibold text-muted/50 uppercase tracking-widest px-1 mb-1.5">
          {m.flow_inputs()}
        </p>
        <button
          onclick={addTriggerNode}
          draggable="true"
          ondragstart={(e) => handleDragStart(e, { type: 'trigger' })}
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
        >
          <div class="w-6 h-6 rounded bg-amber-500/20 flex items-center justify-center shrink-0">
            <Zap size={12} class="text-amber-400" />
          </div>
          <div>
            <div class="text-xs font-medium text-foreground">Trigger</div>
            <div class="text-[10px] text-muted">Event entry point</div>
          </div>
        </button>
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
            <div class="text-xs font-medium text-foreground">{m.flow_promptBox()}</div>
            <div class="text-[10px] text-muted">{m.flow_textInputNode()}</div>
          </div>
        </button>
        <button
          onclick={addLLMNode}
          draggable="true"
          ondragstart={(e) => handleDragStart(e, { type: 'llm' })}
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
        >
          <div class="w-6 h-6 rounded bg-violet-500/20 flex items-center justify-center shrink-0">
            <Cpu size={12} class="text-violet-400" />
          </div>
          <div>
            <div class="text-xs font-medium text-foreground">LLM</div>
            <div class="text-[10px] text-muted">Direct model call</div>
          </div>
        </button>
        <button
          onclick={addAgentNode}
          draggable="true"
          ondragstart={(e) => handleDragStart(e, { type: 'agent' })}
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
        >
          <div class="w-6 h-6 rounded bg-indigo-500/20 flex items-center justify-center shrink-0">
            <Bot size={12} class="text-indigo-400" />
          </div>
          <div>
            <div class="text-xs font-medium text-foreground">Agent</div>
            <div class="text-[10px] text-muted">Custom / personal / drone</div>
          </div>
        </button>
      </div>

      <!-- Plugin Nodes section -->
      {#if pluginGroups.length > 0}
        {#each pluginGroups as [pluginId, nodes] (pluginId)}
          <div>
            <p class="text-[9px] font-semibold text-muted/50 uppercase tracking-widest px-1 mb-1.5">
              {pluginId}
            </p>
            <div class="flex flex-col gap-0.5">
              {#each nodes as d (d.id)}
                <button
                  onclick={() => addPluginNode(d)}
                  draggable="true"
                  ondragstart={(e) => handleDragStart(e, { type: d.kind === 'trigger' ? 'pluginTrigger' : 'pluginAction', descriptor: d })}
                  class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
                >
                  <div class="w-6 h-6 rounded bg-violet-500/20 flex items-center justify-center shrink-0 text-[10px] text-violet-400">
                    {d.kind === 'trigger' ? '⚡' : '🧩'}
                  </div>
                  <div class="min-w-0">
                    <div class="text-xs font-medium text-foreground truncate">{d.label}</div>
                    <div class="text-[10px] text-muted truncate">{d.kind}</div>
                  </div>
                </button>
              {/each}
            </div>
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</aside>
