<script lang="ts">
  import { flowEditorState, setNodes, setPluginNodeDescriptors, defaultConfigForFields } from '$lib/state/features/flow-editor.svelte';
  import type { FlowNode, AgentNodeData, PromptBoxData, LLMNodeData, TriggerNodeData, TransformNodeData, StructuredNodeData, RouterNodeData, ToolAgentNodeData, FlowNodeConfigField } from '$lib/state/features/flow-editor.svelte';
  import { loadBuiltAgents } from '$lib/state/builder';
  import { conn } from '$lib/state/gateway';
  import { Bot, Type, ChevronLeft, ChevronRight, Cpu, Zap, Braces, Split, Wrench } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import { sendRequest } from '$lib/services/gateway.svelte';

  let collapsed = $state(false);

  interface FlowNodeDescriptor {
    pluginId: string; id: string; kind: 'trigger' | 'action';
    label: string; description?: string; icon?: string;
    event?: string; method?: string; channelId?: string;
    config?: FlowNodeConfigField[];
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
  });

  // Load the plugin flow-node descriptors once the gateway connection is live.
  // A one-shot onMount fetch races the WS handshake: on a cold flow-editor load
  // the connection often isn't up yet, sendRequest rejects with "not connected",
  // and the plugin palette (and its config field defs) silently stays empty.
  // Reacting to `conn.connected` fetches as soon as we're connected and re-tries
  // on reconnect.
  let descriptorsLoaded = $state(false);
  $effect(() => {
    if (!conn.connected || descriptorsLoaded) return;
    void (async () => {
      try {
        const res = (await sendRequest('flows.nodes.list', {})) as { nodes?: FlowNodeDescriptor[] } | null;
        if (res?.nodes) {
          pluginNodes = res.nodes;
          // Share descriptors with the editor so NodeConfigPanel can resolve
          // each plugin node's declared config fields.
          setPluginNodeDescriptors(res.nodes);
          descriptorsLoaded = true;
        }
      } catch {
        // Leave descriptorsLoaded false so a later (re)connection re-triggers.
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
    const config = defaultConfigForFields(d.config);
    const data =
      d.kind === 'trigger'
        ? { pluginId: d.pluginId, contributionId: d.id, event: d.event ?? '', label: d.label, deliverResponse: false, filterChannelId: d.channelId, config }
        : { pluginId: d.pluginId, contributionId: d.id, method: d.method ?? '', label: d.label, config };
    const node: FlowNode = {
      id: makeId(),
      type: d.kind === 'trigger' ? 'pluginTrigger' : 'pluginAction',
      position: getDropPosition(),
      data: data as FlowNode['data'],
    };
    setNodes([...flowEditorState.nodes, node]);
  }

  function addTransform() {
    const node: FlowNode = {
      id: makeId(), type: 'transform', position: getDropPosition(),
      data: { template: '{input}', label: 'Transform' } satisfies TransformNodeData,
    };
    setNodes([...flowEditorState.nodes, node]);
  }

  function addStructured() {
    const node: FlowNode = {
      id: makeId(), type: 'structured', position: getDropPosition(),
      data: { modelId: 'claude-haiku-4-5-20251001', schema: '{\n  "type": "object",\n  "properties": {}\n}', label: 'Structured' } satisfies StructuredNodeData,
    };
    setNodes([...flowEditorState.nodes, node]);
  }

  function addRouter() {
    const node: FlowNode = {
      id: makeId(), type: 'router', position: getDropPosition(),
      data: { mode: 'rule', branches: [{ id: `b-${makeId()}`, label: 'Branch 1', rule: { op: 'contains', value: '' } }], label: 'Router' } satisfies RouterNodeData,
    };
    setNodes([...flowEditorState.nodes, node]);
  }

  function addToolAgent() {
    const node: FlowNode = {
      id: makeId(), type: 'toolAgent', position: getDropPosition(),
      data: { modelId: '', systemPrompt: '', tools: [], label: 'Tool Agent' } satisfies ToolAgentNodeData,
    };
    setNodes([...flowEditorState.nodes, node]);
  }

  function handleDragStart(
    e: DragEvent,
    payload:
      | { type: 'agent' | 'promptBox' | 'llm' | 'trigger' | 'transform' | 'structured' | 'router' | 'toolAgent'; agentId?: string; label?: string }
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
      <button
        onclick={addTransform}
        draggable="true"
        ondragstart={(e) => handleDragStart(e, { type: 'transform' })}
        class="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
        title="Transform"
      >
        <Braces size={13} class="text-slate-300" />
      </button>
      <button
        onclick={addStructured}
        draggable="true"
        ondragstart={(e) => handleDragStart(e, { type: 'structured' })}
        class="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
        title="Structured"
      >
        <Braces size={13} class="text-teal-300" />
      </button>
      <button
        onclick={addRouter}
        draggable="true"
        ondragstart={(e) => handleDragStart(e, { type: 'router' })}
        class="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
        title="Router"
      >
        <Split size={13} class="text-amber-400" />
      </button>
      <button
        onclick={addToolAgent}
        draggable="true"
        ondragstart={(e) => handleDragStart(e, { type: 'toolAgent' })}
        class="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
        title="Tool Agent"
      >
        <Wrench size={13} class="text-emerald-400" />
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
        <button
          onclick={addTransform}
          draggable="true"
          ondragstart={(e) => handleDragStart(e, { type: 'transform' })}
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
        >
          <div class="w-6 h-6 rounded bg-slate-500/20 flex items-center justify-center shrink-0">
            <Braces size={12} class="text-slate-300" />
          </div>
          <div>
            <div class="text-xs font-medium text-foreground">Transform</div>
            <div class="text-[10px] text-muted">Template text</div>
          </div>
        </button>
        <button
          onclick={addStructured}
          draggable="true"
          ondragstart={(e) => handleDragStart(e, { type: 'structured' })}
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
        >
          <div class="w-6 h-6 rounded bg-teal-500/20 flex items-center justify-center shrink-0">
            <Braces size={12} class="text-teal-300" />
          </div>
          <div>
            <div class="text-xs font-medium text-foreground">Structured</div>
            <div class="text-[10px] text-muted">JSON output</div>
          </div>
        </button>
        <button
          onclick={addRouter}
          draggable="true"
          ondragstart={(e) => handleDragStart(e, { type: 'router' })}
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
        >
          <div class="w-6 h-6 rounded bg-amber-500/20 flex items-center justify-center shrink-0">
            <Split size={12} class="text-amber-400" />
          </div>
          <div>
            <div class="text-xs font-medium text-foreground">Router</div>
            <div class="text-[10px] text-muted">Branch by rule / LLM</div>
          </div>
        </button>
        <button
          onclick={addToolAgent}
          draggable="true"
          ondragstart={(e) => handleDragStart(e, { type: 'toolAgent' })}
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
        >
          <div class="w-6 h-6 rounded bg-emerald-500/20 flex items-center justify-center shrink-0">
            <Wrench size={12} class="text-emerald-400" />
          </div>
          <div>
            <div class="text-xs font-medium text-foreground">Tool Agent</div>
            <div class="text-[10px] text-muted">LLM with tool calls</div>
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
