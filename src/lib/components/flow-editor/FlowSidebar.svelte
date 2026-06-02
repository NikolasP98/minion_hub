<script lang="ts">
  import { flowEditorState, setNodes, setPluginNodeDescriptors, defaultConfigForFields } from '$lib/state/features/flow-editor.svelte';
  import type { FlowNode, AgentNodeData, PromptBoxData, LLMNodeData, TriggerNodeData, TransformNodeData, StructuredNodeData, RouterNodeData, ToolAgentNodeData, ChannelNodeData, FlowNodeConfigField } from '$lib/state/features/flow-editor.svelte';
  import { loadBuiltAgents } from '$lib/state/builder';
  import { conn } from '$lib/state/gateway';
  import { Bot, Type, ChevronLeft, ChevronRight, Cpu, Zap, Braces, Split, Wrench, Send, Puzzle } from 'lucide-svelte';
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

  // A per-channel "message" trigger (kind=trigger, channel-scoped, on the inbound
  // message event) is now superseded by the built-in Channel Trigger node — hide
  // it from the palette so the node list stays short. Older gateways that still
  // ship these descriptors are filtered here until they redeploy.
  function isRedundantChannelTrigger(n: FlowNodeDescriptor): boolean {
    return n.kind === 'trigger' && !!n.channelId && n.event === 'message:received';
  }

  const pluginGroups = $derived(
    Object.entries(
      pluginNodes
        .filter((n) => !isRedundantChannelTrigger(n))
        .reduce<Record<string, FlowNodeDescriptor[]>>((acc, n) => {
          (acc[n.pluginId] ??= []).push(n);
          return acc;
        }, {}),
    ).filter(([, nodes]) => nodes.length > 0),
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
      data: { event: 'message:received', label: 'Channel message', deliverResponse: false, sources: [] } satisfies TriggerNodeData,
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

  function addChannelNode() {
    const node: FlowNode = {
      id: makeId(), type: 'channel', position: getDropPosition(),
      data: { channel: '', destinations: [], label: 'Channel' } satisfies ChannelNodeData,
    };
    setNodes([...flowEditorState.nodes, node]);
  }

  function handleDragStart(
    e: DragEvent,
    payload:
      | { type: 'agent' | 'promptBox' | 'llm' | 'trigger' | 'transform' | 'structured' | 'router' | 'toolAgent' | 'channel'; agentId?: string; label?: string }
      | { type: 'pluginTrigger' | 'pluginAction'; descriptor: FlowNodeDescriptor },
  ) {
    if (!e.dataTransfer) return;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/flow-node', JSON.stringify(payload));
  }

  // ── Palette, grouped by FUNCTION ────────────────────────────────────────────
  // One short, organised list instead of one long "Inputs" dump. All lucide
  // icons share a component type, so `typeof Zap` types every entry's icon.
  type BuiltinType = 'trigger' | 'promptBox' | 'llm' | 'agent' | 'toolAgent' | 'router' | 'structured' | 'transform' | 'channel';
  type PaletteNode = {
    type: BuiltinType;
    label: string;
    desc: string;
    icon: typeof Zap;
    color: string;
    bg: string;
    add: () => void;
    dragLabel?: string;
  };
  const CATEGORIES: { title: string; nodes: PaletteNode[] }[] = [
    {
      title: 'Triggers',
      nodes: [
        { type: 'trigger', label: 'Channel Trigger', desc: 'Inbound message · one or more channels', icon: Zap, color: 'text-amber-400', bg: 'bg-amber-500/20', add: addTriggerNode },
        { type: 'promptBox', label: 'Prompt Box', desc: 'Manual text input', icon: Type, color: 'text-violet-400', bg: 'bg-violet-500/20', add: addPromptBox, dragLabel: 'Prompt' },
      ],
    },
    {
      title: 'AI',
      nodes: [
        { type: 'llm', label: 'LLM', desc: 'Direct model call', icon: Cpu, color: 'text-violet-400', bg: 'bg-violet-500/20', add: addLLMNode },
        { type: 'agent', label: 'Agent', desc: 'Custom / personal / drone', icon: Bot, color: 'text-indigo-400', bg: 'bg-indigo-500/20', add: addAgentNode },
        { type: 'toolAgent', label: 'Tool Agent', desc: 'LLM with tool calls', icon: Wrench, color: 'text-emerald-400', bg: 'bg-emerald-500/20', add: addToolAgent },
      ],
    },
    {
      title: 'Logic & Data',
      nodes: [
        { type: 'router', label: 'Router', desc: 'Branch / classify by rule or LLM', icon: Split, color: 'text-amber-400', bg: 'bg-amber-500/20', add: addRouter },
        { type: 'structured', label: 'Structured', desc: 'Extract JSON', icon: Braces, color: 'text-teal-300', bg: 'bg-teal-500/20', add: addStructured },
        { type: 'transform', label: 'Transform', desc: 'Template text', icon: Braces, color: 'text-slate-300', bg: 'bg-slate-500/20', add: addTransform },
      ],
    },
    {
      title: 'Output',
      nodes: [
        { type: 'channel', label: 'Channel', desc: 'Send to WhatsApp / Telegram / …', icon: Send, color: 'text-cyan-400', bg: 'bg-cyan-500/20', add: addChannelNode },
      ],
    },
  ];
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
    <!-- Icon-only column when collapsed: function groups separated by a hairline -->
    <div class="flex-1 overflow-y-auto py-2 flex flex-col items-center gap-1">
      {#each CATEGORIES as cat, ci (cat.title)}
        {#if ci > 0}
          <div class="w-5 my-0.5 border-t border-border/40"></div>
        {/if}
        {#each cat.nodes as node (node.type)}
          {@const Icon = node.icon}
          <button
            onclick={node.add}
            draggable="true"
            ondragstart={(e) => handleDragStart(e, node.dragLabel ? { type: node.type, label: node.dragLabel } : { type: node.type })}
            class="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
            title={node.label}
          >
            <Icon size={13} class={node.color} />
          </button>
        {/each}
      {/each}
    </div>
  {:else}
    <div class="flex-1 overflow-y-auto py-3 px-2 space-y-4">
      {#each CATEGORIES as cat (cat.title)}
        <div>
          <p class="text-[9px] font-semibold text-muted/50 uppercase tracking-widest px-1 mb-1.5">
            {cat.title}
          </p>
          <div class="flex flex-col gap-0.5">
            {#each cat.nodes as node (node.type)}
              {@const Icon = node.icon}
              <button
                onclick={node.add}
                draggable="true"
                ondragstart={(e) => handleDragStart(e, node.dragLabel ? { type: node.type, label: node.dragLabel } : { type: node.type })}
                class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
              >
                <div class="w-6 h-6 rounded {node.bg} flex items-center justify-center shrink-0">
                  <Icon size={12} class={node.color} />
                </div>
                <div class="min-w-0">
                  <div class="text-xs font-medium text-foreground truncate">{node.label}</div>
                  <div class="text-[10px] text-muted truncate">{node.desc}</div>
                </div>
              </button>
            {/each}
          </div>
        </div>
      {/each}

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
                  <div class="w-6 h-6 rounded bg-violet-500/20 flex items-center justify-center shrink-0">
                    {#if d.kind === 'trigger'}
                      <Zap size={12} class="text-violet-400" />
                    {:else}
                      <Puzzle size={12} class="text-violet-400" />
                    {/if}
                  </div>
                  <div class="min-w-0">
                    <div class="text-xs font-medium text-foreground truncate">{d.label}</div>
                    <div class="text-[10px] text-muted truncate">{d.kind === 'trigger' ? 'trigger' : 'action'}</div>
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
