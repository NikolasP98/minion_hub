<script lang="ts">
  import {
    SvelteFlow,
    Background,
    Controls,
    MiniMap,
    addEdge,
    useSvelteFlow,
    type Connection,
    type NodeTypes,
    type EdgeTypes,
    type ColorMode,
  } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';

  import AgentNode from './nodes/AgentNode.svelte';
  import PromptBoxNode from './nodes/PromptBoxNode.svelte';
  import FlowEdgeComponent from './edges/FlowEdge.svelte';
  import ContextEdgeComponent from './edges/ContextEdge.svelte';

  import {
    flowEditorState,
    setNodes,
    setEdges,
    setRelationshipMode,
    type FlowNode,
    type FlowEdge,
    type AgentNodeData,
    type PromptBoxData,
  } from '$lib/state/flow-editor.svelte';
  import { theme } from '$lib/state/theme.svelte';

  const nodeTypes: NodeTypes = {
    agent: AgentNode,
    promptBox: PromptBoxNode,
  };

  const edgeTypes: EdgeTypes = {
    flow: FlowEdgeComponent,
    context: ContextEdgeComponent,
  };

  const colorMode: ColorMode = $derived(theme.preset === 'light' ? 'light' : 'dark');

  const { screenToFlowPosition } = useSvelteFlow();

  function makeId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    const raw = e.dataTransfer?.getData('application/flow-node');
    if (!raw) return;

    let payload: { type: 'agent' | 'promptBox'; agentId?: string; label?: string };
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
    } else if (payload.type === 'agent' && payload.agentId) {
      const node: FlowNode = {
        id: makeId(),
        type: 'agent',
        position,
        data: {
          agentId: payload.agentId,
          label: payload.label ?? payload.agentId,
          defaultValues: {},
          contextRules: [],
          inputHandles: [{ id: 'in', label: 'input' }],
          outputHandles: [{ id: 'out', label: 'output' }],
          contextHandles: [{ id: 'ctx', label: 'context' }],
        } satisfies AgentNodeData,
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
  }

  function handleKeyUp(e: KeyboardEvent) {
    if (e.key === 'Shift') setRelationshipMode(false);
  }
</script>

<svelte:window onkeydown={handleKeyDown} onkeyup={handleKeyUp} />

<div
  class="flex-1 h-full {flowEditorState.relationshipMode ? 'cursor-crosshair' : ''}"
  role="region"
  aria-label="Flow canvas"
  ondragover={(e) => e.preventDefault()}
  ondrop={handleDrop}
>
  <SvelteFlow
    nodes={flowEditorState.nodes}
    edges={flowEditorState.edges}
    {nodeTypes}
    {edgeTypes}
    {colorMode}
    fitView
    onnodeschange={(changes) => {
      let dirty = false;
      const updated = [...flowEditorState.nodes];
      for (const change of changes) {
        if (change.type === 'position' && change.dragging === false && change.position) {
          // Only persist on drag-end, not during drag or @xyflow initialization
          const idx = updated.findIndex((n) => n.id === change.id);
          if (idx !== -1) {
            updated[idx] = { ...updated[idx], position: change.position };
            dirty = true;
          }
        }
        if (change.type === 'remove') {
          const idx = updated.findIndex((n) => n.id === change.id);
          if (idx !== -1) {
            updated.splice(idx, 1);
            dirty = true;
          }
        }
      }
      if (dirty) setNodes(updated);
    }}
    onedgeschange={(changes) => {
      const updated = [...flowEditorState.edges];
      for (const change of changes) {
        if (change.type === 'remove') {
          const idx = updated.findIndex((e) => e.id === change.id);
          if (idx !== -1) updated.splice(idx, 1);
        }
      }
      setEdges(updated);
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
