import type { FlowNode, FlowEdge } from '$lib/state/features/flow-editor.svelte';

export type WorkingFlow = { nodes: FlowNode[]; edges: FlowEdge[] };

const clone = (f: WorkingFlow): WorkingFlow => ({ nodes: [...f.nodes], edges: [...f.edges] });
const has = (f: WorkingFlow, id: string) => f.nodes.some((n) => n.id === id);

export function addNode(
  f: WorkingFlow,
  args: {
    type: string;
    label: string;
    data?: Record<string, unknown>;
    position?: { x: number; y: number };
    id?: string;
  },
): { flow: WorkingFlow; nodeId: string } {
  const id = args.id ?? `${args.type}-${crypto.randomUUID().slice(0, 8)}`;
  if (has(f, id)) throw new Error(`node id already exists: ${id}`);
  const node = {
    id,
    type: args.type,
    position: args.position ?? { x: 0, y: 0 },
    data: { label: args.label, ...(args.data ?? {}) },
  } as unknown as FlowNode;
  const flow = clone(f);
  flow.nodes = [...flow.nodes, node];
  return { flow, nodeId: id };
}

export function connectNodes(
  f: WorkingFlow,
  args: { source: string; target: string; sourceHandle?: string; targetHandle?: string },
): WorkingFlow {
  if (!has(f, args.source)) throw new Error(`unknown source: ${args.source}`);
  if (!has(f, args.target)) throw new Error(`unknown target: ${args.target}`);
  const sourceHandle = args.sourceHandle ?? 'out';
  const targetHandle = args.targetHandle ?? 'in';
  const dup = f.edges.some(
    (e) =>
      e.source === args.source &&
      e.target === args.target &&
      e.sourceHandle === sourceHandle &&
      e.targetHandle === targetHandle,
  );
  if (dup) return f;
  const edge = {
    id: `e-${crypto.randomUUID().slice(0, 8)}`,
    source: args.source,
    sourceHandle,
    target: args.target,
    targetHandle,
    type: 'flow' as const,
  } as FlowEdge;
  const flow = clone(f);
  flow.edges = [...flow.edges, edge];
  return flow;
}

function mapNode(f: WorkingFlow, nodeId: string, fn: (n: FlowNode) => FlowNode): WorkingFlow {
  if (!has(f, nodeId)) throw new Error(`unknown node: ${nodeId}`);
  const flow = clone(f);
  flow.nodes = flow.nodes.map((n) => (n.id === nodeId ? fn(n) : n));
  return flow;
}

export function updateNodeConfig(
  f: WorkingFlow,
  args: { nodeId: string; data: Record<string, unknown> },
): WorkingFlow {
  return mapNode(
    f,
    args.nodeId,
    (n) => ({ ...n, data: { ...(n.data as object), ...args.data } }) as FlowNode,
  );
}

export function removeNode(f: WorkingFlow, args: { nodeId: string }): WorkingFlow {
  if (!has(f, args.nodeId)) throw new Error(`unknown node: ${args.nodeId}`);
  const flow = clone(f);
  flow.nodes = flow.nodes.filter((n) => n.id !== args.nodeId);
  flow.edges = flow.edges.filter((e) => e.source !== args.nodeId && e.target !== args.nodeId);
  return flow;
}

export function removeEdge(f: WorkingFlow, args: { edgeId: string }): WorkingFlow {
  const flow = clone(f);
  flow.edges = flow.edges.filter((e) => e.id !== args.edgeId);
  return flow;
}

const TRIGGER_TYPES = new Set(['trigger', 'schedule', 'pluginTrigger']);

export function validateFlow(f: WorkingFlow): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!f.nodes.some((n) => TRIGGER_TYPES.has(n.type))) issues.push('Flow has no trigger/schedule node.');
  const ids = new Set(f.nodes.map((n) => n.id));
  if (ids.size !== f.nodes.length) issues.push('Duplicate node ids.');
  for (const e of f.edges) {
    if (!ids.has(e.source)) issues.push(`Edge ${e.id} references missing source ${e.source}.`);
    if (!ids.has(e.target)) issues.push(`Edge ${e.id} references missing (ghost) target ${e.target}.`);
  }
  return { ok: issues.length === 0, issues };
}
