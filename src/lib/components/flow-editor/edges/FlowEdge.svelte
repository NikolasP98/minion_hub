<script lang="ts">
  import { BaseEdge, getBezierPath } from '@xyflow/svelte';
  import type { EdgeProps } from '@xyflow/svelte';

  let {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    label,
    selected,
    markerEnd,
    markerStart,
  }: EdgeProps = $props();

  const [edgePath, labelX, labelY] = $derived(
    getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition }),
  );
</script>

<BaseEdge
  {id}
  path={edgePath}
  {markerEnd}
  {markerStart}
  style="stroke: {selected ? 'var(--color-accent)' : 'var(--color-border)'};
         stroke-width: {selected ? 2 : 1.5};
         transition: stroke var(--duration-fast) var(--ease-standard);"
  {label}
  labelX={labelX}
  labelY={labelY}
  labelStyle="font-size: var(--font-size-telemetry); fill: var(--color-muted);"
/>
