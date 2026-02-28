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
  import FlowEdgeComponent from './edges/FlowEdge.svelte';
  import ContextEdgeComponent from './edges/ContextEdge.svelte';

  import {
    flowEditorState,
    setNodes,
    setEdges,
    setRelationshipMode,
    type FlowNode,
    type FlowEdge,
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
>
  <SvelteFlow
    nodes={flowEditorState.nodes}
    edges={flowEditorState.edges}
    {nodeTypes}
    {edgeTypes}
    {colorMode}
    fitView
    onnodeschange={(changes) => {
      // Apply position changes reactively
      const updated = [...flowEditorState.nodes];
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          const idx = updated.findIndex((n) => n.id === change.id);
          if (idx !== -1) updated[idx] = { ...updated[idx], position: change.position };
        }
        if (change.type === 'remove') {
          const idx = updated.findIndex((n) => n.id === change.id);
          if (idx !== -1) updated.splice(idx, 1);
        }
      }
      setNodes(updated);
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
  >
    <Background />
    <Controls />
    <MiniMap />
  </SvelteFlow>
</div>
