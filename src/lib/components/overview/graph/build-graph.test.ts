import { describe, it, expect } from 'vitest';
import { buildGraph, RADII, hexToRgba, shade } from './build-graph';
import type { OrgArea } from '$server/services/org-areas.service';

const area = (over: Partial<OrgArea> = {}): OrgArea => ({
  id: 'a1', organizationId: 'org', name: 'Marketing', slug: 'marketing',
  icon: 'Megaphone', color: '#6366f1', sortOrder: 0,
  agentIds: ['ag1'], userIds: ['u1'], skillKeys: ['copywriting'],
  integrationKeys: ['meta'], virtualAgents: [], createdAt: null, updatedAt: null, ...over,
}) as OrgArea;

const base = () => ({
  org: { id: 'org', name: 'FACES' },
  areas: [area()],
  agents: [{ id: 'ag1', name: 'Bot' }],
  members: [{ id: 'u1', displayName: 'Renzo', accountType: 'person' }],
  subscriptions: [],
});

const dist = (n: { ax: number; ay: number }) => Math.hypot(n.ax, n.ay);

describe('buildGraph', () => {
  it('places the org node at the origin, pinned', () => {
    const { nodes } = buildGraph(base());
    const org = nodes.find((n) => n.kind === 'org')!;
    expect(org.ax).toBe(0);
    expect(org.ay).toBe(0);
    expect(org.pinned).toBe(true);
  });

  it('anchors each kind on its ring radius', () => {
    const { nodes } = buildGraph(base());
    const byKind = (k: string) => nodes.find((n) => n.kind === k)!;
    expect(dist(byKind('area'))).toBeCloseTo(RADII.area, 5);
    expect(dist(byKind('skill'))).toBeCloseTo(RADII.skill, 5);
    expect(dist(byKind('agent'))).toBeCloseTo(RADII.agent, 5);
    expect(dist(byKind('user'))).toBeCloseTo(RADII.user, 5);
  });

  it('builds one integration node (disc+logo collapsed) with a logo image', () => {
    const { nodes } = buildGraph(base());
    const ints = nodes.filter((n) => n.kind === 'integration');
    expect(ints).toHaveLength(1);
    expect(ints[0].logoImage).toBeTruthy();
    expect(dist(ints[0])).toBeCloseTo(RADII.integration, 5);
  });

  it('excludes service accounts from the user ring and gives them a shared band node', () => {
    const input = {
      org: { id: 'org', name: 'FACES' },
      areas: [area({ userIds: ['u1'] })],
      agents: [{ id: 'ag1', name: 'Bot' }],
      members: [
        { id: 'u1', displayName: 'Renzo', accountType: 'person' },
        { id: 's1', displayName: 'Faces Admin', accountType: 'service' },
      ],
      subscriptions: [],
    };
    const { nodes } = buildGraph(input);
    expect(nodes.some((n) => n.kind === 'user' && n.id.includes('s1'))).toBe(false);
    const shared = nodes.find((n) => n.kind === 'shared')!;
    expect(shared).toBeTruthy();
    expect(dist(shared)).toBeCloseTo(RADII.shared, 5);
  });

  it('emits a dashed subscription edge from shared account to subscriber user node', () => {
    const input = {
      org: { id: 'org', name: 'FACES' },
      areas: [area({ userIds: ['u1'] })],
      agents: [{ id: 'ag1', name: 'Bot' }],
      members: [
        { id: 'u1', displayName: 'Renzo', accountType: 'person' },
        { id: 's1', displayName: 'Faces Admin', accountType: 'service' },
      ],
      subscriptions: [{ subscriberProfileId: 'u1', ownerProfileId: 's1' }],
    };
    const { edges } = buildGraph(input);
    expect(edges.some((e) => e.dashed && e.source === 'shared:s1' && e.target === 'user:a1:u1')).toBe(true);
  });

  it('creates an Unassigned bucket for loose agents', () => {
    const input = {
      org: { id: 'org', name: 'FACES' },
      areas: [area({ agentIds: [], userIds: [] })],
      agents: [{ id: 'ag1', name: 'Bot' }],
      members: [{ id: 'u1', displayName: 'Renzo', accountType: 'person' }],
      subscriptions: [],
    };
    const { nodes } = buildGraph(input);
    expect(nodes.some((n) => n.kind === 'agent' && n.id.includes('__unassigned__'))).toBe(true);
  });
});

describe('helpers', () => {
  describe('hexToRgba', () => {
    it('converts hex with leading # to rgba with alpha', () => {
      expect(hexToRgba('#6366f1', 0.5)).toBe('rgba(99,102,241,0.5)');
    });

    it('converts hex without leading # to rgba with alpha', () => {
      expect(hexToRgba('6366f1', 0.5)).toBe('rgba(99,102,241,0.5)');
    });

    it('returns input unchanged for malformed hex', () => {
      expect(hexToRgba('nope', 0.5)).toBe('nope');
      expect(hexToRgba('fff', 0.5)).toBe('fff');
      expect(hexToRgba('#gggggg', 0.5)).toBe('#gggggg');
    });

    it('passes through alpha value correctly', () => {
      expect(hexToRgba('#ffffff', 0)).toBe('rgba(255,255,255,0)');
      expect(hexToRgba('#ffffff', 1)).toBe('rgba(255,255,255,1)');
      expect(hexToRgba('#000000', 0.75)).toBe('rgba(0,0,0,0.75)');
    });
  });

  describe('shade', () => {
    it('keeps pure black unchanged (multiplicative formula cannot lift 0)', () => {
      expect(shade('#000000', 0.5)).toBe('#000000');
    });

    it('darkens gray by reducing channels multiplicatively', () => {
      expect(shade('#808080', -0.5)).toBe('#404040');
    });

    it('clamps white to white (cannot brighten beyond 255)', () => {
      expect(shade('#ffffff', 0.5)).toBe('#ffffff');
    });

    it('returns input unchanged for malformed hex', () => {
      expect(shade('nope', 0.5)).toBe('nope');
      expect(shade('fff', 0.5)).toBe('fff');
      expect(shade('#gggggg', 0.5)).toBe('#gggggg');
    });

    it('brightens color with positive amount', () => {
      // #404040 (64,64,64) * 1.5 = (96,96,96) = #606060
      expect(shade('#404040', 0.5)).toBe('#606060');
    });

    it('darkens color with negative amount', () => {
      // #c0c0c0 (192,192,192) * 0.5 = (96,96,96) = #606060
      expect(shade('#c0c0c0', -0.5)).toBe('#606060');
    });
  });
});
