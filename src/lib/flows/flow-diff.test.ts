import { describe, it, expect } from 'vitest';
import { diffFlow } from './flow-diff';

const n = (id: string, data: object = { label: id }) => ({ id, type: 'llm', position: { x: 0, y: 0 }, data });
const e = (id: string, s: string, t: string) => ({
  id,
  source: s,
  sourceHandle: 'out',
  target: t,
  targetHandle: 'in',
  type: 'flow',
});

describe('diffFlow', () => {
  it('classifies added / removed / changed', () => {
    const cur = { nodes: [n('a'), n('b')], edges: [e('e1', 'a', 'b')] } as never;
    const prop = { nodes: [n('a', { label: 'A2' }), n('c')], edges: [e('e2', 'a', 'c')] } as never;
    const d = diffFlow(cur, prop);
    expect(d.nodes).toEqual({ a: 'changed', b: 'removed', c: 'added' });
    expect(d.edges).toEqual({ e1: 'removed', e2: 'added' });
  });

  it('empty diff when identical', () => {
    const cur = { nodes: [n('a')], edges: [] } as never;
    expect(diffFlow(cur, cur)).toEqual({ nodes: {}, edges: {} });
  });
});
