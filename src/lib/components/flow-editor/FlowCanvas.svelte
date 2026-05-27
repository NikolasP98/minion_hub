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
  import FlowEdgeComponent from './edges/FlowEdge.svelte';
  import ContextEdgeComponent from './edges/ContextEdge.svelte';
  import * as m from '$lib/paraglide/messages';

  import {
    flowEditorState,
    setNodes,
    setEdges,
    setRelationshipMode,
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
  };

  const edgeTypes: EdgeTypes = {
    flow: FlowEdgeComponent,
    context: ContextEdgeComponent,
  };

  const colorMode: ColorMode = $derived(theme.preset.id === 'light' ? 'light' : 'dark');

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
      type: 'agent' | 'promptBox' | 'llm' | 'trigger' | 'pluginTrigger' | 'pluginAction' | 'transform' | 'structured';
      agentId?: string; label?: string;
      descriptor?: { pluginId: string; id: string; kind: 'trigger' | 'action'; label: string; event?: string; method?: string };
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
        data: { event: 'message:received', label: 'Message received', deliverResponse: false } satisfies TriggerNodeData,
      };
      setNodes([...flowEditorState.nodes, node]);
    } else if (payload.type === 'pluginTrigger' && payload.descriptor) {
      const d = payload.descriptor;
      const node: FlowNode = {
        id: makeId(),
        type: 'pluginTrigger',
        position,
        data: { pluginId: d.pluginId, contributionId: d.id, event: d.event ?? '', label: d.label, deliverResponse: false } satisfies PluginTriggerNodeData,
      };
      setNodes([...flowEditorState.nodes, node]);
    } else if (payload.type === 'pluginAction' && payload.descriptor) {
      const d = payload.descriptor;
      const node: FlowNode = {
        id: makeId(),
        type: 'pluginAction',
        position,
        data: { pluginId: d.pluginId, contributionId: d.id, method: d.method ?? '', label: d.label } satisfies PluginActionNodeData,
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
    if (e.key === 'Escape') flowEditorState.contextMenu.open = false;
  }

  function handleKeyUp(e: KeyboardEvent) {
    if (e.key === 'Shift') setRelationshipMode(false);
  }
</script>

<svelte:window onkeydown={handleKeyDown} onkeyup={handleKeyUp} />

<div
  bind:this={containerEl}
  class="flex-1 h-full {flowEditorState.relationshipMode ? 'cursor-crosshair' : ''}"
  role="region"
  aria-label={m.flow_canvasLabel()}
  ondragover={(e) => e.preventDefault()}
  ondrop={handleDrop}
>
  <SvelteFlow
    nodes={flowEditorState.nodes}
    edges={flowEditorState.edges}
    {nodeTypes}
    {edgeTypes}
    {colorMode}
    bind:viewport={flowEditorState.canvasViewport}
    fitView
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
</div>
