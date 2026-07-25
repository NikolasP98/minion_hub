import type { GraphEdge, GraphNode } from '$lib/components/overview/graph/build-graph';
import { shade } from '$lib/components/overview/graph/build-graph';
import { areaIconDataUri } from '$lib/utils/lucide-svg';
import { cssVar } from '$lib/utils/chart-colors';
import type { ArchStatus, ArchitectureSnapshot } from '$server/services/architecture.service';
import type {
  C4Level,
  C4Model,
  C4Node,
  C4RelationKind,
} from '$server/services/architecture-c4.model';
import { archStatusColor } from './build-architecture-graph';

export const C4_LEVELS: C4Level[] = ['context', 'container', 'component', 'code'];
export const C4_RING_RADII = [300, 600, 900, 1200] as const;

const LEVEL_INDEX = new Map(C4_LEVELS.map((level, index) => [level, index]));

export interface C4GraphProjection {
  nodes: GraphNode[];
  edges: GraphEdge[];
  visibleIds: Set<string>;
  rings: number[];
  metaById: Map<string, C4Node>;
}

/** Resolve navigation from the complete model, never from a focused
 * projection. A focused branch intentionally omits its ancestors, so looking
 * up a parent through `projection.metaById` makes "go to parent" a no-op. */
export function c4ParentFocusTarget(model: C4Model, nodeId: string): string | null {
  return model.nodes.find((node) => node.id === nodeId)?.parentId ?? null;
}

/** A focus action is a drill-down action, so it always reveals one level below
 * the selected node instead of preserving a previously selected deeper filter. */
export function c4FocusLevel(level: C4Level): C4Level {
  const depth = LEVEL_INDEX.get(level) ?? 0;
  return C4_LEVELS[Math.min(C4_LEVELS.length - 1, depth + 1)]!;
}

/** Border hue is the stable C4 level encoding; fill remains live status. */
export function c4LevelColor(level: C4Level): string {
  switch (level) {
    case 'context':
      return cssVar('--color-pink', '#ec4899');
    case 'container':
      return cssVar('--color-cyan', '#06b6d4');
    case 'component':
      return cssVar('--color-purple', '#a855f7');
    case 'code':
      return cssVar('--color-emerald', '#10b981');
  }
}

/** Relationship hue and pattern are independent from status and C4 level. */
export function c4RelationStyle(
  kind: C4RelationKind,
): Pick<GraphEdge, 'color' | 'width' | 'dashed' | 'baseOpacity'> {
  switch (kind) {
    case 'runtime':
      return {
        color: cssVar('--color-info-fg', '#38bdf8'),
        width: 1.6,
        dashed: false,
        baseOpacity: 0.62,
      };
    case 'data':
      return {
        color: cssVar('--color-emerald', '#10b981'),
        width: 1.8,
        dashed: false,
        baseOpacity: 0.64,
      };
    case 'event':
      return {
        color: cssVar('--color-purple', '#a855f7'),
        width: 1.45,
        dashed: true,
        baseOpacity: 0.62,
      };
    case 'deploy':
      return {
        color: cssVar('--color-pink', '#ec4899'),
        width: 1.3,
        dashed: true,
        baseOpacity: 0.5,
      };
    case 'ownership':
      return {
        color: cssVar('--color-text-tertiary', '#64748b'),
        width: 1,
        dashed: false,
        baseOpacity: 0.3,
      };
  }
}

function descendantsOf(model: C4Model, rootId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const node of model.nodes) {
    if (!node.parentId) continue;
    const list = children.get(node.parentId) ?? [];
    list.push(node.id);
    children.set(node.parentId, list);
  }
  const result = new Set<string>([rootId]);
  const pending = [rootId];
  while (pending.length) {
    const parent = pending.pop()!;
    for (const child of children.get(parent) ?? []) {
      if (result.has(child)) continue;
      result.add(child);
      pending.push(child);
    }
  }
  return result;
}

function ancestorAtDepth(
  byId: Map<string, C4Node>,
  nodeId: string,
  targetDepth: number,
): C4Node | null {
  let current = byId.get(nodeId) ?? null;
  while (current && (LEVEL_INDEX.get(current.level) ?? 0) > targetDepth) {
    current = current.parentId ? (byId.get(current.parentId) ?? null) : null;
  }
  return current && (LEVEL_INDEX.get(current.level) ?? 0) === targetDepth ? current : null;
}

/**
 * External Context nodes do not own containers, but they do connect to them.
 * Treat those adjacent containers as drill-down branch roots so focusing an
 * actor or external system reveals the part of Minion it interacts with.
 */
function focusedBranch(model: C4Model, root: C4Node, byId: Map<string, C4Node>): Set<string> {
  const branch = descendantsOf(model, root.id);
  const rootDepth = LEVEL_INDEX.get(root.level) ?? 0;
  const nextDepth = rootDepth + 1;
  if (nextDepth >= C4_LEVELS.length) return branch;

  for (const relation of model.relations) {
    let adjacentId: string | null = null;
    if (relation.source === root.id) adjacentId = relation.target;
    if (relation.target === root.id) adjacentId = relation.source;
    if (!adjacentId) continue;

    const adjacentRoot = ancestorAtDepth(byId, adjacentId, nextDepth);
    if (!adjacentRoot) continue;
    for (const id of descendantsOf(model, adjacentRoot.id)) branch.add(id);
  }
  return branch;
}

function statusFor(node: C4Node, snapshot: ArchitectureSnapshot): ArchStatus {
  if (!node.statusNodeId) return 'unknown';
  return (
    snapshot.nodes.find((candidate) => candidate.id === node.statusNodeId)?.status ?? 'unknown'
  );
}

function pointOnRing(radius: number, index: number, count: number, phase: number) {
  const angle = phase + (Math.PI * 2 * index) / Math.max(1, count);
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

/**
 * Builds a cumulative C4 projection.
 *
 * With no focus root, the Minion system anchors the center and each deeper C4
 * level occupies the next ring. With a focus root, that node moves to the
 * center and only its descendant branch is projected, one ring per remaining
 * level. This makes clicking a node a genuine structural drill-down instead of
 * a cosmetic highlight.
 */
export function buildC4ArchitectureGraph(
  snapshot: ArchitectureSnapshot,
  maxLevel: C4Level,
  focusRootId: string | null = null,
): C4GraphProjection {
  const model = snapshot.c4;
  const maxDepth = LEVEL_INDEX.get(maxLevel) ?? 0;
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const requestedRoot = focusRootId ? byId.get(focusRootId) : null;
  const defaultRoot =
    byId.get('c4:minion') ?? model.nodes.find((node) => node.level === 'context') ?? null;
  const root = requestedRoot ?? defaultRoot;
  const rootDepth = root ? (LEVEL_INDEX.get(root.level) ?? 0) : 0;
  const branch = focusRootId && root ? focusedBranch(model, root, byId) : null;

  const visibleMeta = model.nodes.filter((node) => {
    const depth = LEVEL_INDEX.get(node.level) ?? 0;
    if (depth > maxDepth) return false;
    if (branch) return branch.has(node.id) && depth >= rootDepth;
    return true;
  });
  const visibleIds = new Set(visibleMeta.map((node) => node.id));

  const anchors = new Map<string, { x: number; y: number }>();
  const centerId = root?.id ?? null;
  if (centerId && visibleIds.has(centerId)) anchors.set(centerId, { x: 0, y: 0 });

  if (branch && root) {
    for (let depth = rootDepth + 1; depth <= maxDepth; depth += 1) {
      const members = visibleMeta.filter((node) => LEVEL_INDEX.get(node.level) === depth);
      const radius = C4_RING_RADII[depth - rootDepth - 1] ?? C4_RING_RADII.at(-1)!;
      members.forEach((member, index) => {
        anchors.set(member.id, pointOnRing(radius, index, members.length, -Math.PI / 2));
      });
    }
  } else {
    const contextPeers = visibleMeta.filter(
      (node) => node.level === 'context' && node.id !== centerId,
    );
    contextPeers.forEach((member, index) => {
      anchors.set(
        member.id,
        pointOnRing(C4_RING_RADII[0], index, contextPeers.length, -Math.PI / 2),
      );
    });
    for (let depth = 1; depth <= maxDepth; depth += 1) {
      const members = visibleMeta.filter((node) => LEVEL_INDEX.get(node.level) === depth);
      const radius = C4_RING_RADII[depth] ?? C4_RING_RADII.at(-1)!;
      members.forEach((member, index) => {
        anchors.set(member.id, pointOnRing(radius, index, members.length, -Math.PI / 2));
      });
    }
  }

  const labelColor = cssVar('--color-text-secondary', '#a1a1aa');
  const unknownFill = cssVar('--color-surface-3', '#27272a');
  const nodes: GraphNode[] = visibleMeta.map((node) => {
    const anchor = anchors.get(node.id) ?? { x: 0, y: 0 };
    const status = statusFor(node, snapshot);
    const border = c4LevelColor(node.level);
    const fill = node.statusNodeId ? archStatusColor(status) : unknownFill;
    const depth = LEVEL_INDEX.get(node.level) ?? 0;
    const symbolSize = [76, 60, 48, 38][depth] ?? 38;
    return {
      id: node.id,
      kind: 'shared',
      label: node.name,
      color: fill,
      strokeColor: border,
      strokeWidth: node.id === centerId ? 4 : 2.5,
      areaId: null,
      radius: Math.hypot(anchor.x, anchor.y),
      ax: anchor.x,
      ay: anchor.y,
      symbolSize,
      pinned: node.id === centerId,
      image: areaIconDataUri(node.icon, fill, shade(fill, -0.35), border),
      labelColor,
      labelTier: node.id === centerId ? 'primary' : 'secondary',
      labelSize: node.level === 'code' ? 9 : 10,
      showLabel: true,
    };
  });

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const visibleEndpoint = (id: string): string | null => {
    if (visibleIds.has(id)) return id;
    if (branch) return null;
    return ancestorAtDepth(byId, id, maxDepth)?.id ?? null;
  };
  const push = (rawSource: string, rawTarget: string, kind: C4RelationKind) => {
    const source = visibleEndpoint(rawSource);
    const target = visibleEndpoint(rawTarget);
    if (!source || !target || source === target) return;
    const key = `${source}\u0000${target}\u0000${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({
      source,
      target,
      ...c4RelationStyle(kind),
      directed: kind !== 'ownership',
    });
  };

  // Decomposition is always present so every visible branch explains where it lives.
  for (const node of visibleMeta) {
    if (node.parentId) push(node.parentId, node.id, 'ownership');
  }
  for (const relation of model.relations) push(relation.source, relation.target, relation.kind);

  const relativeDepth = branch ? Math.max(0, maxDepth - rootDepth) : maxDepth + 1;
  const rings = C4_RING_RADII.slice(0, Math.min(C4_RING_RADII.length, relativeDepth));
  return {
    nodes,
    edges,
    visibleIds,
    rings,
    metaById: new Map(visibleMeta.map((node) => [node.id, node])),
  };
}
