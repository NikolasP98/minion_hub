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
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import type { OrgArea } from '$server/services/org-areas.service';
  import { INTEGRATIONS } from '$lib/types/entities';
  import { buildGraph, RADII, type GraphNode, type NodeKind } from './graph/build-graph';
  import { createSimulation, type Simulation, type SimNode } from './graph/simulation';
  import { createRenderer, type Renderer } from './graph/renderer';

  interface AgentLike { id: string; name?: string | null; archetype?: string | null }
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

  // Legend counts = DISTINCT entities per level (what the org has), derived from
  // props — not rendered-node counts (skills/integrations/agents/users are placed
  // per-area, so node counts over-count). Matches the old header semantics.
  const legendCounts = $derived.by<Partial<Record<NodeKind, number>>>(() => {
    const persons = members.filter((m) => (m.accountType ?? 'person') !== 'service');
    const virtual = areas.reduce((s, a) => s + a.virtualAgents.length, 0);
    return {
      area: areas.length,
      skill: new Set(areas.flatMap((a) => a.skillKeys)).size,
      integration: new Set(areas.flatMap((a) => a.integrationKeys).filter((k) => INTEGRATIONS[k])).size,
      agent: agents.length + virtual,
      user: persons.length
    };
  });
  // Active legend level for highlight
  let activeLegendKind = $state<NodeKind | null>(null);

  // Module-scope refs assigned from onMount so the top-level $effect can read them.
  let _renderer: Renderer | null = null;
  let _sim: Simulation | null = null;
  let _ready = false;
  // Current layout rotation (radians); set when an area is selected, 0 otherwise.
  let _rotation = 0;
  // Eased rotation tween so the pivot (and the recovery on deselect) sweeps
  // smoothly along an arc instead of snapping the anchors and letting springs
  // chase straight lines. Driven each frame by stepRotation() in the rAF loop.
  let _rotTween: { from: number; to: number; start: number; ms: number } | null = null;
  function animateRotation(to: number, ms = 700) {
    // Tween from the CURRENT rotation along the SHORTEST arc — so selecting a
    // new group rotates directly from where we are (never resets to 0 / sweeps
    // the long way). cos/sin are periodic, so accumulating ±2π in _rotation is fine.
    const TAU = Math.PI * 2;
    let delta = (to - _rotation) % TAU;
    if (delta > Math.PI) delta -= TAU;
    if (delta < -Math.PI) delta += TAU;
    if (Math.abs(delta) < 1e-4 && !_rotTween) return;
    _rotTween = { from: _rotation, to: _rotation + delta, start: performance.now(), ms };
  }
  function stepRotation() {
    if (!_rotTween || !_sim) return;
    const prev = _rotation;
    const t = Math.min(1, (performance.now() - _rotTween.start) / _rotTween.ms);
    const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // easeInOutCubic
    _rotation = _rotTween.from + (_rotTween.to - _rotTween.from) * k;
    // Rigid incremental rotation — no spring chase, so no overshoot/shake.
    _sim.rotateBy(_rotation - prev);
    if (t >= 1) {
      _rotation = _rotTween.to;
      _rotTween = null;
    }
  }

  // ── Top-level effect: rebuild when props change after the renderer is ready ──
  $effect(() => {
    // Touch reactive deps so Svelte tracks them.
    void [org, areas, agents, members, subscriptions];
    if (!_ready) return;
    rebuild();
  });

  // adjacency map — precomputed in rebuild(), never called per-event
  let adjacencyMap = new SvelteMap<string, SvelteSet<string>>();
  let metaById = new Map<string, GraphNode>();

  function adjacency(id: string): SvelteSet<string> {
    return adjacencyMap.get(id) ?? new SvelteSet([id]);
  }

  function focusSetFor(node: GraphNode | null): SvelteSet<string> | null {
    if (!node || node.kind === 'org') return null;
    const ids = new SvelteSet<string>([org.id]);
    for (const [id, m] of metaById) if (m.areaId === node.areaId) ids.add(id);
    return ids;
  }

  function rebuild() {
    if (!_renderer || !_sim) return;
    const { nodes, edges } = buildGraph({ org, areas, agents, members, subscriptions });
    nodeCount = nodes.length;
    metaById = new Map(nodes.map((nd) => [nd.id, nd]));

    // Clear stale selection — the node may have been removed since last render.
    if (selected && !metaById.has(selected.id)) {
      selected = null;
      _renderer?.setFocus(null);
    }

    // If a legend level is active, reapply the focus set for the new nodes.
    if (activeLegendKind) {
      const ids = new SvelteSet(nodes.filter((n) => n.kind === activeLegendKind).map((n) => n.id));
      _renderer?.setFocus(ids.size > 0 ? ids : null);
    }

    // Precompute adjacency: each id → set of neighbor ids (plus itself)
    adjacencyMap = new SvelteMap<string, SvelteSet<string>>();
    for (const nd of nodes) {
      if (!adjacencyMap.has(nd.id)) adjacencyMap.set(nd.id, new SvelteSet([nd.id]));
    }
    for (const e of edges) {
      if (!adjacencyMap.has(e.source)) adjacencyMap.set(e.source, new SvelteSet([e.source]));
      if (!adjacencyMap.has(e.target)) adjacencyMap.set(e.target, new SvelteSet([e.target]));
      adjacencyMap.get(e.source)!.add(e.target);
      adjacencyMap.get(e.target)!.add(e.source);
    }

    _sim.stop();
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    _sim = createSimulation(nodes, edges, { reducedMotion });
    _renderer.setGraph(_sim.nodes() as SimNode[], edges);
    // Preserve any active rotation across rebuilds (a fresh sim starts at 0).
    if (_rotation) _sim.setRotation(_rotation);
  }

  function toggleLegendKind(kind: NodeKind) {
    if (!_renderer) return;
    // Legend highlighting uses the default orientation — smoothly recover it.
    if (_rotation || _rotTween) {
      animateRotation(0);
      const p = _renderer.fitParams();
      if (p) _renderer.animateTo(p.center, p.zoom);
    }
    if (activeLegendKind === kind) {
      // Deactivate
      activeLegendKind = null;
      selected = null;
      _renderer.setFocus(null);
    } else {
      activeLegendKind = kind;
      selected = null;
      const ids = new SvelteSet(
        Array.from(metaById.values())
          .filter((n) => n.kind === kind)
          .map((n) => n.id)
      );
      _renderer.setFocus(ids.size > 0 ? ids : null);
    }
  }

  onMount(() => {
    if (!canvasEl) return;

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let raf = 0;
    let disposed = false;

    (async () => {
      // createRenderer takes no callback — the shell drives all gestures itself.
      const renderer = await createRenderer(canvasEl!);
      if (disposed) {
        renderer.destroy();
        return;
      }
      _renderer = renderer;

      const { nodes, edges } = buildGraph({ org, areas, agents, members, subscriptions });
      nodeCount = nodes.length;
      metaById = new Map(nodes.map((nd) => [nd.id, nd]));

      // Precompute adjacency for the initial graph
      adjacencyMap = new SvelteMap<string, SvelteSet<string>>();
      for (const nd of nodes) {
        if (!adjacencyMap.has(nd.id)) adjacencyMap.set(nd.id, new SvelteSet([nd.id]));
      }
      for (const e of edges) {
        if (!adjacencyMap.has(e.source)) adjacencyMap.set(e.source, new SvelteSet([e.source]));
        if (!adjacencyMap.has(e.target)) adjacencyMap.set(e.target, new SvelteSet([e.target]));
        adjacencyMap.get(e.source)!.add(e.target);
        adjacencyMap.get(e.target)!.add(e.source);
      }

      _sim = createSimulation(nodes, edges, { reducedMotion });
      renderer.setGraph(_sim.nodes() as SimNode[], edges);
      // Auto-fit the whole graph on initial load instead of a fixed zoom
      renderer.fitView();

      // Signal that renderer + sim are ready so the top-level $effect can run.
      _ready = true;

      const loop = () => {
        // While a rotation tween runs, do a pure rigid rotation (no physics) so
        // nothing overshoots; resume normal physics (breathing/collision) after.
        if (_rotTween) {
          stepRotation();
        } else {
          _sim?.tick();
        }
        renderer.frame();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);

      wireGestures(renderer);
    })();

    function wireGestures(r: Renderer) {
      const el = canvasEl!;
      let mode: 'none' | 'pan' | 'node' = 'none';
      let dragId: string | null = null;
      let moved = false;
      let last = { x: 0, y: 0 };
      const DRAG_THRESHOLD = 4;

      const local = (e: MouseEvent) => {
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
          if (!selected && !activeLegendKind) r.setFocus(id ? adjacency(id) : null);
          el.style.cursor = id ? 'pointer' : 'default';
          return;
        }
        if (Math.hypot(p.x - last.x, p.y - last.y) > DRAG_THRESHOLD) moved = true;
        if (mode === 'node' && dragId) {
          const [wx, wy] = r.screenToWorld(p.x, p.y);
          _sim?.drag(dragId, wx, wy);
        } else if (mode === 'pan') {
          r.panBy(p.x - last.x, p.y - last.y);
        }
        last = p;
      });

      const end = (e: PointerEvent) => {
        if (!moved && mode === 'node' && dragId) {
          clickNode(dragId, r);
        } else if (!moved && mode === 'pan') {
          if (selected || activeLegendKind) {
            selected = null;
            activeLegendKind = null;
            r.setFocus(null);
            // Smoothly recover the original orientation + framing on deselect.
            animateRotation(0);
            const p = r.fitParams();
            if (p) r.animateTo(p.center, p.zoom);
          }
        }
        if (mode === 'node' && dragId) _sim?.release(dragId);
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

    function clickNode(id: string, r: Renderer) {
      const m = metaById.get(id) ?? null;
      selected = m;
      // Clicking a node clears any active legend level
      activeLegendKind = null;
      if (!m) return;
      r.setFocus(focusSetFor(m));
      if (m.kind === 'org') {
        // Org = whole graph: smoothly recover the original orientation and fit.
        animateRotation(0);
        const p = r.fitParams();
        if (p) r.animateTo(p.center, p.zoom);
      } else if (m.kind === 'area') {
        // Rotate the layout so this sector points along the canvas's long axis
        // (right on wide screens, down on tall ones), then frame it.
        const el = canvasEl!;
        const targetAngle = el.clientWidth >= el.clientHeight ? 0 : Math.PI / 2;
        const sectorAngle = Math.atan2(m.ay, m.ax);
        animateRotation(targetAngle - sectorAngle);
        const rr = (RADII.area + RADII.user) / 2;
        const longPx = Math.max(el.clientWidth, el.clientHeight);
        const fitZoom = longPx / (RADII.user * 1.5);
        r.animateTo([rr * Math.cos(targetAngle), rr * Math.sin(targetAngle)], fitZoom);
      } else {
        // Leaf node: camera target must follow the current rotation.
        const c = Math.cos(_rotation);
        const s = Math.sin(_rotation);
        r.animateTo([m.ax * c - m.ay * s, m.ax * s + m.ay * c], 1.55);
      }
    }

    const ro = new ResizeObserver(() => {
      _renderer?.resize();
      _renderer?.fitView();
    });
    ro.observe(canvasEl!);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      _sim?.stop();
      _renderer?.destroy();
      _renderer = null;
      _sim = null;
      _ready = false;
    };
  });

  // Legend rows: label → kind mapping
  const LEGEND_ROWS: Array<{ label: string; glyph: string; kind: NodeKind }> = [
    { label: 'Areas',        glyph: '●', kind: 'area' },
    { label: 'Skills',       glyph: '◦', kind: 'skill' },
    { label: 'Integrations', glyph: '◆', kind: 'integration' },
    { label: 'Agents',       glyph: '◉', kind: 'agent' },
    { label: 'Users',        glyph: '◎', kind: 'user' },
  ];
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

  <!-- Ring legend (clickable) -->
  <div class="absolute bottom-3 left-3 z-10 flex flex-col gap-0.5 text-[10px] text-muted bg-bg2/80 backdrop-blur-sm border border-border rounded-lg px-2 py-1.5">
    {#each LEGEND_ROWS as row (row.kind)}
      {@const count = legendCounts[row.kind] ?? 0}
      {@const active = activeLegendKind === row.kind}
      <button
        type="button"
        class="flex items-center gap-1.5 px-1 py-0.5 rounded transition-colors cursor-pointer text-left w-full {active ? 'bg-accent/20 text-accent' : 'hover:text-foreground'}"
        onclick={() => toggleLegendKind(row.kind)}
        aria-pressed={active}
      >
        <span class="opacity-60">{row.glyph}</span>
        <span>{row.label}</span>
        {#if count > 0}
          <span class="ml-auto opacity-60 tabular-nums">{count}</span>
        {/if}
      </button>
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
