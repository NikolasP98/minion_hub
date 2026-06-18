import {
  forceSimulation,
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
  /** Original (unrotated) anchor — setRotation derives `bax`/`bay` from this. */
  oax: number;
  oay: number;
  /** Current base anchor (original rotated by the view angle); `ax`/`ay` = base + wander. */
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
  /** Rotate the whole layout by `theta` radians around the origin (springs animate into it). */
  setRotation(theta: number): void;
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
// Label-aware spacing: nodes seek enough room that their labels don't overlap
// at LABEL_FIT_ZOOM, so culling is rarely needed above that zoom.
const LABEL_FIT_ZOOM = 0.75;
const MIN_LABEL_SCREEN_PX = 11; // mirror renderer MIN_LABEL_PX
const LABEL_MAX_WORLD_HALF = 130; // cap optimistic spacing for very long labels
const CHAR_W_RATIO = 0.55; // approx average glyph width as a fraction of font height

/** Collision radius that reserves room for the node AND its label (at LABEL_FIT_ZOOM). */
function collideRadius(d: SimNode): number {
  const base = d.symbolSize / 2 + COLLIDE_PAD;
  if (!d.showLabel) return base;
  const fontPx = Math.max(MIN_LABEL_SCREEN_PX, d.labelSize * LABEL_FIT_ZOOM);
  const screenHalfW = (d.label.length * fontPx * CHAR_W_RATIO) / 2;
  const worldHalf = Math.min(LABEL_MAX_WORLD_HALF, screenHalfW / LABEL_FIT_ZOOM);
  return Math.max(base, worldHalf + COLLIDE_PAD);
}

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
    oax: nd.ax,
    oay: nd.ay,
    bax: nd.ax,
    bay: nd.ay,
    phase: (i * 2.39996) % (Math.PI * 2), // golden-angle spread, no Math.random
  }));
  const byId = new Map(simNodes.map((nd) => [nd.id, nd]));

  const links: SimLink[] = edges
    .filter((e) => byId.has(e.source) && byId.has(e.target))
    .map((e) => ({ source: e.source, target: e.target }));

  // Pull each node toward its CURRENT anchor. A custom force, not forceX/forceY:
  // those cache the target at initialize(), but we mutate ax/ay every tick
  // (wander) and on rotation, so the force must read the live anchor each tick.
  function anchorForce(alpha: number) {
    for (const nd of simNodes) {
      if (nd.pinned || nd.fx != null) continue;
      nd.vx += (nd.ax - nd.x) * ANCHOR_STRENGTH * alpha;
      nd.vy += (nd.ay - nd.y) * ANCHOR_STRENGTH * alpha;
    }
  }

  const sim: D3Sim<SimNode, SimLink> = forceSimulation<SimNode>(simNodes)
    .force('anchor', anchorForce)
    .force('collide', forceCollide<SimNode>((d) => collideRadius(d)))
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
    setRotation(theta) {
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      for (const nd of simNodes) {
        if (nd.pinned) continue;
        nd.bax = nd.oax * c - nd.oay * s;
        nd.bay = nd.oax * s + nd.oay * c;
        // Update the live anchor too so the force target moves immediately
        // (covers reduced-motion, where tick() doesn't re-derive ax/ay).
        nd.ax = nd.bax;
        nd.ay = nd.bay;
      }
      sim.alpha(Math.max(sim.alpha(), 0.6)); // reheat so springs animate into the new angle
    },
    stop() {
      sim.stop();
    },
  };
}
