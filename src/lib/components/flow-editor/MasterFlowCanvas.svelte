<script lang="ts">
  import {
    SvelteFlow,
    Background,
    Controls,
    MiniMap,
    MarkerType,
    type Node,
    type Edge,
    type NodeTypes,
    type ColorMode,
  } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';

  import MasterNode from './MasterNode.svelte';
  import type { MasterFlow } from '$lib/flows/master-flows';
  import { theme } from '$lib/state/ui/theme.svelte';

  let { flow }: { flow: MasterFlow } = $props();

  const nodeTypes: NodeTypes = { master: MasterNode };
  const colorMode: ColorMode = $derived(theme.mode);

  // Read-only: master flows are curated docs, never edited or persisted. We map
  // the static definition into xyflow nodes/edges fresh each time `flow` changes.
  const nodes = $derived<Node[]>(
    flow.nodes.map((n) => ({
      id: n.id,
      type: 'master',
      position: n.position,
      data: n as unknown as Record<string, unknown>,
      draggable: false,
      selectable: false,
      connectable: false,
      deletable: false,
    })),
  );

  const edges = $derived<Edge[]>(
    flow.edges.map((e) => {
      const loop = e.variant === 'loop';
      const parallel = e.variant === 'parallel';
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? 'out',
        targetHandle: 'in',
        label: e.label,
        type: 'smoothstep',
        animated: loop,
        selectable: false,
        deletable: false,
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        style: parallel
          ? 'stroke-dasharray: 5 5; opacity: 0.6;'
          : loop
            ? 'stroke: var(--color-success-fg); opacity: 0.85;'
            : undefined,
        labelStyle: 'font-size: var(--font-size-telemetry);',
      } satisfies Edge;
    }),
  );
</script>

<div class="relative w-full h-full">
  <SvelteFlow
    {nodes}
    {edges}
    {nodeTypes}
    {colorMode}
    fitView
    fitViewOptions={{ ['padding']: 0.12, minZoom: 0.1 }}
    minZoom={0.1}
    nodesDraggable={false}
    nodesConnectable={false}
    elementsSelectable={false}
    panOnDrag
    zoomOnScroll
    proOptions={{ hideAttribution: true }}
  >
    <Background />
    <Controls showLock={false} />
    <MiniMap />
  </SvelteFlow>
</div>
