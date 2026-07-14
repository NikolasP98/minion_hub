<script lang="ts">
  import { Button } from '$lib/components/ui';
import { flowEditorState, setNodes, setPluginNodeDescriptors, setNodePresets, defaultConfigForFields } from '$lib/state/features/flow-editor.svelte';
  import type { FlowNodePreset } from '$lib/state/features/flow-editor.svelte';
  import type { FlowNode, AgentNodeData, PromptBoxData, LLMNodeData, TriggerNodeData, TransformNodeData, StructuredNodeData, RouterNodeData, ToolAgentNodeData, ChannelNodeData, HandoffNodeData, ReactionNodeData, SubflowNodeData, DatabaseNodeData, FileWriteNodeData, ScheduleNodeData, FlowNodeConfigField } from '$lib/state/features/flow-editor.svelte';
  import { loadBuiltAgents } from '$lib/state/builder';
  import { conn } from '$lib/state/gateway';
  import { Bot, Type, ChevronLeft, ChevronRight, Cpu, Zap, Braces, Split, Wrench, Send, Headset, SmilePlus, Puzzle, Workflow, Database, FileText, Clock } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import { sendRequest } from '$lib/services/gateway.svelte';

  let collapsed = $state(false);

  interface FlowNodeDescriptor {
    pluginId: string; id: string; kind: 'trigger' | 'action';
    label: string; description?: string; icon?: string; category?: string;
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

  const visiblePlugins = $derived(pluginNodes.filter((n) => !isRedundantChannelTrigger(n)));

  // Plugin nodes whose `category` matches a built-in function group slot in
  // alongside the built-ins (keyed by group title). The rest stay grouped by
  // plugin id in their own sections below.
  const pluginsByCategory = $derived.by(() => {
    const m: Record<string, FlowNodeDescriptor[]> = {};
    for (const n of visiblePlugins) {
      if (n.category && BUILTIN_TITLES.has(n.category)) (m[n.category] ??= []).push(n);
    }
    return m;
  });
  const uncategorizedGroups = $derived.by(() => {
    const m: Record<string, FlowNodeDescriptor[]> = {};
    for (const n of visiblePlugins) {
      if (!n.category || !BUILTIN_TITLES.has(n.category)) (m[n.pluginId] ??= []).push(n);
    }
    return Object.entries(m).filter(([, nodes]) => nodes.length > 0);
  });

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
        const res = (await sendRequest('flows.nodes.list', {})) as
          | { nodes?: FlowNodeDescriptor[]; presets?: FlowNodePreset[] }
          | null;
        if (res?.nodes) {
          pluginNodes = res.nodes;
          // Share descriptors with the editor so NodeConfigPanel can resolve
          // each plugin node's declared config fields.
          setPluginNodeDescriptors(res.nodes);
          // Plugin-contributed presets for built-in nodes (e.g. Router severity).
          setNodePresets(res.presets ?? []);
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

  function addHandoff() {
    const node: FlowNode = {
      id: makeId(), type: 'handoff', position: getDropPosition(),
      data: { label: 'Human Handoff', destinations: [], suggestionCount: 3, language: 'es' } satisfies HandoffNodeData,
    };
    setNodes([...flowEditorState.nodes, node]);
  }

  function addReaction() {
    const node: FlowNode = {
      id: makeId(), type: 'reaction', position: getDropPosition(),
      data: { label: 'Set Reaction', emoji: '👀' } satisfies ReactionNodeData,
    };
    setNodes([...flowEditorState.nodes, node]);
  }

  function addSubflow() {
    const node: FlowNode = {
      id: makeId(), type: 'subflow', position: getDropPosition(),
      data: { label: 'Subflow' } satisfies SubflowNodeData,
    };
    setNodes([...flowEditorState.nodes, node]);
  }

  function addDatabase() {
    const node: FlowNode = {
      id: makeId(), type: 'database', position: getDropPosition(),
      data: { label: 'Database', action: 'read', sql: '' } satisfies DatabaseNodeData,
    };
    setNodes([...flowEditorState.nodes, node]);
  }

  function addFileWrite() {
    const node: FlowNode = {
      id: makeId(), type: 'fileWrite', position: getDropPosition(),
      data: { label: 'Write File', path: 'report-{date}.md', mode: 'overwrite' } satisfies FileWriteNodeData,
    };
    setNodes([...flowEditorState.nodes, node]);
  }

  function addSchedule() {
    const node: FlowNode = {
      id: makeId(), type: 'schedule', position: getDropPosition(),
      data: { label: 'Schedule', every: 1, unit: 'days' } satisfies ScheduleNodeData,
    };
    setNodes([...flowEditorState.nodes, node]);
  }

  function handleDragStart(
    e: DragEvent,
    payload:
      | { type: 'agent' | 'promptBox' | 'llm' | 'trigger' | 'transform' | 'structured' | 'router' | 'toolAgent' | 'channel' | 'handoff' | 'reaction' | 'subflow' | 'database' | 'fileWrite' | 'schedule'; agentId?: string; label?: string }
      | { type: 'pluginTrigger' | 'pluginAction'; descriptor: FlowNodeDescriptor },
  ) {
    if (!e.dataTransfer) return;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/flow-node', JSON.stringify(payload));
  }

  // ── Palette, grouped by FUNCTION ────────────────────────────────────────────
  // One short, organised list instead of one long "Inputs" dump. All lucide
  // icons share a component type, so `typeof Zap` types every entry's icon.
  type BuiltinType = 'trigger' | 'promptBox' | 'llm' | 'agent' | 'toolAgent' | 'router' | 'structured' | 'transform' | 'channel' | 'handoff' | 'reaction' | 'subflow' | 'database' | 'fileWrite' | 'schedule';
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
        { type: 'trigger', label: 'Channel Trigger', desc: 'Inbound message · one or more channels', icon: Zap, color: 'text-[var(--color-warning-fg)]', bg: 'bg-[var(--color-warning-surface)]', add: addTriggerNode },
        { type: 'schedule', label: 'Schedule', desc: 'Run on a recurring interval', icon: Clock, color: 'text-[var(--color-warning-fg)]', bg: 'bg-[var(--color-warning-surface)]', add: addSchedule },
        { type: 'promptBox', label: 'Prompt Box', desc: 'Manual text input', icon: Type, color: 'text-[var(--color-purple)]', bg: 'bg-[color-mix(in_srgb,var(--color-purple)_20%,transparent)]', add: addPromptBox, dragLabel: 'Prompt' },
      ],
    },
    {
      title: 'AI',
      nodes: [
        { type: 'llm', label: 'LLM', desc: 'Direct model call', icon: Cpu, color: 'text-[var(--color-purple)]', bg: 'bg-[color-mix(in_srgb,var(--color-purple)_20%,transparent)]', add: addLLMNode },
        { type: 'agent', label: 'Agent', desc: 'Custom or personal agent', icon: Bot, color: 'text-[var(--color-purple)]', bg: 'bg-[color-mix(in_srgb,var(--color-purple)_20%,transparent)]', add: addAgentNode },
        { type: 'toolAgent', label: 'Tool Agent', desc: 'LLM with tool calls', icon: Wrench, color: 'text-[var(--color-success-fg)]', bg: 'bg-[var(--color-success-fg)]/20', add: addToolAgent },
      ],
    },
    {
      title: 'Logic & Data',
      nodes: [
        { type: 'router', label: 'Router / Classify', desc: 'Branch or classify — rule, LLM rubric, or both', icon: Split, color: 'text-[var(--color-warning-fg)]', bg: 'bg-[var(--color-warning-surface)]', add: addRouter },
        { type: 'structured', label: 'Structured', desc: 'Extract JSON', icon: Braces, color: 'text-[var(--color-cyan)]', bg: 'bg-[color-mix(in_srgb,var(--color-cyan)_20%,transparent)]', add: addStructured },
        { type: 'transform', label: 'Transform', desc: 'Template text', icon: Braces, color: 'text-[var(--color-text-tertiary)]', bg: 'bg-[var(--color-surface-2)]', add: addTransform },
        { type: 'database', label: 'Database', desc: 'Read / write a SQLite DB (CRUD)', icon: Database, color: 'text-[var(--color-cyan)]', bg: 'bg-[color-mix(in_srgb,var(--color-cyan)_20%,transparent)]', add: addDatabase },
        { type: 'subflow', label: 'Subflow', desc: 'Run another flow as a step', icon: Workflow, color: 'text-[var(--color-pink)]', bg: 'bg-[color-mix(in_srgb,var(--color-pink)_20%,transparent)]', add: addSubflow },
      ],
    },
    {
      title: 'Output',
      nodes: [
        { type: 'channel', label: 'Channel', desc: 'Send to WhatsApp / Telegram / …', icon: Send, color: 'text-[var(--color-cyan)]', bg: 'bg-[color-mix(in_srgb,var(--color-cyan)_20%,transparent)]', add: addChannelNode },
        { type: 'handoff', label: 'Human Handoff', desc: 'Claim → suggest → relay to a human until /end', icon: Headset, color: 'text-[var(--color-danger-fg)]', bg: 'bg-[var(--color-danger-surface)]', add: addHandoff },
        { type: 'reaction', label: 'Set Reaction', desc: 'Mark the trigger message with a status emoji', icon: SmilePlus, color: 'text-[var(--color-pink)]', bg: 'bg-[color-mix(in_srgb,var(--color-pink)_20%,transparent)]', add: addReaction },
        { type: 'fileWrite', label: 'Write File', desc: 'Save the message to a file', icon: FileText, color: 'text-[var(--color-text-tertiary)]', bg: 'bg-[var(--color-surface-2)]', add: addFileWrite },
      ],
    },
  ];

  /** Built-in function-group titles — plugin nodes matching one slot into it. */
  const BUILTIN_TITLES = new Set(CATEGORIES.map((c) => c.title));

  /** Drag payload for a built-in palette node. */
  function nodeDragPayload(node: PaletteNode) {
    return {
      type: node.type,
      ...(node.dragLabel ? { label: node.dragLabel } : {}),
    };
  }
</script>

<aside
  class="shrink-0 bg-bg2 border-r border-border flex flex-col overflow-hidden transition-all duration-[var(--duration-normal)] {collapsed
    ? 'w-9'
    : 'w-52'}"
>
  <!-- Header / collapse toggle -->
  <div class="flex items-center border-b border-border {collapsed ? 'justify-center px-0 py-2' : 'justify-between px-3 py-2.5'}">
    {#if !collapsed}
      <h2 class="text-[length:var(--font-size-telemetry)] font-semibold text-muted uppercase tracking-wider">{m.flow_palette()}</h2>
    {/if}
    <Button variant="ghost"
      onclick={() => (collapsed = !collapsed)}
      class="flex items-center justify-center w-5 h-5 rounded text-muted/60 hover:text-foreground hover:bg-bg3 transition-colors"
      title={collapsed ? m.flow_expandPalette() : m.flow_collapsePalette()}
    >
      {#if collapsed}
        <ChevronRight size={12} />
      {:else}
        <ChevronLeft size={12} />
      {/if}
    </Button>
  </div>

  {#if collapsed}
    <!-- Icon-only column when collapsed: function groups separated by a hairline -->
    <div class="flex-1 overflow-y-auto py-2 flex flex-col items-center gap-1">
      {#each CATEGORIES as cat, ci (cat.title)}
        {#if ci > 0}
          <div class="w-5 my-0.5 border-t border-border/40"></div>
        {/if}
        {#each cat.nodes as node (node.label)}
          {@const Icon = node.icon}
          <Button variant="ghost"
            onclick={node.add}
            draggable="true"
            ondragstart={(e: DragEvent) => handleDragStart(e, nodeDragPayload(node))}
            class="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
            title={node.label}
          >
            <Icon size={13} class={node.color} />
          </Button>
        {/each}
      {/each}
    </div>
  {:else}
    {#snippet pluginButton(d: FlowNodeDescriptor)}
      <Button variant="ghost"
        onclick={() => addPluginNode(d)}
        draggable="true"
        ondragstart={(e: DragEvent) => handleDragStart(e, { type: d.kind === 'trigger' ? 'pluginTrigger' : 'pluginAction', descriptor: d })}
        class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
      >
        <div class="w-6 h-6 rounded bg-[color-mix(in_srgb,var(--color-purple)_20%,transparent)] flex items-center justify-center shrink-0">
          {#if d.kind === 'trigger'}
            <Zap size={12} class="text-[var(--color-purple)]" />
          {:else}
            <Puzzle size={12} class="text-[var(--color-purple)]" />
          {/if}
        </div>
        <div class="min-w-0">
          <div class="text-xs font-medium text-foreground truncate">{d.label}</div>
          <div class="text-[length:var(--font-size-telemetry)] text-muted truncate">{d.description || (d.kind === 'trigger' ? 'trigger' : 'action')}</div>
        </div>
      </Button>
    {/snippet}

    <div class="flex-1 overflow-y-auto py-3 px-2 space-y-4">
      {#each CATEGORIES as cat (cat.title)}
        <div>
          <p class="text-[length:var(--font-size-telemetry)] font-semibold text-muted/50 uppercase tracking-widest px-1 mb-1.5">
            {cat.title}
          </p>
          <div class="flex flex-col gap-0.5">
            {#each cat.nodes as node (node.label)}
              {@const Icon = node.icon}
              <Button variant="ghost"
                onclick={node.add}
                draggable="true"
                ondragstart={(e: DragEvent) => handleDragStart(e, nodeDragPayload(node))}
                class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-bg3 transition-colors border border-transparent hover:border-border/60"
              >
                <div class="w-6 h-6 rounded {node.bg} flex items-center justify-center shrink-0">
                  <Icon size={12} class={node.color} />
                </div>
                <div class="min-w-0">
                  <div class="text-xs font-medium text-foreground truncate">{node.label}</div>
                  <div class="text-[length:var(--font-size-telemetry)] text-muted truncate">{node.desc}</div>
                </div>
              </Button>
            {/each}
            <!-- Plugin nodes that declared this function group -->
            {#each pluginsByCategory[cat.title] ?? [] as d (d.id)}
              {@render pluginButton(d)}
            {/each}
          </div>
        </div>
      {/each}

      <!-- Remaining plugin nodes, grouped by plugin id -->
      {#if uncategorizedGroups.length > 0}
        {#each uncategorizedGroups as [pluginId, nodes] (pluginId)}
          <div>
            <p class="text-[length:var(--font-size-telemetry)] font-semibold text-muted/50 uppercase tracking-widest px-1 mb-1.5">
              {pluginId}
            </p>
            <div class="flex flex-col gap-0.5">
              {#each nodes as d (d.id)}
                {@render pluginButton(d)}
              {/each}
            </div>
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</aside>
