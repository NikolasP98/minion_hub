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

  // Module-scope refs assigned from onMount so the top-level $effect can read them.
  let _renderer: Renderer | null = null;
  let _sim: Simulation | null = null;
  let _ready = false;

  const HOME: { center: [number, number]; zoom: number } = { center: [0, 0], zoom: 0.46 };

  // ── Top-level effect: rebuild when props change after the renderer is ready ──
  $effect(() => {
    // Touch reactive deps so Svelte tracks them.
    void [org, areas, agents, members, subscriptions];
    if (!_ready) return;
    rebuild();
  });

  // adjacency map — precomputed in rebuild(), never called per-event
  let adjacencyMap = new Map<string, Set<string>>();
  let metaById = new Map<string, GraphNode>();

  function adjacency(id: string): Set<string> {
    return adjacencyMap.get(id) ?? new Set([id]);
  }

  function focusSetFor(node: GraphNode | null): Set<string> | null {
    if (!node || node.kind === 'org') return null;
    const ids = new Set<string>([org.id]);
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

    // Precompute adjacency: each id → set of neighbor ids (plus itself)
    adjacencyMap = new Map<string, Set<string>>();
    for (const nd of nodes) {
      if (!adjacencyMap.has(nd.id)) adjacencyMap.set(nd.id, new Set([nd.id]));
    }
    for (const e of edges) {
      if (!adjacencyMap.has(e.source)) adjacencyMap.set(e.source, new Set([e.source]));
      if (!adjacencyMap.has(e.target)) adjacencyMap.set(e.target, new Set([e.target]));
      adjacencyMap.get(e.source)!.add(e.target);
      adjacencyMap.get(e.target)!.add(e.source);
    }

    _sim.stop();
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    _sim = createSimulation(nodes, edges, { reducedMotion });
    _renderer.setGraph(_sim.nodes() as SimNode[], edges);
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
      adjacencyMap = new Map<string, Set<string>>();
      for (const nd of nodes) {
        if (!adjacencyMap.has(nd.id)) adjacencyMap.set(nd.id, new Set([nd.id]));
      }
      for (const e of edges) {
        if (!adjacencyMap.has(e.source)) adjacencyMap.set(e.source, new Set([e.source]));
        if (!adjacencyMap.has(e.target)) adjacencyMap.set(e.target, new Set([e.target]));
        adjacencyMap.get(e.source)!.add(e.target);
        adjacencyMap.get(e.target)!.add(e.source);
      }

      _sim = createSimulation(nodes, edges, { reducedMotion });
      renderer.setGraph(_sim.nodes() as SimNode[], edges);

      // Signal that renderer + sim are ready so the top-level $effect can run.
      _ready = true;

      const loop = () => {
        _sim?.tick();
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
          if (!selected) r.setFocus(id ? adjacency(id) : null);
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
          if (selected) {
            selected = null;
            r.setFocus(null);
            r.animateTo(HOME.center, HOME.zoom);
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
      if (!m) return;
      r.setFocus(focusSetFor(m));
      if (m.kind === 'org') {
        r.animateTo(HOME.center, HOME.zoom);
      } else if (m.kind === 'area') {
        const ang = Math.atan2(m.ay, m.ax);
        const rr = (RADII.area + RADII.user) / 2;
        r.animateTo([rr * Math.cos(ang), rr * Math.sin(ang)], 1.0);
      } else {
        r.animateTo([m.ax, m.ay], 1.55);
      }
    }

    const ro = new ResizeObserver(() => _renderer?.resize());
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
