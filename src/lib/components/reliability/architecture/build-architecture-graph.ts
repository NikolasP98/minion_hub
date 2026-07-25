import type { GraphNode, GraphEdge } from '$lib/components/overview/graph/build-graph';
import { shade } from '$lib/components/overview/graph/build-graph';
import type { RendererGroup } from '$lib/components/overview/graph/renderer';
import { areaIconDataUri } from '$lib/utils/lucide-svg';
import { cssVar } from '$lib/utils/chart-colors';
import type {
  ArchitectureSnapshot,
  ArchStatus,
  ArchNodeKind,
  ArchNetwork,
  ArchFunction,
} from '$server/services/architecture.service';

/** Grouping lens the user clicks through. 'topology' = the designed zone layout
 *  (no boxes); the other modes re-cluster nodes into labeled scoped boxes. */
export type ArchGroupMode = 'topology' | 'network' | 'function';

/** Node disc = live status (semantic status tokens, resolved for the canvas). */
export function archStatusColor(status: ArchStatus): string {
  switch (status) {
    case 'ok':
      return cssVar('--color-success-fg', '#4ade80');
    case 'degraded':
      return cssVar('--color-warning-fg', '#f59e0b');
    case 'down':
      return cssVar('--color-danger-fg', '#ef4444');
    default:
      return cssVar('--color-neutral', '#64748b');
  }
}

/** Visual weight by node kind — the host anchors the diagram, leaf-ish nodes shrink. */
const SIZE_BY_KIND: Record<ArchNodeKind, number> = {
  host: 64,
  container: 48,
  app: 48,
  db: 44,
  cache: 40,
  storage: 40,
  volume: 36,
  edge: 38,
  external: 36,
};

/** Group definitions per mode: display label + box color (categorical chart
 *  tokens — the tint is a container hue, not a data encoding; labels carry the
 *  meaning) + cluster-center anchor for the re-layout. */
interface GroupDef {
  label: string;
  colorVar: [string, string];
  cx: number;
  cy: number;
}

const NETWORK_GROUPS: Record<ArchNetwork, GroupDef> = {
  vercel: { label: 'VERCEL', colorVar: ['--color-cyan', '#06b6d4'], cx: -700, cy: -560 },
  internet: {
    label: 'INTERNET / SAAS',
    colorVar: ['--color-neutral', '#64748b'],
    cx: 650,
    cy: -560,
  },
  cloud: { label: 'MANAGED CLOUD', colorVar: ['--color-emerald', '#10b981'], cx: -700, cy: 380 },
  netcup: {
    label: 'NETCUP VPS · DOCKER SWARM',
    colorVar: ['--color-purple', '#a855f7'],
    cx: 650,
    cy: 380,
  },
};

const FUNCTION_GROUPS: Record<ArchFunction, GroupDef> = {
  app: { label: 'APPS', colorVar: ['--color-cyan', '#06b6d4'], cx: -900, cy: -620 },
  compute: { label: 'COMPUTE', colorVar: ['--color-purple', '#a855f7'], cx: 0, cy: -620 },
  edge: { label: 'EDGE / ROUTING', colorVar: ['--color-pink', '#ec4899'], cx: 900, cy: -620 },
  db: { label: 'DATABASES', colorVar: ['--color-emerald', '#10b981'], cx: -900, cy: 220 },
  storage: { label: 'STORAGE', colorVar: ['--color-info-fg', '#38bdf8'], cx: 0, cy: 220 },
  cache: { label: 'CACHE', colorVar: ['--color-purple', '#a855f7'], cx: 900, cy: 220 },
  api: { label: 'EXTERNAL APIS', colorVar: ['--color-neutral', '#64748b'], cx: 0, cy: 900 },
};

/** Anchor members in a centered mini-grid around their group's center. */
function clusterAnchor(index: number, count: number, def: GroupDef): { x: number; y: number } {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const SX = 210;
  const SY = 215;
  return {
    x: def.cx + ((index % cols) - (cols - 1) / 2) * SX,
    y: def.cy + (Math.floor(index / cols) - (rows - 1) / 2) * SY,
  };
}

export interface ArchGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Labeled hulls for the renderer; null in topology mode. */
  groups: RendererGroup[] | null;
}

/**
 * Architecture graph transform: static topology + live statuses → shared
 * GraphNode/GraphEdge shape for the overview simulation/renderer stack.
 *
 * 'topology' mode places nodes on their designed `x/y` anchors (proximity =
 * locality/dependency — see the zone map on ArchNodeDef), no boxes. 'network'
 * and 'function' modes re-anchor nodes into labeled group clusters (where it
 * runs / what it does) and emit RendererGroups for the scoped boxes.
 * All nodes use kind 'shared' — the renderer only branches on 'org'/'integration'
 * and every visual attribute is set explicitly here; the real arch kind lives on
 * the snapshot node and is shown in the detail card.
 */
export function buildArchitectureGraph(
  snapshot: ArchitectureSnapshot,
  mode: ArchGroupMode = 'topology',
  /** User-dragged box displacements, keyed by group label — survive rebuilds. */
  offsets: Record<string, { dx: number; dy: number }> = {},
): ArchGraph {
  const labelColor = cssVar('--color-text-secondary', '#a1a1aa');
  const edgeColor = cssVar('--color-text-tertiary', '#64748b');

  // Per-node anchor: designed zones in topology mode, group clusters otherwise.
  const anchors = new Map<string, { x: number; y: number }>();
  let groups: RendererGroup[] | null = null;
  if (mode === 'topology') {
    for (const n of snapshot.nodes) anchors.set(n.id, { x: n.x, y: n.y });
  } else {
    const defs: Record<string, GroupDef> = mode === 'network' ? NETWORK_GROUPS : FUNCTION_GROUPS;
    const keyOf = (n: ArchitectureSnapshot['nodes'][number]) =>
      mode === 'network' ? n.network : n.fn;
    const members = new Map<string, typeof snapshot.nodes>();
    for (const n of snapshot.nodes) {
      const list = members.get(keyOf(n)) ?? [];
      list.push(n);
      members.set(keyOf(n), list);
    }
    groups = [];
    for (const [key, list] of members) {
      const def = defs[key];
      if (!def) continue;
      const off = offsets[def.label] ?? { dx: 0, dy: 0 };
      list.forEach((n, i) => {
        const a = clusterAnchor(i, list.length, def);
        anchors.set(n.id, { x: a.x + off.dx, y: a.y + off.dy });
      });
      groups.push({
        label: def.label,
        color: cssVar(def.colorVar[0], def.colorVar[1]),
        nodeIds: list.map((n) => n.id),
      });
    }
  }

  const nodes: GraphNode[] = snapshot.nodes.map((n) => {
    const color = archStatusColor(n.status);
    const a = anchors.get(n.id) ?? { x: n.x, y: n.y };
    return {
      id: n.id,
      kind: 'shared',
      label: n.name,
      color,
      areaId: null,
      radius: Math.hypot(a.x, a.y),
      ax: a.x,
      ay: a.y,
      symbolSize: SIZE_BY_KIND[n.kind],
      image: areaIconDataUri(n.icon, color, shade(color, -0.5)),
      labelColor,
      labelSize: 10,
      showLabel: true,
    };
  });

  const edges: GraphEdge[] = snapshot.edges.map((e) => ({
    source: e.source,
    target: e.target,
    color: edgeColor,
    baseOpacity: e.dashed ? 0.25 : 0.45,
    width: 1.25,
    dashed: e.dashed,
  }));

  return { nodes, edges, groups };
}
