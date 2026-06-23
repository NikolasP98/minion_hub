import type { OrgArea, VirtualAgent } from '$server/services/org-areas.service';
import { INTEGRATIONS, integrationIconUrl } from '$lib/types/entities';
import { areaIconDataUri } from '$lib/utils/lucide-svg';
import { ARCHETYPE_AVATAR_STYLE } from '$lib/utils/avatar';

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
  agents: Array<{ id: string; name?: string | null; archetype?: string | null }>;
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

/** DiceBear avatar tinted with the area color so each sector reads as a unit.
 *  `archetype` selects the agent style (autonomous/brain/copilot); omit for
 *  users → notionists. Archetype is resolved by the caller (config lives client-
 *  side) and passed in as data, keeping this builder pure. Pinned to the 10.x
 *  API since `disco` (AI brains) is 10.x-only. Rounding is done by a circular
 *  mask in the renderer, not DiceBear's `radius` (unreliable on 10.x). */
const avatar = (seed: string, hex: string, archetype?: string | null) => {
  const style = (archetype && ARCHETYPE_AVATAR_STYLE[archetype]) || 'notionists';
  return `https://api.dicebear.com/10.x/${style}/svg?seed=${encodeURIComponent(seed)}&backgroundColor=${hex.replace('#', '')}`;
};

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
    realAgents: BuildInput['agents'];
    virtualAgents: VirtualAgent[];
    users: BuildInput['members'];
  };
  const buckets: AreaBucket[] = areas.map((ar) => ({
    id: ar.id, name: ar.name, color: ar.color, icon: ar.icon,
    skills: ar.skillKeys,
    integrations: ar.integrationKeys.filter((k) => INTEGRATIONS[k]),
    realAgents: ar.agentIds.map((id) => agentById.get(id)).filter((a): a is BuildInput['agents'][number] => !!a),
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
        symbolSize: 40, image: avatar(a.id, b.color, a.archetype),
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
        symbolSize: 36, image: avatar(va.id, b.color, 'autonomous'),
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

  // ── Degree-aware sizing ──────────────────────────────────────────────────
  const degree = new Map<string, number>();
  for (const nd of nodes) degree.set(nd.id, 0);
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const BASE: Record<NodeKind, number> = {
    org: 88, area: 66, shared: 56, integration: 46, agent: 50, user: 46, skill: 26,
  };
  for (const nd of nodes) {
    const deg = degree.get(nd.id) ?? 0;
    const base = BASE[nd.kind];
    nd.symbolSize = Math.round(base * (1 + Math.min(0.6, 0.06 * deg)));
    if (nd.kind === 'integration' && nd.logoSize != null) {
      nd.logoSize = Math.round(nd.symbolSize * 0.58);
    }
  }

  return { nodes, edges };
}
