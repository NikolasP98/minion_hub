# Overview Graph — Fluid Redesign (D3-force + PixiJS)

**Date:** 2026-06-17
**Status:** Approved (design)
**Component:** `minion_hub` → `/overview` org map
**Replaces:** ECharts `graph` series implementation in `src/lib/components/overview/OverviewGraph.svelte`

## Problem

The `/overview` org graph feels stiff and lifeless. Root cause: it renders an
ECharts `graph` series with `layout: 'none'` and `fixed: true` on **every**
node — there is no motion model at all. Nodes snap to pre-computed polar
coordinates and never move. Compounding it:

- Focus/dim is applied via `chart.setOption(buildOption(focus), { notMerge: true })`,
  a full teardown that **cuts** rather than tweens — the highlight/dim feels abrupt.
- The code already fights the abstraction: `roam` disabled, pan/zoom hand-rolled
  on raw `zrender` events, `setOption` coalesced to one call per animation frame
  to stop lag, and camera math done through `convertToPixel` / `convertFromPixel`.

ECharts is a charting library, not a graph engine. Its force layout exposes only
coarse global knobs (repulsion / gravity / edgeLength / friction) with no
collision force, no per-edge link strength, and no custom/constrained forces —
so it cannot express "settle near a ring radius and sector angle, but breathe."

## Goal

Make the nodes feel fluid and alive while **preserving the existing concentric
ring + sector structure** (it is a deliberate, readable design). Specifically:

1. **Keep rings, make them breathe** — nodes settle on their ring/sector but
   drift gently and never overlap.
2. **Subtle idle motion** — perpetual low-amplitude wander; the simulation never
   hard-freezes.
3. **Draggable nodes** — grab and fling a node; forces tug it (and neighbors) and
   it eases back to its home slot.
4. **Smooth focus transitions** — hover/click dim & highlight tween instead of cut.

This is a pure render/interaction swap. The **data contract is unchanged**: same
props, same `org-areas.service`, same `entities.ts` and `lucide-svg.ts`.

## Approach

Rebuild on **`d3-force`** (physics) + **PixiJS 8** (rendering). PixiJS 8.18 and
`@dimforge/rapier2d-compat` are already hub dependencies (workshop canvas);
Rapier is rigid-body physics and the wrong tool for graph springs/links, so we
add **`d3-force`** + **`@types/d3-force`**. ECharts remains a dependency (used by
charts/reliability panels elsewhere); only this component stops importing it.

### Why anchor springs, not `forceRadial`

`forceRadial` constrains a node's *radius* but not its *angle* — nodes would
slide around a ring and leave their sector. Instead each node carries a
pre-computed target anchor `(ax, ay)` (the same polar coordinate the current
`at(r, angle)` produces). The simulation pulls each node toward its anchor with
`forceX(ax)` + `forceY(ay)` at modest strength — preserving **both** ring radius
and sector angle — while collision, links, and a wander offset add the life.

## Architecture

New directory `src/lib/components/overview/graph/` with four focused units:

### `build-graph.ts` (pure)

Props → `{ nodes, edges }`. Ports the existing bucket/sector/ring-assignment
logic from `OverviewGraph.svelte` (`$derived` graph block, areas → buckets →
center/area/skill/integration/agent/user rings, service-account `shared` band,
subscription edges, `__unassigned__` bucket). Each node carries:

```ts
type GraphNode = {
  id: string;
  kind: 'org' | 'area' | 'skill' | 'integration' | 'agent' | 'user' | 'shared';
  label: string;
  color: string;          // real hex (palette + area colors, as today)
  areaId: string | null;
  areaName?: string;
  role?: string;
  skills?: string[];
  integrations?: string[];
  image?: string;         // avatar / logo / lucide data-URI (resolved as today)
  logoImage?: string;     // integration brand logo painted over the disc
  radius: number;         // ring radius (collision + initial placement)
  ax: number;             // target anchor x (cos)
  ay: number;             // target anchor y (sin)
  symbolSize: number;     // render diameter in world units
};
type GraphEdge = {
  source: string;
  target: string;
  color: string;
  baseOpacity: number;
  width: number;
  dashed?: boolean;       // shared-account subscription tethers
};
```

Differences from today:
- **No ring-guide nodes.** The 360 invisible nodes (72 segments × 5 rings) that
  exist only to draw orbit circles are dropped — rings become `Graphics.arc()`
  calls in the renderer.
- **No `__tie` / `__ring` edge hacks.** The integration disc+logo becomes a
  single node with an overlaid logo sprite (`logoImage`), so the zero-length tie
  edge is unnecessary.

Color helpers (`hexToRgba`, `shade`) move here unchanged.

### `simulation.ts`

Wraps `d3-force` over the built nodes/edges. Forces:

- `forceX(d => d.ax).strength(ANCHOR_STRENGTH)` + `forceY(d => d.ay).strength(ANCHOR_STRENGTH)`
  — anchor springs (keep ring + sector).
- `forceCollide(d => d.symbolSize / 2 + COLLIDE_PAD)` — organic non-overlap.
- `forceLink(edges).id(d => d.id).distance(...).strength(LINK_STRENGTH)` — edge flex.
- `forceManyBody().strength(WEAK_REPULSION)` — light spacing (kept weak so anchors win).
- **Wander:** on each tick, add a low-frequency per-node sine offset
  (`sin(t * f + phase)`) to the effective anchor target so the graph keeps
  breathing. `alphaMin` set low so the sim never settles to a hard stop.

Exposed API (no Pixi/Svelte imports — unit-testable):
```ts
createSimulation(nodes, edges, opts?) => {
  tick(): void;            // advance one step (called from render loop)
  drag(id, x, y): void;    // pin node to (x,y), reheat
  release(id): void;       // clear pin → anchor springs pull home
  reheat(): void;          // bump alphaTarget (e.g. on resize)
  nodes(): GraphNode[];    // live positions
  stop(): void;
}
```

The org node is pinned at origin `(0,0)`.

### `renderer.ts`

PixiJS scene. Owns:
- **Texture cache** — loads avatar (DiceBear), integration logo, and lucide
  area-icon data-URIs into Pixi textures (async; placeholder circle until ready).
- **World container** — all graph content; pan = `world.position`, zoom =
  `world.scale` toward cursor.
- **Ring guides** — faint `Graphics.arc()` per ring radius.
- **Edge layer** — pooled `Graphics`, redrawn each frame from live node positions.
- **Node layer** — one `Container` per node (background circle/sprite + optional
  logo sprite + label `Text`); label visibility culled at low zoom.
- **Focus alpha** — each node/edge has `displayAlpha` lerped toward its focus
  target every frame → smooth tweened dim/highlight.
- **Camera** — `animateTo(center, zoom, ms)` eased tween (ported from existing
  `animateTo`/`measureView`), operating on the world transform.

Exposed API:
```ts
createRenderer(canvas, { onNodeHover, onNodeClick, onNodeDrag, onBackgroundClick, onPan, onWheelZoom }) => {
  setGraph(nodes, edges): void;
  frame(): void;                       // draw current sim positions (called in loop)
  setFocus(ids: Set<string> | null): void;
  animateTo(center, zoom, ms?): void;
  resize(): void;
  destroy(): void;
}
```

### `OverviewGraph.svelte` (thin shell)

- Mounts the canvas; on mount builds graph (`build-graph`), starts the sim
  (`simulation`) and renderer (`renderer`), and runs a single `requestAnimationFrame`
  loop: `sim.tick(); renderer.frame();`.
- Wires renderer callbacks → interaction logic (focus set, camera glide, drag).
- Re-derives & re-feeds the graph when props change (Svelte `$effect`).
- Keeps the existing overlays unchanged: ring legend, empty-state message, and
  the `selected` detail panel (bottom-right card).
- `ResizeObserver` → `renderer.resize()`.

## Interactions

| Gesture | Behavior |
|---|---|
| Hover node | Adjacency focus — node + linked neighbors stay lit, rest fade (tweened). |
| Click node | Sector focus (everything sharing `areaId` stays lit) + camera glides to it. Org → home; area → centers the sector; leaf → zooms in. (Ports `focusSetFor` + click logic.) |
| Drag node | `sim.drag(id, worldX, worldY)` pins to pointer + reheats; release clears pin so anchor springs pull it home. |
| Drag empty canvas | Pan (`world.position`). |
| Wheel | Zoom toward cursor (clamped, as today: ~0.12–5). |
| Click empty | Clear focus, glide home. |

Hover tooltip: keep the existing Svelte detail panel driven by `selected`; a
lightweight hover label can reuse the node's Pixi `Text` (already shown on focus).

## Data flow

```
props (org, areas, agents, members, subscriptions)
  → build-graph.ts  → { nodes (with anchors), edges }
  → simulation.ts   → live positions per tick
  → renderer.ts     → Pixi scene (world container)
        ↑ interaction callbacks → focus set / camera / drag → sim + renderer
```

No server, service, or schema changes. `org-areas.service`, `entities.ts`,
`lucide-svg.ts` untouched.

## Error handling & edge cases

- **Empty graph** (no areas/agents): keep the existing empty-state overlay; sim
  runs with just the org node + any unassigned bucket.
- **Texture load failure**: node falls back to a solid colored circle (no logo).
- **Many nodes**: main-thread sim is fine at FACES scale (~50–150 nodes). If a
  future org is far larger, the sim loop is the throttle point — out of scope now,
  noted as a follow-up (move sim to a worker).
- **Reduced motion**: respect `prefers-reduced-motion` — disable the wander
  offset and shorten camera tweens (settle-and-still) when set.
- **Dispose**: render loop cancelled, sim stopped, Pixi app + textures destroyed,
  observers removed on unmount.

## Testing

- `build-graph.test.ts` (vitest, pure):
  - node/edge counts for a representative org;
  - each node's anchor lands on the correct ring radius (`hypot(ax,ay) ≈ radius`)
    and sector angle;
  - service accounts excluded from the user ring, present in the `shared` band;
  - subscription edges only between existing shared + user nodes;
  - `__unassigned__` bucket appears for loose agents/users.
- `simulation.test.ts` (vitest):
  - after N ticks, free nodes settle within tolerance of their anchors;
  - `drag` pins a node away from its anchor; `release` returns it toward anchor;
  - org node stays at origin.
- Renderer: verified via `bun run check` (must stay **0 errors / 0 warnings**) and
  a manual visual pass on `/overview` (hover, click-focus, drag-and-release,
  pan/zoom, empty state, reduced-motion).

## Out of scope / follow-ups

- Web-worker simulation for very large orgs.
- Removing `echarts` from the dependency tree (still used elsewhere).
- Any change to the underlying org-area data model or API.

## Files

```
minion_hub/
  package.json                                   # + d3-force, @types/d3-force
  src/lib/components/overview/
    OverviewGraph.svelte                         # rewritten thin shell
    graph/
      build-graph.ts                             # new (pure)
      build-graph.test.ts                        # new
      simulation.ts                              # new
      simulation.test.ts                         # new
      renderer.ts                                # new (Pixi)
```
