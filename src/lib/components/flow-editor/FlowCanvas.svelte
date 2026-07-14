<script lang="ts">
  import {
    SvelteFlow,
    Background,
    Controls,
    MiniMap,
    addEdge,
    type Connection,
    type NodeTypes,
    type EdgeTypes,
    type ColorMode,
  } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';

  import AgentNode from './nodes/AgentNode.svelte';
  import PromptBoxNode from './nodes/PromptBoxNode.svelte';
  import LLMNode from './nodes/LLMNode.svelte';
  import TriggerNode from './nodes/TriggerNode.svelte';
  import PluginNode from './nodes/PluginNode.svelte';
  import TransformNode from './nodes/TransformNode.svelte';
  import StructuredNode from './nodes/StructuredNode.svelte';
  import RouterNode from './nodes/RouterNode.svelte';
  import ToolAgentNode from './nodes/ToolAgentNode.svelte';
  import ChannelNode from './nodes/ChannelNode.svelte';
  import HandoffNode from './nodes/HandoffNode.svelte';
  import ReactionNode from './nodes/ReactionNode.svelte';
  import SubflowNode from './nodes/SubflowNode.svelte';
  import DatabaseNode from './nodes/DatabaseNode.svelte';
  import FileWriteNode from './nodes/FileWriteNode.svelte';
  import ScheduleNode from './nodes/ScheduleNode.svelte';
  import NodeConfigPanel from './nodes/NodeConfigPanel.svelte';
  import FlowActionIsland from './FlowActionIsland.svelte';
  import FlowHistoryPanel from './FlowHistoryPanel.svelte';
  import FlowRunStatusLayer from './FlowRunStatusLayer.svelte';
  import FlowEdgeComponent from './edges/FlowEdge.svelte';
  import ContextEdgeComponent from './edges/ContextEdge.svelte';
  import * as m from '$lib/paraglide/messages';

  import {
    flowEditorState,
    setNodes,
    setEdges,
    setRelationshipMode,
    openNodeConfig,
    closeNodeConfig,
    defaultConfigForFields,
    type FlowNodeConfigField,
    type FlowNode,
    type FlowEdge,
    type AgentNodeData,
    type PromptBoxData,
    type LLMNodeData,
    type TriggerNodeData,
    type PluginTriggerNodeData,
    type PluginActionNodeData,
    type TransformNodeData,
    type StructuredNodeData,
    type RouterNodeData,
    type ToolAgentNodeData,
    type ChannelNodeData,
    type HandoffNodeData,
    type ReactionNodeData,
    type SubflowNodeData,
    type DatabaseNodeData,
    type FileWriteNodeData,
    type ScheduleNodeData,
  } from '$lib/state/features/flow-editor.svelte';
  import { theme } from '$lib/state/ui/theme.svelte';

  const nodeTypes: NodeTypes = {
    agent: AgentNode,
    promptBox: PromptBoxNode,
    llm: LLMNode,
    trigger: TriggerNode,
    pluginTrigger: PluginNode,
    pluginAction: PluginNode,
    transform: TransformNode,
    structured: StructuredNode,
    router: RouterNode,
    toolAgent: ToolAgentNode,
    channel: ChannelNode,
    handoff: HandoffNode,
    reaction: ReactionNode,
    subflow: SubflowNode,
    database: DatabaseNode,
    fileWrite: FileWriteNode,
    schedule: ScheduleNode,
  };

  const edgeTypes: EdgeTypes = {
    flow: FlowEdgeComponent,
    context: ContextEdgeComponent,
  };

  const colorMode: ColorMode = $derived(theme.mode);

  // Decorate nodes with a run-status class so the status-colored outline (the
  // style rules below) tracks live nodeRuns without touching each node component.
  const statusClass: Record<string, string> = {
    running: 'flow-status-running',
    done: 'flow-status-done',
    error: 'flow-status-error',
    skipped: 'flow-status-skipped',
  };
  function diffRing(id: string): string {
    const s = flowEditorState.previewDiff?.nodes[id];
    return s === 'added'
      ? 'ring-2 ring-[var(--color-success-border)]'
      : s === 'changed'
        ? 'ring-2 ring-[var(--color-warning-border)]'
        : s === 'removed'
          ? 'ring-2 ring-[var(--color-danger-border)] opacity-60'
          : '';
  }
  const decoratedNodes = $derived(
    flowEditorState.nodes.map((n) => {
      const status = flowEditorState.nodeRuns[n.id]?.status;
      const cls = [status ? statusClass[status] : '', diffRing(n.id)].filter(Boolean).join(' ');
      return cls ? { ...n, class: cls } : n;
    }),
  );

  let containerEl: HTMLDivElement;

  function screenToFlowPosition(screenPos: { x: number; y: number }) {
    const rect = containerEl.getBoundingClientRect();
    const vp = flowEditorState.canvasViewport;
    return {
      x: (screenPos.x - rect.left - vp.x) / vp.zoom,
      y: (screenPos.y - rect.top - vp.y) / vp.zoom,
    };
  }

  function makeId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    const raw = e.dataTransfer?.getData('application/flow-node');
    if (!raw) return;

    let payload: {
      type: 'agent' | 'promptBox' | 'llm' | 'trigger' | 'pluginTrigger' | 'pluginAction' | 'transform' | 'structured' | 'router' | 'toolAgent' | 'channel' | 'handoff' | 'reaction' | 'subflow' | 'database' | 'fileWrite' | 'schedule';
      agentId?: string; label?: string;
      descriptor?: { pluginId: string; id: string; kind: 'trigger' | 'action'; label: string; event?: string; method?: string; channelId?: string; config?: FlowNodeConfigField[] };
    };
    try { payload = JSON.parse(raw); } catch { return; }

    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });

    if (payload.type === 'promptBox') {
      const node: FlowNode = {
        id: makeId(),
        type: 'promptBox',
        position,
        data: { label: 'Prompt', value: '' } satisfies PromptBoxData,
      };
      setNodes([...flowEditorState.nodes, node]);
    } else if (payload.type === 'agent') {
      const node: FlowNode = {
        id: makeId(),
        type: 'agent',
        position,
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
    } else if (payload.type === 'llm') {
      const node: FlowNode = {
        id: makeId(),
        type: 'llm',
        position,
        data: {
          modelId: 'claude-haiku-4-5-20251001',
          label: 'LLM',
        } satisfies LLMNodeData,
      };
      setNodes([...flowEditorState.nodes, node]);
    } else if (payload.type === 'trigger') {
      const node: FlowNode = {
        id: makeId(),
        type: 'trigger',
        position,
        data: { event: 'message:received', label: 'Channel message', deliverResponse: false, sources: [] } satisfies TriggerNodeData,
      };
      setNodes([...flowEditorState.nodes, node]);
    } else if (payload.type === 'pluginTrigger' && payload.descriptor) {
      const d = payload.descriptor;
      const node: FlowNode = {
        id: makeId(),
        type: 'pluginTrigger',
        position,
        data: { pluginId: d.pluginId, contributionId: d.id, event: d.event ?? '', label: d.label, deliverResponse: false, filterChannelId: d.channelId, config: defaultConfigForFields(d.config) } satisfies PluginTriggerNodeData,
      };
      setNodes([...flowEditorState.nodes, node]);
    } else if (payload.type === 'pluginAction' && payload.descriptor) {
      const d = payload.descriptor;
      const node: FlowNode = {
        id: makeId(),
        type: 'pluginAction',
        position,
        data: { pluginId: d.pluginId, contributionId: d.id, method: d.method ?? '', label: d.label, config: defaultConfigForFields(d.config) } satisfies PluginActionNodeData,
      };
      setNodes([...flowEditorState.nodes, node]);
    } else if (payload.type === 'transform') {
      const node: FlowNode = {
        id: makeId(), type: 'transform', position,
        data: { template: '{input}', label: 'Transform' } satisfies TransformNodeData,
      };
      setNodes([...flowEditorState.nodes, node]);
    } else if (payload.type === 'structured') {
      const node: FlowNode = {
        id: makeId(), type: 'structured', position,
        data: { modelId: 'claude-haiku-4-5-20251001', schema: '{\n  "type": "object",\n  "properties": {}\n}', label: 'Structured' } satisfies StructuredNodeData,
      };
      setNodes([...flowEditorState.nodes, node]);
    } else if (payload.type === 'router') {
      const node: FlowNode = {
        id: makeId(), type: 'router', position,
        data: { mode: 'rule', branches: [{ id: `b-${makeId()}`, label: 'Branch 1', rule: { op: 'contains', value: '' } }], label: 'Router' } satisfies RouterNodeData,
      };
      setNodes([...flowEditorState.nodes, node]);
    } else if (payload.type === 'toolAgent') {
      const node: FlowNode = {
        id: makeId(), type: 'toolAgent', position,
        data: { modelId: '', systemPrompt: '', tools: [], label: 'Tool Agent' } satisfies ToolAgentNodeData,
      };
      setNodes([...flowEditorState.nodes, node]);
    } else if (payload.type === 'channel') {
      const node: FlowNode = {
        id: makeId(), type: 'channel', position,
        data: { channel: '', destinations: [], label: 'Channel' } satisfies ChannelNodeData,
      };
      setNodes([...flowEditorState.nodes, node]);
    } else if (payload.type === 'handoff') {
      const node: FlowNode = {
        id: makeId(), type: 'handoff', position,
        data: { label: 'Human Handoff', destinations: [], suggestionCount: 3, language: 'es' } satisfies HandoffNodeData,
      };
      setNodes([...flowEditorState.nodes, node]);
    } else if (payload.type === 'reaction') {
      const node: FlowNode = {
        id: makeId(), type: 'reaction', position,
        data: { label: 'Set Reaction', emoji: '👀' } satisfies ReactionNodeData,
      };
      setNodes([...flowEditorState.nodes, node]);
    } else if (payload.type === 'subflow') {
      const node: FlowNode = {
        id: makeId(), type: 'subflow', position,
        data: { label: 'Subflow' } satisfies SubflowNodeData,
      };
      setNodes([...flowEditorState.nodes, node]);
    } else if (payload.type === 'database') {
      const node: FlowNode = {
        id: makeId(), type: 'database', position,
        data: { label: 'Database', action: 'read', sql: '' } satisfies DatabaseNodeData,
      };
      setNodes([...flowEditorState.nodes, node]);
    } else if (payload.type === 'fileWrite') {
      const node: FlowNode = {
        id: makeId(), type: 'fileWrite', position,
        data: { label: 'Write File', path: 'report-{date}.md', mode: 'overwrite' } satisfies FileWriteNodeData,
      };
      setNodes([...flowEditorState.nodes, node]);
    } else if (payload.type === 'schedule') {
      const node: FlowNode = {
        id: makeId(), type: 'schedule', position,
        data: { label: 'Schedule', every: 1, unit: 'days' } satisfies ScheduleNodeData,
      };
      setNodes([...flowEditorState.nodes, node]);
    }
  }

  function handleConnect(connection: Connection) {
    // Infer edge type from target handle: bottom handle → context, others → flow
    const isContext = connection.targetHandle?.includes('ctx') || connection.sourceHandle?.includes('ctx');
    const edgeType = isContext ? 'context' : 'flow';
    const newEdge: FlowEdge = {
      id: `e-${Date.now()}`,
      source: connection.source,
      sourceHandle: connection.sourceHandle ?? '',
      target: connection.target,
      targetHandle: connection.targetHandle ?? '',
      type: edgeType,
    };
    setEdges(addEdge(newEdge, flowEditorState.edges as FlowEdge[]));
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Shift') setRelationshipMode(true);
    if (e.key === 'Escape') {
      flowEditorState.contextMenu.open = false;
      closeNodeConfig();
    }
    // Enter opens the focused node's config panel — keyboard parity with the
    // mouse double-click. Ignored while typing or inside a dialog/panel.
    if (e.key === 'Enter') {
      const active = document.activeElement as HTMLElement | null;
      if (
        !active ||
        active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        active.isContentEditable ||
        active.closest('[role="dialog"]')
      )
        return;
      const id = active.closest('.svelte-flow__node')?.getAttribute('data-id');
      if (id) {
        e.preventDefault();
        openNodeConfig(id);
      }
    }
  }

  function handleKeyUp(e: KeyboardEvent) {
    if (e.key === 'Shift') setRelationshipMode(false);
  }
</script>

<svelte:window onkeydown={handleKeyDown} onkeyup={handleKeyUp} />

<div
  bind:this={containerEl}
  class="relative flex-1 h-full {flowEditorState.relationshipMode ? 'cursor-crosshair' : ''}"
  role="region"
  aria-label={m.flow_canvasLabel()}
  ondragover={(e) => e.preventDefault()}
  ondrop={handleDrop}
>
  <SvelteFlow
    nodes={decoratedNodes}
    edges={flowEditorState.edges}
    {nodeTypes}
    {edgeTypes}
    {colorMode}
    bind:viewport={flowEditorState.canvasViewport}
    fitView
    nodesFocusable
    edgesFocusable
    elementsSelectable
    autoPanOnNodeFocus
    onselectionchange={({ nodes: selected }) => {
      flowEditorState.selectedNodeIds = selected.map((n) => n.id);
    }}
    onnodedragstop={({ targetNode }) => {
      if (!targetNode) return;
      const updated = flowEditorState.nodes.map((n) =>
        n.id === targetNode.id ? { ...n, position: targetNode.position } : n
      );
      setNodes(updated);
    }}
    ondelete={({ nodes: deletedNodes, edges: deletedEdges }) => {
      if (deletedNodes.length > 0) {
        const ids = new Set(deletedNodes.map((n) => n.id));
        setNodes(flowEditorState.nodes.filter((n) => !ids.has(n.id)));
      }
      if (deletedEdges.length > 0) {
        const ids = new Set(deletedEdges.map((e) => e.id));
        setEdges(flowEditorState.edges.filter((e) => !ids.has(e.id)));
      }
    }}
    onconnect={handleConnect}
    defaultEdgeOptions={{ type: 'flow' }}
    proOptions={{ hideAttribution: true }}
  >
    <Background />
    <Controls />
    <MiniMap />
  </SvelteFlow>
  <FlowRunStatusLayer />
  <NodeConfigPanel />
  <FlowActionIsland />
  <FlowHistoryPanel />
</div>

<style>
  /* Run-status outline on the node, matching the status badge color. Applied
     via the `class` decorated onto each node in decoratedNodes. */
  :global(.svelte-flow__node.flow-status-running) {
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-elevation-2);
  }
  :global(.svelte-flow__node.flow-status-done) {
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-elevation-2);
  }
  :global(.svelte-flow__node.flow-status-error) {
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-elevation-2);
  }
  :global(.svelte-flow__node.flow-status-skipped) {
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-elevation-1);
    opacity: 0.6;
  }
  /* Keep node connectors (handles) above the node body for visibility. */
  :global(.svelte-flow__handle) {
    z-index: var(--layer-sticky);
  }
</style>
