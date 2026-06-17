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
    .force('link', forceLink<SimNode, SimLink>(links).id((d) => d.id).distance((l) => {
      const s = l.source as SimNode;
      const t = l.target as SimNode;
      return Math.abs(s.radius - t.radius) || 60;
    }).strength(LINK_STRENGTH))
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
