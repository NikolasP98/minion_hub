# Overview Graph — Fluid Redesign (D3-force + PixiJS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stiff, fully-pinned ECharts org graph at `/overview` with a fluid, physics-driven graph (d3-force) rendered in PixiJS — preserving the concentric ring/sector structure while nodes breathe, collide, drag, and tween on focus.

**Architecture:** Four units under `src/lib/components/overview/graph/`: a pure `build-graph.ts` (props → nodes with target anchors + edges), a `simulation.ts` wrapping d3-force (anchor springs keep ring radius *and* sector angle; collision + link + wander add life), a PixiJS `renderer.ts` (scene graph, camera, hit-testing, tweened focus alpha), and a thin `OverviewGraph.svelte` shell that owns the rAF loop and pointer gestures.

**Tech Stack:** SvelteKit 2 / Svelte 5 runes, TypeScript (strict), PixiJS 8.18 (already a dep), d3-force (new dep), Vitest, Bun.

## Global Constraints

- **Branch:** work on `dev` (current). Never commit to `master`.
- **Green baseline is mandatory:** `bun run check` → **0 errors, 0 warnings** after every task. `bun run test` → all pass.
- **Svelte 5 only:** runes (`$state`, `$derived`, `$effect`, `$props`), `onclick={}`. No Svelte 4 patterns.
- **TypeScript strict.** No `any`. No `@ts-nocheck`.
- **Real hex colors only** in graph/render code (no CSS vars — canvas/WebGL can't resolve them), matching the existing palette.
- **Data contract is unchanged:** props `{ org, areas, agents, members, subscriptions }` stay identical; `org-areas.service`, `entities.ts`, `lucide-svg.ts` are not modified.
- **Package manager:** Bun (`bun add`, `bun run`). Not npm/pnpm.
- **Path aliases:** `$lib` → `src/lib/`, `$server` → `src/server/`.

---

## File Structure

```
minion_hub/
  package.json                                          # + d3-force, @types/d3-force
  src/lib/components/overview/
    OverviewGraph.svelte                                # rewritten thin shell (Task 4)
    graph/
      build-graph.ts                                    # Task 1 — pure builder
      build-graph.test.ts                               # Task 1
      simulation.ts                                     # Task 2 — d3-force wrapper
      simulation.test.ts                                # Task 2
      renderer.ts                                        # Task 3 — PixiJS scene
```

---

## Task 1: `build-graph.ts` — pure graph builder

**Files:**
- Create: `src/lib/components/overview/graph/build-graph.ts`
- Test: `src/lib/components/overview/graph/build-graph.test.ts`

**Interfaces:**
- Consumes: `OrgArea`, `VirtualAgent` from `$server/services/org-areas.service`; `INTEGRATIONS`, `integrationIconUrl` from `$lib/types/entities`; `areaIconDataUri` from `$lib/utils/lucide-svg`.
- Produces:
  ```ts
  type NodeKind = 'org' | 'area' | 'skill' | 'integration' | 'agent' | 'user' | 'shared';
  interface GraphNode {
    id: string; kind: NodeKind; label: string; color: string;
    areaId: string | null; areaName?: string; role?: string;
    skills?: string[]; integrations?: string[];
    image?: string; logoImage?: string;
    radius: number; ax: number; ay: number;
    symbolSize: number; logoSize?: number; pinned?: boolean;
    labelColor: string; labelSize: number; showLabel: boolean;
  }
  interface GraphEdge {
    source: string; target: string; color: string;
    baseOpacity: number; width: number; dashed?: boolean;
  }
  interface BuildInput {
    org: { id: string; name: string };
    areas: OrgArea[];
    agents: Array<{ id: string; name?: string | null }>;
    members: Array<{ id: string; displayName?: string | null; email?: string | null; accountType?: string | null }>;
    subscriptions?: Array<{ subscriberProfileId: string; ownerProfileId: string }>;
  }
  function buildGraph(input: BuildInput): { nodes: GraphNode[]; edges: GraphEdge[] };
  // also exported: RADII, hexToRgba, shade
  ```

- [ ] **Step 1: Write the failing test**

Create `src/lib/components/overview/graph/build-graph.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildGraph, RADII } from './build-graph';
import type { OrgArea } from '$server/services/org-areas.service';

const area = (over: Partial<OrgArea> = {}): OrgArea => ({
  id: 'a1', organizationId: 'org', name: 'Marketing', slug: 'marketing',
  icon: 'Megaphone', color: '#6366f1', sortOrder: 0,
  agentIds: ['ag1'], userIds: ['u1'], skillKeys: ['copywriting'],
  integrationKeys: ['slack'], virtualAgents: [], ...over,
});

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
    const input = base();
    input.members = [
      { id: 'u1', displayName: 'Renzo', accountType: 'person' },
      { id: 's1', displayName: 'Faces Admin', accountType: 'service' },
    ];
    input.areas = [area({ userIds: ['u1'] })];
    const { nodes } = buildGraph(input);
    expect(nodes.some((n) => n.kind === 'user' && n.id.includes('s1'))).toBe(false);
    const shared = nodes.find((n) => n.kind === 'shared')!;
    expect(shared).toBeTruthy();
    expect(dist(shared)).toBeCloseTo(RADII.shared, 5);
  });

  it('emits a dashed subscription edge from shared account to subscriber user node', () => {
    const input = base();
    input.members = [
      { id: 'u1', displayName: 'Renzo', accountType: 'person' },
      { id: 's1', displayName: 'Faces Admin', accountType: 'service' },
    ];
    input.areas = [area({ userIds: ['u1'] })];
    input.subscriptions = [{ subscriberProfileId: 'u1', ownerProfileId: 's1' }];
    const { edges } = buildGraph(input);
    expect(edges.some((e) => e.dashed && e.source === 'shared:s1' && e.target === 'user:a1:u1')).toBe(true);
  });

  it('creates an Unassigned bucket for loose agents', () => {
    const input = base();
    input.areas = [area({ agentIds: [], userIds: [] })];
    input.agents = [{ id: 'ag1', name: 'Bot' }];
    const { nodes } = buildGraph(input);
    expect(nodes.some((n) => n.kind === 'agent' && n.id.includes('__unassigned__'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run src/lib/components/overview/graph/build-graph.test.ts`
Expected: FAIL — `Failed to resolve import "./build-graph"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/components/overview/graph/build-graph.ts`. This ports the existing `$derived` graph block from `OverviewGraph.svelte`, with three changes: (1) no ring-guide nodes, (2) the integration disc + logo collapse into one node (`logoImage`), (3) each node carries an explicit anchor `(ax, ay)` and label fields.

```ts
import type { OrgArea, VirtualAgent } from '$server/services/org-areas.service';
import { INTEGRATIONS, integrationIconUrl } from '$lib/types/entities';
import { areaIconDataUri } from '$lib/utils/lucide-svg';

export type NodeKind = 'org' | 'area' | 'skill' | 'integration' | 'agent' | 'user' | 'shared';

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  color: string;
  areaId: string | null;
  areaName?: string;
  role?: string;
  skills?: string[];
  integrations?: string[];
  /** Sprite image (avatar / area-icon / shared-glyph data-URI or remote SVG). */
  image?: string;
  /** Brand logo painted over an integration disc. */
  logoImage?: string;
  /** Ring radius — initial placement + collision sizing. */
  radius: number;
  /** Target anchor (preserves ring radius AND sector angle). */
  ax: number;
  ay: number;
  symbolSize: number;
  logoSize?: number;
  /** Org node is fixed at origin. */
  pinned?: boolean;
  labelColor: string;
  labelSize: number;
  showLabel: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  color: string;
  baseOpacity: number;
  width: number;
  dashed?: boolean;
}

export interface BuildInput {
  org: { id: string; name: string };
  areas: OrgArea[];
  agents: Array<{ id: string; name?: string | null }>;
  members: Array<{
    id: string;
    displayName?: string | null;
    email?: string | null;
    accountType?: string | null;
  }>;
  subscriptions?: Array<{ subscriberProfileId: string; ownerProfileId: string }>;
}

export const RADII = {
  org: 0,
  shared: 150,
  area: 300,
  skill: 600,
  integration: 900,
  agent: 1200,
  user: 1500,
} as const;

const C = { fg: '#fafafa', dim: '#a1a1aa', faint: '#71717a', unassigned: '#52525b' };

const prettify = (key: string) =>
  key.replace(/[-_]/g, ' ').replace(/\b\w/g, (mm) => mm.toUpperCase());

/** DiceBear avatar tinted with the area color so each sector reads as a unit. */
const avatar = (seed: string, hex: string) =>
  `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(seed)}&backgroundColor=${hex.replace('#', '')}&radius=50`;

export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${alpha})`;
}
export function shade(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * (1 + amt))));
  const r = f((v >> 16) & 255);
  const g = f((v >> 8) & 255);
  const bl = f(v & 255);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`;
}

const at = (r: number, angle: number) => ({ ax: r * Math.cos(angle), ay: r * Math.sin(angle) });

export function buildGraph(input: BuildInput): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const { org, areas, agents, members, subscriptions = [] } = input;
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const serviceMembers = members.filter((m) => (m.accountType ?? 'person') === 'service');
  const personMembers = members.filter((m) => (m.accountType ?? 'person') !== 'service');
  const memberById = new Map(personMembers.map((mm) => [mm.id, mm]));

  const claimedAgents = new Set<string>();
  const claimedUsers = new Set<string>();
  for (const ar of areas) {
    for (const id of ar.agentIds) if (agentById.has(id)) claimedAgents.add(id);
    for (const id of ar.userIds) if (memberById.has(id)) claimedUsers.add(id);
  }
  const looseAgents = agents.filter((a) => !claimedAgents.has(a.id));
  const looseUsers = personMembers.filter((u) => !claimedUsers.has(u.id));

  type AreaBucket = {
    id: string; name: string; color: string; icon: string;
    skills: string[]; integrations: string[];
    realAgents: Array<{ id: string; name?: string | null }>;
    virtualAgents: VirtualAgent[];
    users: BuildInput['members'];
  };
  const buckets: AreaBucket[] = areas.map((ar) => ({
    id: ar.id, name: ar.name, color: ar.color, icon: ar.icon,
    skills: ar.skillKeys,
    integrations: ar.integrationKeys.filter((k) => INTEGRATIONS[k]),
    realAgents: ar.agentIds.map((id) => agentById.get(id)).filter((a): a is { id: string; name?: string | null } => !!a),
    virtualAgents: ar.virtualAgents,
    users: ar.userIds.map((id) => memberById.get(id)).filter((u): u is BuildInput['members'][number] => !!u),
  }));
  if (looseAgents.length || looseUsers.length || buckets.length === 0) {
    buckets.push({
      id: '__unassigned__', name: 'Unassigned', color: C.unassigned, icon: 'Boxes',
      skills: [], integrations: [], realAgents: looseAgents, virtualAgents: [], users: looseUsers,
    });
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const userNodeIdsByPerson = new Map<string, string[]>();

  // Center: org
  nodes.push({
    id: org.id, kind: 'org', label: org.name, color: C.fg, areaId: null,
    radius: 0, ax: 0, ay: 0, symbolSize: 76, pinned: true,
    labelColor: C.fg, labelSize: 10, showLabel: true,
  });

  const n = buckets.length;
  const TAU = Math.PI * 2;
  buckets.forEach((b, i) => {
    const center = -Math.PI / 2 + (i / n) * TAU;
    const half = (TAU / n / 2) * 0.82;
    const spread = (count: number, idx: number) =>
      count <= 1 ? center : center - half + (idx / (count - 1)) * (half * 2);
    const areaName = b.name;

    // ring 1: area
    nodes.push({
      id: b.id, kind: 'area', label: b.name, color: b.color, areaId: b.id,
      radius: RADII.area, ...at(RADII.area, center), symbolSize: 54,
      image: areaIconDataUri(b.icon, b.color, shade(b.color, -0.35)),
      labelColor: C.fg, labelSize: 12, showLabel: true,
    });
    edges.push({ source: org.id, target: b.id, color: b.color, baseOpacity: 0.5, width: 1.6 });

    // ring 2: skills
    b.skills.forEach((sk, j) => {
      const id = `skill:${b.id}:${sk}`;
      nodes.push({
        id, kind: 'skill', label: prettify(sk), color: b.color, areaId: b.id, areaName,
        radius: RADII.skill, ...at(RADII.skill, spread(b.skills.length, j)),
        symbolSize: 16, labelColor: C.dim, labelSize: 9, showLabel: true,
      });
      edges.push({ source: b.id, target: id, color: b.color, baseOpacity: 0.32, width: 1 });
    });

    // ring 3: integrations — single node (neutral disc + brand logo overlay)
    b.integrations.forEach((ik, j) => {
      const def = INTEGRATIONS[ik];
      const id = `integration:${b.id}:${ik}`;
      nodes.push({
        id, kind: 'integration', label: def.name, color: def.color, areaId: b.id, areaName,
        radius: RADII.integration, ...at(RADII.integration, spread(b.integrations.length, j)),
        symbolSize: 34, logoSize: 20, logoImage: integrationIconUrl(ik) ?? undefined,
        labelColor: C.dim, labelSize: 9, showLabel: false,
      });
    });

    // skill → integration edges (agents that use both)
    const skillIntEdges = new Set<string>();
    for (const va of b.virtualAgents) {
      for (const ik of va.integrationKeys) {
        if (!INTEGRATIONS[ik] || !b.integrations.includes(ik)) continue;
        for (const sk of va.skillKeys) {
          if (!b.skills.includes(sk)) continue;
          skillIntEdges.add(`${sk}→${ik}`);
        }
      }
    }
    for (const key of skillIntEdges) {
      const [sk, ik] = key.split('→');
      edges.push({ source: `skill:${b.id}:${sk}`, target: `integration:${b.id}:${ik}`, color: b.color, baseOpacity: 0.28, width: 1 });
    }

    // ring 4: agents (real first, then virtual)
    const agentCount = b.realAgents.length + b.virtualAgents.length;
    b.realAgents.forEach((a, j) => {
      const id = `agent:${b.id}:${a.id}`;
      nodes.push({
        id, kind: 'agent', label: a.name ?? a.id, color: b.color, areaId: b.id, areaName,
        role: 'Server agent', radius: RADII.agent, ...at(RADII.agent, spread(agentCount, j)),
        symbolSize: 40, image: avatar(a.id, b.color),
        labelColor: '#e4e4e7', labelSize: 10, showLabel: true,
      });
      edges.push({ source: b.id, target: id, color: b.color, baseOpacity: 0.28, width: 1 });
    });
    b.virtualAgents.forEach((va, j) => {
      const id = `agent:${b.id}:${va.id}`;
      nodes.push({
        id, kind: 'agent', label: va.name, color: b.color, areaId: b.id, areaName, role: va.role,
        skills: va.skillKeys.map(prettify),
        integrations: va.integrationKeys.filter((k) => INTEGRATIONS[k]).map((k) => INTEGRATIONS[k].name),
        radius: RADII.agent, ...at(RADII.agent, spread(agentCount, b.realAgents.length + j)),
        symbolSize: 36, image: avatar(va.id, b.color),
        labelColor: C.dim, labelSize: 9.5, showLabel: true,
      });
      const ints = va.integrationKeys.filter((k) => INTEGRATIONS[k] && b.integrations.includes(k));
      if (ints.length) {
        for (const ik of ints)
          edges.push({ source: `integration:${b.id}:${ik}`, target: id, color: INTEGRATIONS[ik].color, baseOpacity: 0.35, width: 1 });
      } else {
        for (const sk of va.skillKeys.filter((s) => b.skills.includes(s)))
          edges.push({ source: `skill:${b.id}:${sk}`, target: id, color: b.color, baseOpacity: 0.28, width: 1 });
      }
    });

    // ring 5: users (one node per area; tether to sector agents)
    const sectorAgentIds = [
      ...b.realAgents.map((a) => `agent:${b.id}:${a.id}`),
      ...b.virtualAgents.map((va) => `agent:${b.id}:${va.id}`),
    ];
    b.users.forEach((u, j) => {
      const id = `user:${b.id}:${u.id}`;
      const ulist = userNodeIdsByPerson.get(u.id) ?? [];
      ulist.push(id);
      userNodeIdsByPerson.set(u.id, ulist);
      nodes.push({
        id, kind: 'user', label: u.displayName ?? u.email ?? 'User', color: b.color,
        areaId: b.id, areaName, role: 'Team member',
        radius: RADII.user, ...at(RADII.user, spread(b.users.length, j)),
        symbolSize: 34, image: avatar(u.id, b.color),
        labelColor: C.dim, labelSize: 10, showLabel: true,
      });
      if (sectorAgentIds.length) {
        for (const aId of sectorAgentIds)
          edges.push({ source: aId, target: id, color: b.color, baseOpacity: 0.2, width: 1 });
      } else {
        edges.push({ source: b.id, target: id, color: b.color, baseOpacity: 0.2, width: 1 });
      }
    });
  });

  // shared / service accounts — own band near center
  serviceMembers.forEach((sa, j) => {
    const sharedId = `shared:${sa.id}`;
    const ang = serviceMembers.length === 1 ? -Math.PI / 2 : (TAU * j) / serviceMembers.length;
    nodes.push({
      id: sharedId, kind: 'shared', label: `${sa.displayName ?? sa.email ?? 'Shared'} (shared)`,
      color: '#3f3f46', areaId: null, role: 'Shared account',
      radius: RADII.shared, ...at(RADII.shared, ang), symbolSize: 46,
      image: areaIconDataUri('Building2', '#a1a1aa', '#52525b'),
      labelColor: C.dim, labelSize: 10.5, showLabel: true,
    });
    edges.push({ source: org.id, target: sharedId, color: C.faint, baseOpacity: 0.25, width: 1 });
  });

  const sharedIds = new Set(serviceMembers.map((s) => `shared:${s.id}`));
  for (const sub of subscriptions) {
    const sharedId = `shared:${sub.ownerProfileId}`;
    if (!sharedIds.has(sharedId)) continue;
    for (const un of userNodeIdsByPerson.get(sub.subscriberProfileId) ?? [])
      edges.push({ source: sharedId, target: un, color: '#a1a1aa', baseOpacity: 0.4, width: 1, dashed: true });
  }

  return { nodes, edges };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run vitest run src/lib/components/overview/graph/build-graph.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Type-check**

Run: `bun run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/overview/graph/build-graph.ts src/lib/components/overview/graph/build-graph.test.ts
git commit -m "feat(overview): pure graph builder with target anchors (d3/pixi redesign)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `simulation.ts` — d3-force wrapper

**Files:**
- Modify: `package.json` (add `d3-force`, `@types/d3-force`)
- Create: `src/lib/components/overview/graph/simulation.ts`
- Test: `src/lib/components/overview/graph/simulation.test.ts`

**Interfaces:**
- Consumes: `GraphNode`, `GraphEdge` from `./build-graph`.
- Produces:
  ```ts
  interface SimNode extends GraphNode { x: number; y: number; vx: number; vy: number;
    fx?: number | null; fy?: number | null; bax: number; bay: number; phase: number; }
  interface SimOptions { reducedMotion?: boolean }
  interface Simulation {
    nodes(): SimNode[];
    tick(): void;
    drag(id: string, x: number, y: number): void;
    release(id: string): void;
    reheat(): void;
    stop(): void;
  }
  function createSimulation(nodes: GraphNode[], edges: GraphEdge[], opts?: SimOptions): Simulation;
  ```

- [ ] **Step 1: Add the dependency**

Run: `bun add -d d3-force @types/d3-force`
Expected: `package.json` gains `d3-force` and `@types/d3-force` under devDependencies; `bun.lock` updates. (d3-force is a build-time/runtime library bundled by Vite; dev-dep is fine since it is tree-shaken into the client bundle at build.)

- [ ] **Step 2: Write the failing test**

Create `src/lib/components/overview/graph/simulation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createSimulation } from './simulation';
import { buildGraph } from './build-graph';

const input = {
  org: { id: 'org', name: 'FACES' },
  areas: [{
    id: 'a1', organizationId: 'org', name: 'Marketing', slug: 'marketing',
    icon: 'Megaphone', color: '#6366f1', sortOrder: 0,
    agentIds: ['ag1'], userIds: ['u1'], skillKeys: ['copywriting'],
    integrationKeys: ['slack'], virtualAgents: [],
  }],
  agents: [{ id: 'ag1', name: 'Bot' }],
  members: [{ id: 'u1', displayName: 'Renzo', accountType: 'person' }],
  subscriptions: [],
};

const settle = (sim: ReturnType<typeof createSimulation>, n = 400) => {
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run vitest run src/lib/components/overview/graph/simulation.test.ts`
Expected: FAIL — `Failed to resolve import "./simulation"`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/components/overview/graph/simulation.ts`:

```ts
import {
  forceSimulation,
  forceX,
  forceY,
  forceCollide,
  forceManyBody,
  forceLink,
  type Simulation as D3Sim,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force';
import type { GraphNode, GraphEdge } from './build-graph';

export interface SimNode extends GraphNode, SimulationNodeDatum {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number | null;
  fy?: number | null;
  /** Immutable base anchor; `ax`/`ay` = base + wander each tick. */
  bax: number;
  bay: number;
  phase: number;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  source: string | SimNode;
  target: string | SimNode;
}

export interface SimOptions {
  reducedMotion?: boolean;
}

export interface Simulation {
  nodes(): SimNode[];
  tick(): void;
  drag(id: string, x: number, y: number): void;
  release(id: string): void;
  reheat(): void;
  stop(): void;
}

// Tuning constants — keep anchors dominant so structure holds.
const ANCHOR_STRENGTH = 0.08;
const COLLIDE_PAD = 6;
const LINK_STRENGTH = 0.05;
const WEAK_REPULSION = -12;
const WANDER_AMP = 14; // world units
const WANDER_FREQ = 0.0009; // per ms
const BREATHE_ALPHA = 0.018; // never-freeze floor when in motion
const DRAG_ALPHA = 0.3;

export function createSimulation(
  nodes: GraphNode[],
  edges: GraphEdge[],
  opts: SimOptions = {},
): Simulation {
  const reduced = !!opts.reducedMotion;

  const simNodes: SimNode[] = nodes.map((nd, i) => ({
    ...nd,
    x: nd.ax,
    y: nd.ay,
    vx: 0,
    vy: 0,
    fx: nd.pinned ? nd.ax : undefined,
    fy: nd.pinned ? nd.ay : undefined,
    bax: nd.ax,
    bay: nd.ay,
    phase: (i * 2.39996) % (Math.PI * 2), // golden-angle spread, no Math.random
  }));
  const byId = new Map(simNodes.map((nd) => [nd.id, nd]));

  const links: SimLink[] = edges
    .filter((e) => byId.has(e.source) && byId.has(e.target))
    .map((e) => ({ source: e.source, target: e.target }));

  const sim: D3Sim<SimNode, SimLink> = forceSimulation<SimNode>(simNodes)
    .force('x', forceX<SimNode>((d) => d.ax).strength((d) => (d.pinned ? 0 : ANCHOR_STRENGTH)))
    .force('y', forceY<SimNode>((d) => d.ay).strength((d) => (d.pinned ? 0 : ANCHOR_STRENGTH)))
    .force('collide', forceCollide<SimNode>((d) => d.symbolSize / 2 + COLLIDE_PAD))
    .force('charge', forceManyBody<SimNode>().strength(WEAK_REPULSION))
    .force('link', forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(60).strength(LINK_STRENGTH))
    .alphaTarget(reduced ? 0 : BREATHE_ALPHA)
    .stop(); // we own the loop — d3's internal timer must not run

  let t = 0;

  return {
    nodes: () => simNodes,
    tick() {
      if (!reduced) {
        t += 16;
        for (const nd of simNodes) {
          if (nd.pinned || nd.fx != null) continue;
          nd.ax = nd.bax + Math.sin(t * WANDER_FREQ + nd.phase) * WANDER_AMP;
          nd.ay = nd.bay + Math.cos(t * WANDER_FREQ + nd.phase) * WANDER_AMP;
        }
      }
      sim.tick();
    },
    drag(id, x, y) {
      const nd = byId.get(id);
      if (!nd || nd.pinned) return;
      nd.fx = x;
      nd.fy = y;
      sim.alpha(Math.max(sim.alpha(), DRAG_ALPHA));
    },
    release(id) {
      const nd = byId.get(id);
      if (!nd || nd.pinned) return;
      nd.fx = null;
      nd.fy = null;
      sim.alpha(Math.max(sim.alpha(), DRAG_ALPHA));
    },
    reheat() {
      sim.alpha(0.5);
    },
    stop() {
      sim.stop();
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run vitest run src/lib/components/overview/graph/simulation.test.ts`
Expected: PASS (3 tests). If the "settles near anchors" tolerance is occasionally exceeded, raise the iteration count in `settle()` — do NOT loosen tolerances below 120.

- [ ] **Step 6: Type-check**

Run: `bun run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 7: Commit**

```bash
git add package.json bun.lock src/lib/components/overview/graph/simulation.ts src/lib/components/overview/graph/simulation.test.ts
git commit -m "feat(overview): d3-force simulation (anchor springs + collide + wander)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `renderer.ts` — PixiJS scene, camera, hit-testing

**Files:**
- Create: `src/lib/components/overview/graph/renderer.ts`

**Interfaces:**
- Consumes: `SimNode` from `./simulation`; `GraphEdge`, `hexToRgba` from `./build-graph`; PixiJS 8 (`pixi.js`).
- Produces:
  ```ts
  interface RendererCallbacks {
    onNodeHover?: (id: string | null) => void;
    onNodeClick?: (id: string) => void;
  }
  interface Renderer {
    setGraph(nodes: SimNode[], edges: GraphEdge[]): void;
    frame(): void;                                  // draw current sim positions
    setFocus(ids: Set<string> | null): void;
    animateTo(center: [number, number], zoom: number, ms?: number): void;
    panBy(dxScreen: number, dyScreen: number): void;
    zoomAt(screenX: number, screenY: number, factor: number): void;
    screenToWorld(sx: number, sy: number): [number, number];
    nodeAt(screenX: number, screenY: number): string | null;
    resize(): void;
    destroy(): void;
  }
  function createRenderer(canvas: HTMLCanvasElement, cb?: RendererCallbacks): Promise<Renderer>;
  ```

**Note for the implementer:** PixiJS 8 `Application.init` is async and `Graphics` uses the v8 fluent API (`g.circle(...).fill(...)`, `g.moveTo(...).lineTo(...).stroke({ width, color, alpha })`). Confirm exact signatures against the installed `pixi.js@8.18` types as you go. There is **no TDD red-green here** — WebGL rendering isn't unit-tested; correctness is verified by `bun run check` plus the manual pass in Task 4. Keep the file focused on rendering, camera math, and hit-testing only.

- [ ] **Step 1: Write the renderer**

Create `src/lib/components/overview/graph/renderer.ts`:

```ts
import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { SimNode } from './simulation';
import type { GraphEdge } from './build-graph';

export interface RendererCallbacks {
  onNodeHover?: (id: string | null) => void;
  onNodeClick?: (id: string) => void;
}

export interface Renderer {
  setGraph(nodes: SimNode[], edges: GraphEdge[]): void;
  frame(): void;
  setFocus(ids: Set<string> | null): void;
  animateTo(center: [number, number], zoom: number, ms?: number): void;
  panBy(dxScreen: number, dyScreen: number): void;
  zoomAt(screenX: number, screenY: number, factor: number): void;
  screenToWorld(sx: number, sy: number): [number, number];
  nodeAt(screenX: number, screenY: number): string | null;
  resize(): void;
  destroy(): void;
}

const RING_COLOR = 0x26262b;
const ZOOM_MIN = 0.12;
const ZOOM_MAX = 5;
const LABEL_ZOOM_THRESHOLD = 0.3;
const RADII = [300, 600, 900, 1200, 1500];

const hexNum = (hex: string): number => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  return m ? parseInt(m[1], 16) : 0xffffff;
};

/** Browser-rasterised texture loader — handles remote SVG and data-URI SVG
 *  uniformly, and lets cross-origin failures fall back gracefully. */
function loadTexture(url: string): Promise<Texture | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        resolve(Texture.from(img));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

interface NodeView {
  node: SimNode;
  container: Container;
  bg: Graphics;
  label?: Text;
  displayAlpha: number;
  targetAlpha: number;
  screenX: number;
  screenY: number;
}

export async function createRenderer(
  canvas: HTMLCanvasElement,
  cb: RendererCallbacks = {},
): Promise<Renderer> {
  const app = new Application();
  await app.init({
    canvas,
    antialias: true,
    backgroundAlpha: 0,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    resizeTo: canvas.parentElement ?? canvas,
  });

  const world = new Container();
  const ringLayer = new Graphics();
  const edgeLayer = new Graphics();
  const nodeLayer = new Container();
  world.addChild(ringLayer, edgeLayer, nodeLayer);
  app.stage.addChild(world);

  // Camera state.
  let center: [number, number] = [0, 0];
  let zoom = 0.46;
  let anim: { from: [number, number]; fromZoom: number; to: [number, number]; toZoom: number; start: number; ms: number } | null = null;

  let views: NodeView[] = [];
  let edges: GraphEdge[] = [];
  const byId = new Map<string, NodeView>();
  let focus: Set<string> | null = null;

  const W = () => app.renderer.width / (window.devicePixelRatio || 1);
  const H = () => app.renderer.height / (window.devicePixelRatio || 1);

  function applyCamera() {
    world.scale.set(zoom);
    world.position.set(W() / 2 - center[0] * zoom, H() / 2 - center[1] * zoom);
  }

  function drawRings() {
    ringLayer.clear();
    for (const r of RADII) {
      ringLayer.circle(0, 0, r).stroke({ width: 1, color: RING_COLOR, alpha: 0.8 });
    }
  }

  function buildNodeView(node: SimNode): NodeView {
    const container = new Container();
    const bg = new Graphics();
    container.addChild(bg);
    const size = node.symbolSize;

    if (node.kind === 'org') {
      bg.circle(0, 0, size / 2).fill({ color: 0x101013 }).stroke({ width: 2, color: 0xfafafa });
    } else if (node.kind === 'integration') {
      bg.circle(0, 0, size / 2).fill({ color: 0xf4f4f5 }).stroke({ width: 2, color: hexNum(node.color) });
    } else {
      bg.circle(0, 0, size / 2).fill({ color: hexNum(node.color) });
    }

    // Sprite image (avatar / area-icon / shared glyph), loaded async.
    if (node.image) {
      const sprite = new Sprite();
      sprite.anchor.set(0.5);
      sprite.width = size;
      sprite.height = size;
      container.addChild(sprite);
      loadTexture(node.image).then((tex) => {
        if (tex) sprite.texture = tex;
      });
    }
    // Integration brand logo overlay.
    if (node.logoImage && node.logoSize) {
      const logo = new Sprite();
      logo.anchor.set(0.5);
      logo.width = node.logoSize;
      logo.height = node.logoSize;
      container.addChild(logo);
      loadTexture(node.logoImage).then((tex) => {
        if (tex) logo.texture = tex;
      });
    }

    let label: Text | undefined;
    if (node.showLabel) {
      label = new Text({
        text: node.label,
        style: {
          fill: node.labelColor,
          fontSize: node.labelSize,
          fontWeight: node.kind === 'org' || node.kind === 'area' ? '700' : '400',
          align: 'center',
          wordWrap: true,
          wordWrapWidth: 120,
        },
      });
      label.anchor.set(0.5, 0);
      label.position.set(0, size / 2 + 4);
      container.addChild(label);
    }

    nodeLayer.addChild(container);
    return { node, container, bg, label, displayAlpha: 1, targetAlpha: 1, screenX: 0, screenY: 0 };
  }

  function setGraph(nodes: SimNode[], nextEdges: GraphEdge[]) {
    nodeLayer.removeChildren();
    byId.clear();
    views = nodes.map((nd) => {
      const v = buildNodeView(nd);
      byId.set(nd.id, v);
      return v;
    });
    edges = nextEdges;
    drawRings();
    applyCamera();
  }

  function focusFactor(id: string): number {
    if (!focus) return 1;
    return focus.has(id) ? 1 : 0.07;
  }

  function frame() {
    // Camera tween.
    if (anim) {
      const t = Math.min(1, (performance.now() - anim.start) / anim.ms);
      const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      center = [
        anim.from[0] + (anim.to[0] - anim.from[0]) * k,
        anim.from[1] + (anim.to[1] - anim.from[1]) * k,
      ];
      zoom = anim.fromZoom + (anim.toZoom - anim.fromZoom) * k;
      if (t >= 1) anim = null;
    }
    applyCamera();

    const showLabels = zoom >= LABEL_ZOOM_THRESHOLD;

    // Nodes: position + alpha lerp + cache screen coords for hit-testing.
    for (const v of views) {
      v.container.position.set(v.node.x, v.node.y);
      v.targetAlpha = focusFactor(v.node.id);
      v.displayAlpha += (v.targetAlpha - v.displayAlpha) * 0.18;
      v.container.alpha = v.displayAlpha;
      if (v.label) v.label.visible = showLabels && (!focus || focus.has(v.node.id));
      v.screenX = v.node.x * zoom + world.position.x;
      v.screenY = v.node.y * zoom + world.position.y;
    }

    // Edges.
    edgeLayer.clear();
    for (const e of edges) {
      const s = byId.get(e.source);
      const tg = byId.get(e.target);
      if (!s || !tg) continue;
      let alpha = e.baseOpacity;
      if (focus) {
        const lit = focus.has(e.source) && focus.has(e.target);
        alpha = lit ? Math.min(0.85, e.baseOpacity + 0.3) : 0.03;
      }
      const col = hexNum(e.color);
      if (e.dashed) {
        drawDashed(edgeLayer, s.node.x, s.node.y, tg.node.x, tg.node.y, e.width, col, alpha);
      } else {
        edgeLayer.moveTo(s.node.x, s.node.y).lineTo(tg.node.x, tg.node.y).stroke({ width: e.width, color: col, alpha });
      }
    }

    app.render();
  }

  function drawDashed(g: Graphics, x1: number, y1: number, x2: number, y2: number, w: number, color: number, alpha: number) {
    const dash = 8;
    const gap = 6;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    let d = 0;
    while (d < len) {
      const d2 = Math.min(d + dash, len);
      g.moveTo(x1 + ux * d, y1 + uy * d).lineTo(x1 + ux * d2, y1 + uy * d2).stroke({ width: w, color, alpha });
      d += dash + gap;
    }
  }

  function setFocus(ids: Set<string> | null) {
    focus = ids;
  }

  function animateTo(to: [number, number], toZoom: number, ms = 650) {
    anim = { from: [...center], fromZoom: zoom, to, toZoom: clampZoom(toZoom), start: performance.now(), ms };
  }

  const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

  function screenToWorld(sx: number, sy: number): [number, number] {
    return [(sx - world.position.x) / zoom, (sy - world.position.y) / zoom];
  }

  function panBy(dxScreen: number, dyScreen: number) {
    center = [center[0] - dxScreen / zoom, center[1] - dyScreen / zoom];
    anim = null;
  }

  function zoomAt(screenX: number, screenY: number, factor: number) {
    const next = clampZoom(zoom * factor);
    if (next === zoom) return;
    const [wx, wy] = screenToWorld(screenX, screenY);
    zoom = next;
    // Keep the world point under the cursor stationary.
    center = [wx - (screenX - W() / 2) / zoom, wy - (screenY - H() / 2) / zoom];
    anim = null;
  }

  function nodeAt(screenX: number, screenY: number): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    for (const v of views) {
      if (v.node.id.startsWith('__ring')) continue;
      const rad = (v.node.symbolSize / 2) * zoom;
      const d = Math.hypot(screenX - v.screenX, screenY - v.screenY);
      if (d <= rad && d < bestD) {
        bestD = d;
        best = v.node.id;
      }
    }
    return best;
  }

  function resize() {
    app.resize();
    applyCamera();
  }

  function destroy() {
    app.destroy(true, { children: true, texture: false });
  }

  return {
    setGraph,
    frame,
    setFocus,
    animateTo,
    panBy,
    zoomAt,
    screenToWorld,
    nodeAt,
    resize,
    destroy,
  };
}
```

- [ ] **Step 2: Type-check**

Run: `bun run check`
Expected: 0 errors, 0 warnings. Fix any PixiJS 8 API signature mismatches the type-checker reports (e.g. `Graphics.stroke`/`fill` option shape, `Text` constructor) against the installed `pixi.js@8.18` types.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/overview/graph/renderer.ts
git commit -m "feat(overview): PixiJS renderer with camera, hit-testing, tweened focus

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `OverviewGraph.svelte` — thin shell, rAF loop, gestures, overlays

**Files:**
- Modify (full rewrite): `src/lib/components/overview/OverviewGraph.svelte`

**Interfaces:**
- Consumes: `buildGraph` from `./graph/build-graph`; `createSimulation` from `./graph/simulation`; `createRenderer` from `./graph/renderer`; `RADII` from `./graph/build-graph`. Same `Props` as today.
- Produces: the `/overview` graph UI. No new exports.

**Behavior to preserve from the old component:** ring legend (bottom-left), empty-state message, `selected` detail panel (bottom-right), and the focus model (clicking a node lights its whole `areaId` sector; org → home; area → centers the sector; leaf → zooms in). Pan = drag empty canvas; wheel = zoom toward cursor; click empty = clear + home.

- [ ] **Step 1: Rewrite the component**

Replace the entire contents of `src/lib/components/overview/OverviewGraph.svelte`:

```svelte
<!--
  OverviewGraph — concentric, sector-partitioned org map.

  Physics: d3-force anchor springs keep each node near its ring radius AND
  sector angle while collision + a wander offset make the graph breathe.
  Rendering: PixiJS scene graph (world container pan/zoom). The shell owns the
  rAF loop (sim.tick → renderer.frame) and all pointer gestures via DOM events
  with renderer-side hit-testing (nodeAt), so pan/zoom works across the whole
  canvas including the corners.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { OrgArea } from '$server/services/org-areas.service';
  import { buildGraph, RADII, type GraphNode } from './graph/build-graph';
  import { createSimulation, type Simulation, type SimNode } from './graph/simulation';
  import { createRenderer, type Renderer } from './graph/renderer';

  interface AgentLike { id: string; name?: string | null }
  interface MemberLike {
    id: string;
    displayName?: string | null;
    email?: string | null;
    accountType?: string | null;
  }
  interface Props {
    org: { id: string; name: string };
    areas: OrgArea[];
    agents: AgentLike[];
    members: MemberLike[];
    subscriptions?: Array<{ subscriberProfileId: string; ownerProfileId: string }>;
  }
  let { org, areas, agents, members, subscriptions = [] }: Props = $props();

  let canvasEl: HTMLCanvasElement | undefined = $state();
  let selected = $state<GraphNode | null>(null);
  let nodeCount = $state(0);

  const HOME = { center: [0, 0] as [number, number], zoom: 0.46 };

  onMount(() => {
    if (!canvasEl) return;
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let renderer: Renderer | null = null;
    let sim: Simulation | null = null;
    let raf = 0;
    let metaById = new Map<string, GraphNode>();
    let disposed = false;

    function focusSetFor(node: GraphNode | null): Set<string> | null {
      if (!node || node.kind === 'org') return null;
      const ids = new Set<string>([org.id]);
      for (const [id, m] of metaById) if (m.areaId === node.areaId) ids.add(id);
      return ids;
    }

    function rebuild() {
      const { nodes, edges } = buildGraph({ org, areas, agents, members, subscriptions });
      nodeCount = nodes.length;
      metaById = new Map(nodes.map((nd) => [nd.id, nd]));
      sim?.stop();
      sim = createSimulation(nodes, edges, { reducedMotion });
      renderer?.setGraph(sim.nodes() as SimNode[], edges);
    }

    (async () => {
      renderer = await createRenderer(canvasEl!, {
        onNodeHover: (id) => {
          // hover focuses adjacency only when nothing is click-selected
          if (selected) return;
          renderer?.setFocus(id ? adjacency(id) : null);
        },
      });
      if (disposed) {
        renderer.destroy();
        return;
      }
      rebuild();

      const loop = () => {
        sim?.tick();
        renderer?.frame();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      wireGestures(renderer);
    })();

    function adjacency(id: string): Set<string> {
      const ids = new Set<string>([id]);
      const { edges } = buildGraph({ org, areas, agents, members, subscriptions });
      for (const e of edges) {
        if (e.source === id) ids.add(e.target);
        if (e.target === id) ids.add(e.source);
      }
      return ids;
    }

    function wireGestures(r: Renderer) {
      const el = canvasEl!;
      let mode: 'none' | 'pan' | 'node' = 'none';
      let dragId: string | null = null;
      let moved = false;
      let last = { x: 0, y: 0 };
      const DRAG_THRESHOLD = 4;

      const local = (e: PointerEvent) => {
        const rect = el.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
      };

      el.addEventListener('pointerdown', (e) => {
        const p = local(e);
        last = p;
        moved = false;
        const id = r.nodeAt(p.x, p.y);
        if (id && !metaById.get(id)?.pinned) {
          mode = 'node';
          dragId = id;
        } else {
          mode = 'pan';
        }
        el.setPointerCapture(e.pointerId);
      });

      el.addEventListener('pointermove', (e) => {
        const p = local(e);
        if (mode === 'none') {
          const id = r.nodeAt(p.x, p.y);
          if (!selected) r.setFocus(id ? adjacency(id) : null);
          el.style.cursor = id ? 'pointer' : 'default';
          return;
        }
        if (Math.hypot(p.x - last.x, p.y - last.y) > DRAG_THRESHOLD) moved = true;
        if (mode === 'node' && dragId) {
          const [wx, wy] = r.screenToWorld(p.x, p.y);
          sim?.drag(dragId, wx, wy);
        } else if (mode === 'pan') {
          r.panBy(p.x - last.x, p.y - last.y);
        }
        last = p;
      });

      const end = (e: PointerEvent) => {
        const p = local(e);
        if (!moved && mode === 'node' && dragId) {
          clickNode(dragId);
        } else if (!moved && mode === 'pan') {
          if (selected) {
            selected = null;
            r.setFocus(null);
            r.animateTo(HOME.center, HOME.zoom);
          }
        }
        if (mode === 'node' && dragId) sim?.release(dragId);
        mode = 'none';
        dragId = null;
        try {
          el.releasePointerCapture(e.pointerId);
        } catch {
          /* capture may already be gone */
        }
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);

      el.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault();
          const p = local(e);
          r.zoomAt(p.x, p.y, e.deltaY < 0 ? 1.12 : 1 / 1.12);
        },
        { passive: false },
      );
    }

    function clickNode(id: string) {
      const m = metaById.get(id) ?? null;
      selected = m;
      if (!m || !renderer) return;
      renderer.setFocus(focusSetFor(m));
      if (m.kind === 'org') {
        renderer.animateTo(HOME.center, HOME.zoom);
      } else if (m.kind === 'area') {
        const ang = Math.atan2(m.ay, m.ax);
        const rr = (RADII.area + RADII.user) / 2;
        renderer.animateTo([rr * Math.cos(ang), rr * Math.sin(ang)], 1.0);
      } else {
        renderer.animateTo([m.ax, m.ay], 1.55);
      }
    }

    const ro = new ResizeObserver(() => renderer?.resize());
    ro.observe(canvasEl);

    // Re-feed when props change.
    $effect.root(() => {
      $effect(() => {
        // touch reactive deps
        void [org, areas, agents, members, subscriptions];
        if (renderer && sim) rebuild();
      });
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      sim?.stop();
      renderer?.destroy();
    };
  });
</script>

<div class="relative w-full h-full overview-stage">
  <canvas bind:this={canvasEl} class="w-full h-full block touch-none"></canvas>

  {#if nodeCount <= 1}
    <div class="absolute inset-0 flex items-center justify-center text-center px-8 pointer-events-none">
      <div class="text-muted text-sm">
        No areas yet — create org areas and assign agents to see the map.
      </div>
    </div>
  {/if}

  <!-- Ring legend -->
  <div class="absolute bottom-3 left-3 z-10 flex flex-col gap-1 text-[10px] text-muted bg-bg2/80 backdrop-blur-sm border border-border rounded-lg px-2.5 py-2 pointer-events-none">
    {#each [['Areas', '●'], ['Skills', '◦'], ['Integrations', '◆'], ['Agents', '◉'], ['Users', '◎']] as [name, glyph] (name)}
      <div class="flex items-center gap-1.5"><span class="opacity-60">{glyph}</span><span>{name}</span></div>
    {/each}
  </div>

  {#if selected}
    <div class="absolute bottom-3 right-3 z-10 w-[260px] bg-bg2/95 backdrop-blur-sm border border-border rounded-lg shadow-lg text-[11px] overflow-hidden">
      <div class="flex items-center justify-between px-3 py-2 border-b border-border">
        <div class="flex items-center gap-2 min-w-0">
          <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: {selected.color}"></span>
          <span class="text-foreground font-medium truncate">{selected.label}</span>
        </div>
        <button type="button" class="text-muted hover:text-foreground cursor-pointer shrink-0 ml-2" onclick={() => (selected = null)}>&times;</button>
      </div>
      <div class="px-3 py-2 flex flex-col gap-1.5">
        <div class="flex items-center gap-1.5">
          <span class="px-1.5 py-0.5 rounded text-[9px] font-medium text-white capitalize" style="background-color: {selected.color}">{selected.kind}</span>
          {#if selected.areaName}<span class="text-muted">{selected.areaName}</span>{/if}
        </div>
        {#if selected.role}<div class="text-muted">{selected.role}</div>{/if}
        {#if selected.skills?.length}
          <div class="flex flex-wrap gap-1">
            {#each selected.skills as sk (sk)}
              <span class="px-1.5 py-0.5 rounded bg-bg1 border border-border text-[9px] text-foreground">{sk}</span>
            {/each}
          </div>
        {/if}
        {#if selected.integrations?.length}
          <div class="flex flex-wrap gap-1">
            {#each selected.integrations as ik (ik)}
              <span class="px-1.5 py-0.5 rounded bg-bg1 border border-border text-[9px] text-muted">{ik}</span>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .overview-stage {
    background:
      radial-gradient(ellipse 70% 60% at 50% 45%, rgba(99, 102, 241, 0.05), transparent 70%),
      radial-gradient(ellipse 100% 100% at 50% 50%, transparent 60%, rgba(0, 0, 0, 0.35));
  }
</style>
```

**Implementer note on the `$effect` for prop changes:** if `bun run check` flags the `$effect.root` nesting inside `onMount` as a warning, replace it by moving the prop-change reaction to a top-level `$effect` in the component body that guards on `renderer && sim` being ready (store them in `$state`-less module-local refs via a small `$state` holder). The requirement is only: *when props change after mount, call `rebuild()`*. Pick whichever form `check` accepts with 0 warnings.

- [ ] **Step 2: Type-check**

Run: `bun run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Run the full test suite**

Run: `bun run test`
Expected: all pass (includes the new `build-graph` and `simulation` tests).

- [ ] **Step 4: Production build**

Run: `bun run build`
Expected: succeeds (only the known harmless optional-peer notices).

- [ ] **Step 5: Manual verification**

Run: `bun run dev`, open `/overview`, and confirm:
- nodes settle into the concentric rings, then drift gently ("breathe"); with OS reduced-motion on, they settle and hold still;
- hover lights a node + its neighbors (smooth fade, not a cut);
- clicking a node lights its whole sector and the camera glides to it; clicking empty space clears and glides home;
- dragging a node pulls it and it eases back to its ring on release; neighbors react;
- drag-empty pans across the whole canvas incl. corners; wheel zooms toward the cursor;
- avatars / integration logos / area icons render (if a logo CDN lacks CORS headers, that node shows its colored disc fallback — note any that fail);
- the legend, empty-state, and detail panel behave as before.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/overview/OverviewGraph.svelte
git commit -m "feat(overview): fluid d3-force + PixiJS org graph (replaces ECharts)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** anchor-spring physics (Task 2), no ring-guide nodes / collapsed integration node (Task 1 build + test), tweened focus (Task 3 `displayAlpha` lerp + Task 4 hover/click), draggable with spring-back (Task 2 drag/release + Task 4 gestures), subtle breathing + reduced-motion (Task 2 wander + Task 4 `matchMedia`), camera glide & pan/zoom-anywhere (Task 3 + Task 4 DOM gestures + `nodeAt`), unchanged data contract (no service/entities/page edits), test plan (Tasks 1–2 vitest, Tasks 3–4 check/build/manual). All spec sections map to a task.
- **CORS risk** (spec "Texture load failure"): handled by `loadTexture` resolving `null` on error → disc fallback; manual step 5 calls out logging any failing logo source.
- **Type consistency:** `GraphNode`/`GraphEdge` defined in Task 1 and consumed unchanged in Tasks 2–4; `SimNode` defined in Task 2 and consumed in Tasks 3–4; renderer method names (`setGraph`, `frame`, `setFocus`, `animateTo`, `panBy`, `zoomAt`, `screenToWorld`, `nodeAt`, `resize`, `destroy`) are identical in the Task 3 interface block, its implementation, and the Task 4 call sites.
```
