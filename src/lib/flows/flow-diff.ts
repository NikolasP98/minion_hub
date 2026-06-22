import type { WorkingFlow } from './flow-ops';

export type FlowDiff = {
  nodes: Record<string, 'added' | 'removed' | 'changed'>;
  edges: Record<string, 'added' | 'removed'>;
};

const sig = (data: unknown, type: string) => `${type}:${JSON.stringify(data)}`;

export function diffFlow(current: WorkingFlow, proposed: WorkingFlow): FlowDiff {
  const diff: FlowDiff = { nodes: {}, edges: {} };
  const cur = new Map(current.nodes.map((n) => [n.id, n]));
  const prop = new Map(proposed.nodes.map((n) => [n.id, n]));
  for (const [id, p] of prop) {
    const c = cur.get(id);
    if (!c) diff.nodes[id] = 'added';
    else if (sig(c.data, c.type) !== sig(p.data, p.type)) diff.nodes[id] = 'changed';
  }
  for (const id of cur.keys()) if (!prop.has(id)) diff.nodes[id] = 'removed';

  const curE = new Map(current.edges.map((e) => [e.id, e]));
  const propE = new Map(proposed.edges.map((e) => [e.id, e]));
  for (const id of propE.keys()) if (!curE.has(id)) diff.edges[id] = 'added';
  for (const id of curE.keys()) if (!propE.has(id)) diff.edges[id] = 'removed';
  return diff;
}
