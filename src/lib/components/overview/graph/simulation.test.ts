import { describe, it, expect } from 'vitest';
import { createSimulation } from './simulation';
import { buildGraph } from './build-graph';

const now = new Date().toISOString();
const input = {
  org: { id: 'org', name: 'FACES' },
  areas: [{
    id: 'a1', organizationId: 'org', name: 'Marketing', slug: 'marketing',
    icon: 'Megaphone', color: '#6366f1', sortOrder: 0,
    agentIds: ['ag1'], userIds: ['u1'], skillKeys: ['copywriting'],
    integrationKeys: ['slack'], virtualAgents: [],
    createdAt: now, updatedAt: now,
  }],
  agents: [{ id: 'ag1', name: 'Bot' }],
  members: [{ id: 'u1', displayName: 'Renzo', accountType: 'person' }],
  subscriptions: [],
};

const settle = (sim: ReturnType<typeof createSimulation>, n = 1000) => {
  for (let i = 0; i < n; i++) sim.tick();
};

describe('createSimulation', () => {
  it('keeps the org node pinned at the origin', () => {
    const { nodes, edges } = buildGraph(input);
    const sim = createSimulation(nodes, edges, { reducedMotion: true });
    settle(sim);
    const org = sim.nodes().find((nd) => nd.kind === 'org')!;
    expect(Math.hypot(org.x, org.y)).toBeLessThan(1);
    sim.stop();
  });

  it('settles free nodes near their anchors (reduced motion)', () => {
    const { nodes, edges } = buildGraph(input);
    const sim = createSimulation(nodes, edges, { reducedMotion: true });
    settle(sim);
    const area = sim.nodes().find((nd) => nd.kind === 'area')!;
    expect(Math.hypot(area.x - area.ax, area.y - area.ay)).toBeLessThan(80);
    sim.stop();
  });

  it('pins a node while dragging and returns it after release', () => {
    const { nodes, edges } = buildGraph(input);
    const sim = createSimulation(nodes, edges, { reducedMotion: true });
    const userId = nodes.find((nd) => nd.kind === 'user')!.id;
    sim.drag(userId, 50, 50);
    sim.tick();
    let u = sim.nodes().find((nd) => nd.id === userId)!;
    expect(u.x).toBeCloseTo(50, 1);
    expect(u.y).toBeCloseTo(50, 1);
    sim.release(userId);
    settle(sim);
    u = sim.nodes().find((nd) => nd.id === userId)!;
    expect(Math.hypot(u.x - u.ax, u.y - u.ay)).toBeLessThan(120);
    sim.stop();
  });
});
