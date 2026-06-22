import { describe, it, expect } from 'vitest';
import {
  addNode,
  connectNodes,
  updateNodeConfig,
  setNodeLabel,
  removeNode,
  removeEdge,
  validateFlow,
} from './flow-ops';

const empty = { nodes: [], edges: [] };

describe('flow-ops', () => {
  it('addNode appends a node with given id + label', () => {
    const { flow, nodeId } = addNode(empty, { type: 'llm', label: 'Draft', id: 'llm-1' });
    expect(nodeId).toBe('llm-1');
    expect(flow.nodes).toHaveLength(1);
    expect(flow.nodes[0]).toMatchObject({ id: 'llm-1', type: 'llm', data: { label: 'Draft' } });
  });

  it('connectNodes adds an edge; rejects unknown node', () => {
    let f = addNode(empty, { type: 'trigger', label: 'T', id: 't1' }).flow;
    f = addNode(f, { type: 'llm', label: 'L', id: 'l1' }).flow;
    f = connectNodes(f, { source: 't1', target: 'l1' });
    expect(f.edges).toHaveLength(1);
    expect(f.edges[0]).toMatchObject({ source: 't1', target: 'l1', type: 'flow' });
    expect(() => connectNodes(f, { source: 't1', target: 'nope' })).toThrow();
  });

  it('connectNodes dedups identical edges', () => {
    let f = addNode(addNode(empty, { type: 'trigger', label: 'T', id: 't1' }).flow, {
      type: 'llm',
      label: 'L',
      id: 'l1',
    }).flow;
    f = connectNodes(f, { source: 't1', target: 'l1' });
    f = connectNodes(f, { source: 't1', target: 'l1' });
    expect(f.edges).toHaveLength(1);
  });

  it('updateNodeConfig shallow-merges data; setNodeLabel sets label', () => {
    let f = addNode(empty, { type: 'llm', label: 'L', id: 'l1', data: { modelId: 'x' } }).flow;
    f = updateNodeConfig(f, { nodeId: 'l1', data: { modelId: 'y' } });
    expect(f.nodes[0].data).toMatchObject({ modelId: 'y', label: 'L' });
    f = setNodeLabel(f, { nodeId: 'l1', label: 'New' });
    expect((f.nodes[0].data as { label: string }).label).toBe('New');
  });

  it('removeNode drops the node + incident edges', () => {
    let f = addNode(addNode(empty, { type: 'trigger', label: 'T', id: 't1' }).flow, {
      type: 'llm',
      label: 'L',
      id: 'l1',
    }).flow;
    f = connectNodes(f, { source: 't1', target: 'l1' });
    f = removeNode(f, { nodeId: 'l1' });
    expect(f.nodes).toHaveLength(1);
    expect(f.edges).toHaveLength(0);
  });

  it('removeEdge drops by id', () => {
    let f = addNode(addNode(empty, { type: 'trigger', label: 'T', id: 't1' }).flow, {
      type: 'llm',
      label: 'L',
      id: 'l1',
    }).flow;
    f = connectNodes(f, { source: 't1', target: 'l1' });
    const edgeId = f.edges[0].id;
    f = removeEdge(f, { edgeId });
    expect(f.edges).toHaveLength(0);
  });

  it('validateFlow flags missing trigger + dangling edge', () => {
    const noTrigger = addNode(empty, { type: 'llm', label: 'L', id: 'l1' }).flow;
    expect(validateFlow(noTrigger).issues.some((i) => /trigger/i.test(i))).toBe(true);
    const dangling = {
      nodes: [{ id: 't1', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'T' } }],
      edges: [{ id: 'e1', source: 't1', sourceHandle: 'out', target: 'ghost', targetHandle: 'in', type: 'flow' }],
    } as never;
    expect(validateFlow(dangling).issues.some((i) => /ghost|missing/i.test(i))).toBe(true);
  });
});
