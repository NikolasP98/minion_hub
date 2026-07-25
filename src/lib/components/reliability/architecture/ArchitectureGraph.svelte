<!--
  ArchitectureGraph — live infrastructure topology for the /reliability
  Architecture tab. Same physics/rendering stack as the Organization overview
  graph (`$lib/components/overview/graph/{simulation,renderer}.ts`, reused
  as-is); `buildArchitectureGraph` maps the server's topology+status snapshot
  onto it. Node disc color = live status; click a node for endpoints, status
  reasoning and per-connection port/protocol justification.
-->
<script lang="ts">
  import { Button, Spinner, SegmentedControl, Tooltip, iconSizes } from '$lib/components/ui';
  import { CornerUpLeft, Info, ListTree, LocateFixed, RefreshCw } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import * as m from '$lib/paraglide/messages';
  import { theme } from '$lib/state/ui/theme.svelte';
  import {
    buildArchitectureGraph,
    archStatusColor,
    type ArchGroupMode,
  } from './build-architecture-graph';
  import {
    buildC4ArchitectureGraph,
    c4FocusLevel,
    c4ParentFocusTarget,
    c4LevelColor,
    c4RelationStyle,
    C4_LEVELS,
  } from './build-c4-architecture-graph';
  import {
    createSimulation,
    type Simulation,
    type SimNode,
  } from '$lib/components/overview/graph/simulation';
  import {
    createRenderer,
    themeLabelColors,
    type Renderer,
  } from '$lib/components/overview/graph/renderer';
  import type {
    ArchitectureSnapshot,
    ArchNodeDef,
    ArchNodeStatus,
    ArchStatus,
  } from '$server/services/architecture.service';
  import type { C4Level, C4Node, C4RelationKind } from '$server/services/architecture-c4.model';

  type SnapshotNode = ArchNodeDef & ArchNodeStatus;
  type ArchitectureView = 'c4' | 'infrastructure';

  const POLL_MS = 30_000;
  const MIN_ACTION_ORBIT_PX = 48;
  const MIN_ACTION_SIZE_PX = 32;
  const MAX_ACTION_SIZE_PX = 64;
  /** Bubble diameter targets one quarter of node diameter:
   *  nodeDiameter * 0.25 === nodeRadius * 0.5. */
  const ACTION_SIZE_TO_NODE_RATIO = 0.5;
  const ACTION_ICON_TO_BUBBLE_RATIO = 0.68;
  const ACTION_NODE_GAP_PX = 8;
  const HOVER_EXIT_GRACE_MS = 350;
  const C4_FOCUS_FIT_SCALE = 1.18;
  const C4_FOCUS_MIN_ZOOM = 0.32;
  const C4_FOCUS_MAX_ZOOM = 1.35;

  let canvasEl: HTMLCanvasElement | undefined = $state();
  let snapshot = $state<ArchitectureSnapshot | null>(null);
  let selectedInfra = $state<SnapshotNode | null>(null);
  let selectedC4 = $state<C4Node | null>(null);
  let loading = $state(true);
  let failed = $state(false);
  let viewMode = $state<ArchitectureView>('c4');
  let c4Level = $state<C4Level>('context');
  let c4FocusRootId = $state<string | null>(null);
  let legendExpanded = $state(false);
  let hoveredNodeId = $state<string | null>(null);
  let hoveredNodeLabel = $state('');
  let hoveredNodeHasParent = $state(false);
  let hoverAnchor = $state({ x: 0, y: 0 });
  let hoverActionDiameter = $state(MIN_ACTION_ORBIT_PX * 2);
  let hoverActionSize = $state(MIN_ACTION_SIZE_PX);
  let hoverActionsOpen = $state(false);
  let hoverActionsActive = false;
  let hoverClearTimer: ReturnType<typeof setTimeout> | null = null;
  /** Grouping lens: designed topology zones, or scoped boxes by host / function. */
  let groupMode = $state<ArchGroupMode>('topology');
  const modeItems = $derived([
    { value: 'topology', label: m.reliability_archModeTopology() },
    { value: 'network', label: m.reliability_archModeNetwork() },
    { value: 'function', label: m.reliability_archModeFunction() },
  ]);
  const viewItems = $derived([
    { value: 'c4', label: m.reliability_archViewC4() },
    { value: 'infrastructure', label: m.reliability_archViewInfrastructure() },
  ]);
  const c4LevelItems = $derived([
    { value: 'context', label: m.reliability_archLevelContext() },
    { value: 'container', label: m.reliability_archLevelContainer() },
    { value: 'component', label: m.reliability_archLevelComponent() },
    { value: 'code', label: m.reliability_archLevelCode() },
  ]);

  let _renderer: Renderer | null = null;
  let _sim: Simulation | null = null;
  let _ready = false;
  let _graphSig = '';
  /** Groups of the current build (index-aligned with renderer.groupAt). */
  let _groups: { label: string; nodeIds: string[] }[] = [];
  /** User-dragged box displacements per mode, keyed by group label — reapplied
   *  on every rebuild so poll refreshes don't reset the arrangement. */
  const boxOffsets: Record<ArchGroupMode, Record<string, { dx: number; dy: number }>> = {
    topology: {},
    network: {},
    function: {},
  };

  /** Grouped layouts need stiffer anchors so link forces can't drag members
   *  out of their box (drifting members made sibling boxes overlap). */
  function simOptions(reducedMotion: boolean, grouped: boolean) {
    return grouped
      ? { reducedMotion, anchorStrength: 0.3, linkStrength: 0.015 }
      : { reducedMotion };
  }

  const STATUS_LABEL: Record<ArchStatus, () => string> = {
    ok: () => m.reliability_archStatusOk(),
    degraded: () => m.reliability_archStatusDegraded(),
    down: () => m.reliability_archStatusDown(),
    unknown: () => m.reliability_archStatusUnknown(),
  };
  const LEGEND: ArchStatus[] = ['ok', 'degraded', 'down', 'unknown'];
  const C4_RELATION_KINDS: C4RelationKind[] = ['runtime', 'data', 'event', 'deploy', 'ownership'];
  const C4_RELATION_LABEL: Record<C4RelationKind, () => string> = {
    runtime: () => m.reliability_archRelationRuntime(),
    data: () => m.reliability_archRelationData(),
    event: () => m.reliability_archRelationEvent(),
    deploy: () => m.reliability_archRelationDeploy(),
    ownership: () => m.reliability_archRelationOwnership(),
  };

  async function load() {
    try {
      const res = await fetch('/api/reliability/architecture');
      if (!res.ok) throw new Error(String(res.status));
      snapshot = (await res.json()) as ArchitectureSnapshot;
      failed = false;
    } catch {
      failed = true;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void snapshot;
    void groupMode;
    void viewMode;
    void c4Level;
    void c4FocusRootId;
    if (!_ready) return;
    rebuild();
  });

  $effect(() => {
    void [theme.presetId, theme.accentId];
    const renderer = _renderer;
    if (!renderer) return;
    requestAnimationFrame(() => renderer.updatePresentation({ labelColors: themeLabelColors() }));
  });

  let adjacencyMap = new SvelteMap<string, SvelteSet<string>>();
  let metaById = new Map<string, SnapshotNode>();
  let c4MetaById = new Map<string, C4Node>();
  let c4AllById = new Map<string, C4Node>();

  function adjacency(id: string): SvelteSet<string> {
    return adjacencyMap.get(id) ?? new SvelteSet([id]);
  }

  const connectionsOf = $derived.by(() => {
    if (!selectedInfra || !snapshot) return [];
    const id = selectedInfra.id;
    return snapshot.edges
      .filter((e) => e.source === id || e.target === id)
      .map((e) => {
        const otherId = e.source === id ? e.target : e.source;
        return {
          outbound: e.source === id,
          other: metaById.get(otherId)?.name ?? otherId,
          via: e.via,
        };
      });
  });

  const c4ConnectionsOf = $derived.by(() => {
    if (!selectedC4 || !snapshot) return [];
    return snapshot.c4.relations
      .filter(
        (relation) => relation.source === selectedC4?.id || relation.target === selectedC4?.id,
      )
      .map((relation) => {
        const outbound = relation.source === selectedC4?.id;
        const otherId = outbound ? relation.target : relation.source;
        return {
          outbound,
          other: snapshot?.c4.nodes.find((node) => node.id === otherId)?.name ?? otherId,
          label: relation.label,
          technology: relation.technology,
          kind: relation.kind,
        };
      });
  });

  const c4Breadcrumbs = $derived.by(() => {
    if (!selectedC4 || !snapshot) return [];
    const byId = new Map(snapshot.c4.nodes.map((node) => [node.id, node]));
    const result: C4Node[] = [];
    let current: C4Node | undefined = selectedC4;
    while (current) {
      result.unshift(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return result;
  });

  function reindex(snap: ArchitectureSnapshot) {
    metaById = new Map(snap.nodes.map((n) => [n.id, n]));
    c4AllById = new Map(snap.c4.nodes.map((node) => [node.id, node]));
    adjacencyMap = new SvelteMap<string, SvelteSet<string>>();
    for (const n of snap.nodes) adjacencyMap.set(n.id, new SvelteSet([n.id]));
    for (const e of snap.edges) {
      adjacencyMap.get(e.source)?.add(e.target);
      adjacencyMap.get(e.target)?.add(e.source);
    }
  }

  function cancelHoverClear() {
    if (hoverClearTimer == null) return;
    clearTimeout(hoverClearTimer);
    hoverClearTimer = null;
  }

  function clearHoveredNode() {
    cancelHoverClear();
    hoverActionsOpen = false;
    hoveredNodeId = null;
    hoveredNodeLabel = '';
    hoveredNodeHasParent = false;
  }

  function scheduleHoverClear() {
    if (hoverActionsActive || hoverClearTimer != null) return;
    hoverClearTimer = setTimeout(() => {
      hoverClearTimer = null;
      if (!hoverActionsActive) clearHoveredNode();
    }, HOVER_EXIT_GRACE_MS);
  }

  function actionGeometry(nodeRadius: number) {
    const size = Math.min(
      MAX_ACTION_SIZE_PX,
      Math.max(MIN_ACTION_SIZE_PX, nodeRadius * ACTION_SIZE_TO_NODE_RATIO),
    );
    const orbit = Math.max(MIN_ACTION_ORBIT_PX, nodeRadius + size / 2 + ACTION_NODE_GAP_PX);
    return { diameter: orbit * 2, size };
  }

  function showHoveredNode(id: string, renderer: Renderer) {
    cancelHoverClear();
    const position = renderer.nodeScreenPosition(id);
    const radius = renderer.nodeScreenRadius(id);
    if (!position || radius == null) return;
    const geometry = actionGeometry(radius);
    hoverAnchor = { x: position[0], y: position[1] };
    hoverActionDiameter = geometry.diameter;
    hoverActionSize = geometry.size;
    if (hoveredNodeId === id) return;
    hoverActionsOpen = false;
    hoveredNodeId = id;
    const c4Node = viewMode === 'c4' ? c4MetaById.get(id) : null;
    hoveredNodeLabel = c4Node?.name ?? metaById.get(id)?.name ?? id;
    hoveredNodeHasParent = c4Node?.parentId != null;
    requestAnimationFrame(() => {
      if (hoveredNodeId === id) hoverActionsOpen = true;
    });
  }

  function syncHoverAnchor(renderer: Renderer) {
    if (!hoveredNodeId) return;
    const position = renderer.nodeScreenPosition(hoveredNodeId);
    const radius = renderer.nodeScreenRadius(hoveredNodeId);
    if (!position || radius == null) return;
    if (
      Math.abs(position[0] - hoverAnchor.x) > 0.5 ||
      Math.abs(position[1] - hoverAnchor.y) > 0.5
    ) {
      hoverAnchor = { x: position[0], y: position[1] };
    }
    const geometry = actionGeometry(radius);
    if (Math.abs(geometry.diameter - hoverActionDiameter) > 0.5) {
      hoverActionDiameter = geometry.diameter;
    }
    if (Math.abs(geometry.size - hoverActionSize) > 0.5) {
      hoverActionSize = geometry.size;
    }
  }

  function openHoveredDetails() {
    if (!hoveredNodeId) return;
    if (viewMode === 'c4') {
      selectedC4 = c4AllById.get(hoveredNodeId) ?? null;
      selectedInfra = null;
    } else {
      selectedInfra = metaById.get(hoveredNodeId) ?? null;
      selectedC4 = null;
    }
    clearHoveredNode();
  }

  function focusArchitectureNode(id: string, renderer: Renderer | null = _renderer) {
    if (!renderer) return;
    clearHoveredNode();
    if (viewMode === 'c4') {
      const node = c4AllById.get(id) ?? null;
      if (!node || !snapshot) return;
      selectedC4 = null;
      selectedInfra = null;
      c4Level = c4FocusLevel(node.level);
      const alreadyFocused = c4FocusRootId === node.id;
      c4FocusRootId = node.id;
      renderer.setFocus(null);
      if (alreadyFocused) {
        const position = renderer.nodePosition(node.id) ?? [0, 0];
        const fit = renderer.fitParamsAround(position, C4_FOCUS_FIT_SCALE);
        const targetZoom = Math.min(
          C4_FOCUS_MAX_ZOOM,
          Math.max(C4_FOCUS_MIN_ZOOM, fit?.zoom ?? 1.05),
        );
        renderer.animateTo(position, targetZoom);
      }
      return;
    }

    const node = metaById.get(id) ?? null;
    selectedInfra = null;
    selectedC4 = null;
    if (!node) return;
    renderer.setFocus(adjacency(node.id));
    const position = renderer.nodePosition(node.id);
    if (position) renderer.animateTo(position, 1.35);
  }

  function focusHoveredParent() {
    if (!hoveredNodeId || viewMode !== 'c4' || !snapshot) return;
    const parentId = c4ParentFocusTarget(snapshot.c4, hoveredNodeId);
    if (parentId) focusArchitectureNode(parentId);
  }

  function focusHoveredNode() {
    if (hoveredNodeId) focusArchitectureNode(hoveredNodeId);
  }

  function clearInfrastructureSelection() {
    selectedInfra = null;
    _renderer?.setFocus(null);
  }

  function resetC4Focus() {
    selectedC4 = null;
    c4FocusRootId = null;
    _renderer?.setFocus(null);
  }

  function changeView(value: string) {
    viewMode = value as ArchitectureView;
    selectedInfra = null;
    selectedC4 = null;
    c4FocusRootId = null;
    clearHoveredNode();
    _renderer?.setFocus(null);
  }

  let _lastMode: ArchGroupMode = 'topology';

  function rebuild() {
    if (!_renderer || !_sim || !snapshot) return;
    const isC4 = viewMode === 'c4';
    const projection = isC4
      ? buildC4ArchitectureGraph(snapshot, c4Level, c4FocusRootId)
      : buildArchitectureGraph(snapshot, groupMode, boxOffsets[groupMode]);
    const { nodes, edges } = projection;
    const groups = 'groups' in projection ? projection.groups : null;
    const sig =
      viewMode +
      groupMode +
      c4Level +
      (c4FocusRootId ?? '') +
      JSON.stringify(nodes) +
      JSON.stringify(edges);
    if (sig === _graphSig) return;
    _graphSig = sig;
    reindex(snapshot);
    c4MetaById = isC4
      ? (projection as ReturnType<typeof buildC4ArchitectureGraph>).metaById
      : new Map();
    _groups = groups ?? [];

    if (selectedInfra && !metaById.has(selectedInfra.id)) {
      selectedInfra = null;
      _renderer.setFocus(null);
    } else if (selectedInfra) {
      selectedInfra = metaById.get(selectedInfra.id) ?? null;
    }
    if (selectedC4 && !c4MetaById.has(selectedC4.id)) selectedC4 = null;

    _sim.stop();
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    _sim = createSimulation(nodes, edges, simOptions(reducedMotion, groups != null));
    _renderer.setGraph(_sim.nodes() as SimNode[], edges);
    _renderer.setGroups(groups);
    _renderer.updatePresentation({
      rings: isC4 ? (projection as ReturnType<typeof buildC4ArchitectureGraph>).rings : [],
    });
    _renderer.setFocus(null);
    if (isC4 && c4FocusRootId) {
      const fit = _renderer.fitParamsAround([0, 0], C4_FOCUS_FIT_SCALE);
      const targetZoom = Math.min(
        C4_FOCUS_MAX_ZOOM,
        Math.max(C4_FOCUS_MIN_ZOOM, fit?.zoom ?? 1.05),
      );
      _renderer.animateTo([0, 0], targetZoom);
    } else if (!isC4 && groupMode !== _lastMode) {
      _lastMode = groupMode;
      // Let the sim settle toward the new cluster anchors, then frame them.
      setTimeout(() => _renderer?.fitView(), 450);
    } else {
      setTimeout(() => _renderer?.fitView(), 150);
    }
  }

  onMount(() => {
    if (!canvasEl) return;

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let raf = 0;
    let disposed = false;
    const poll = setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);

    (async () => {
      await load();
      if (disposed || !snapshot || !canvasEl) return;

      const renderer = await createRenderer(
        canvasEl,
        {},
        {
          rings: [],
          labelColors: themeLabelColors(),
        },
      );
      if (disposed) {
        renderer.destroy();
        return;
      }
      _renderer = renderer;

      const isC4 = viewMode === 'c4';
      const projection = isC4
        ? buildC4ArchitectureGraph(snapshot, c4Level, c4FocusRootId)
        : buildArchitectureGraph(snapshot, groupMode, boxOffsets[groupMode]);
      const { nodes, edges } = projection;
      const groups = 'groups' in projection ? projection.groups : null;
      _graphSig =
        viewMode +
        groupMode +
        c4Level +
        (c4FocusRootId ?? '') +
        JSON.stringify(nodes) +
        JSON.stringify(edges);
      reindex(snapshot);
      c4MetaById = isC4
        ? (projection as ReturnType<typeof buildC4ArchitectureGraph>).metaById
        : new Map();
      _groups = groups ?? [];

      _sim = createSimulation(nodes, edges, simOptions(reducedMotion, groups != null));
      renderer.setGraph(_sim.nodes() as SimNode[], edges);
      renderer.setGroups(groups);
      renderer.updatePresentation({
        rings: isC4 ? (projection as ReturnType<typeof buildC4ArchitectureGraph>).rings : [],
      });
      renderer.fitView();

      _ready = true;

      const loop = () => {
        _sim?.tick();
        renderer.frame();
        syncHoverAnchor(renderer);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);

      wireGestures(renderer);
    })();

    function wireGestures(r: Renderer) {
      const el = canvasEl!;
      let mode: 'none' | 'pan' | 'node' | 'group' = 'none';
      let dragId: string | null = null;
      let dragGroupIdx: number | null = null;
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
        const gIdx = id ? null : r.groupAt(p.x, p.y);
        if (id) {
          mode = 'node';
          dragId = id;
        } else if (gIdx != null) {
          // Drag the whole scoped box — its member nodes move with it.
          mode = 'group';
          dragGroupIdx = gIdx;
        } else {
          mode = 'pan';
        }
        el.setPointerCapture(e.pointerId);
      });

      el.addEventListener('pointermove', (e) => {
        const p = local(e);
        if (mode === 'none') {
          const id = r.nodeAt(p.x, p.y);
          if (id) showHoveredNode(id, r);
          else scheduleHoverClear();
          if (!selectedInfra && !selectedC4) {
            r.setFocus(viewMode === 'infrastructure' && id ? adjacency(id) : null);
          }
          el.style.cursor = id ? 'pointer' : r.groupAt(p.x, p.y) != null ? 'grab' : 'default';
          return;
        }
        clearHoveredNode();
        if (Math.hypot(p.x - last.x, p.y - last.y) > DRAG_THRESHOLD) moved = true;
        if (mode === 'node' && dragId) {
          const [wx, wy] = r.screenToWorld(p.x, p.y);
          _sim?.drag(dragId, wx, wy);
        } else if (mode === 'group' && dragGroupIdx != null) {
          const g = _groups[dragGroupIdx];
          if (g) {
            const [wx, wy] = r.screenToWorld(p.x, p.y);
            const [lwx, lwy] = r.screenToWorld(last.x, last.y);
            const dx = wx - lwx;
            const dy = wy - lwy;
            _sim?.shiftAnchors(g.nodeIds, dx, dy);
            const off = (boxOffsets[groupMode][g.label] ??= { dx: 0, dy: 0 });
            off.dx += dx;
            off.dy += dy;
          }
        } else if (mode === 'pan') {
          r.panBy(p.x - last.x, p.y - last.y);
        }
        last = p;
      });

      const end = (e: PointerEvent) => {
        if (!moved && mode === 'node' && dragId) {
          clickNode(dragId, r);
        } else if (
          !moved &&
          (mode === 'pan' || mode === 'group') &&
          (selectedInfra || selectedC4)
        ) {
          selectedInfra = null;
          selectedC4 = null;
          r.setFocus(null);
        }
        if (mode === 'node' && dragId) _sim?.release(dragId);
        mode = 'none';
        dragId = null;
        dragGroupIdx = null;
        try {
          el.releasePointerCapture(e.pointerId);
        } catch {
          /* capture may already be gone */
        }
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('pointerleave', scheduleHoverClear);

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
      focusArchitectureNode(id, r);
    }

    const ro = new ResizeObserver(() => {
      _renderer?.resize();
      _renderer?.fitView();
    });
    ro.observe(canvasEl!);

    return () => {
      disposed = true;
      clearInterval(poll);
      clearHoveredNode();
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

<div class="relative w-full h-full arch-graph-stage rounded-lg overflow-hidden">
  <canvas bind:this={canvasEl} class="w-full h-full block touch-none"></canvas>

  {#if loading}
    <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
      <Spinner />
    </div>
  {:else if failed && !snapshot}
    <div
      class="absolute inset-0 flex items-center justify-center text-center px-8 pointer-events-none"
    >
      <div class="text-muted text-sm">{m.reliability_archLoadError()}</div>
    </div>
  {/if}

  <!-- Compact status strip; the full semantic key expands only on demand. -->
  {#if snapshot}
    <div class="arch-legend surface-2 absolute top-3 left-3 z-[var(--layer-sticky)] rounded-lg">
      <div class="arch-legend-strip flex items-center">
        {#each LEGEND as s (s)}
          <span class="arch-status-key flex items-center">
            <span class="arch-dot" style="background-color: {archStatusColor(s)}"></span>
            <span class="arch-status-label text-muted">{STATUS_LABEL[s]()}</span>
          </span>
        {/each}
        <span
          class="arch-checked t-telemetry text-muted border-l border-border"
          aria-label={`${m.reliability_archChecked()} ${new Date(snapshot.checkedAt).toLocaleTimeString()}`}
        >
          {new Date(snapshot.checkedAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
        <Tooltip label={m.reliability_archRefresh()} asChild openDelay={0}>
          {#snippet children(props)}
            <Button
              {...props}
              variant="ghost"
              size="xs"
              class="arch-icon-button"
              type="button"
              aria-label={m.reliability_archRefresh()}
              onclick={() => void load()}
            >
              <RefreshCw size={iconSizes.xs} aria-hidden="true" />
            </Button>
          {/snippet}
        </Tooltip>
        {#if viewMode === 'c4'}
          <Tooltip
            label={legendExpanded ? m.reliability_archLegendHide() : m.reliability_archLegendShow()}
            asChild
            openDelay={0}
          >
            {#snippet children(props)}
              <Button
                {...props}
                variant={legendExpanded ? 'secondary' : 'ghost'}
                size="xs"
                class="arch-icon-button"
                type="button"
                aria-expanded={legendExpanded}
                aria-label={legendExpanded
                  ? m.reliability_archLegendHide()
                  : m.reliability_archLegendShow()}
                onclick={() => (legendExpanded = !legendExpanded)}
              >
                <ListTree size={iconSizes.xs} aria-hidden="true" />
              </Button>
            {/snippet}
          </Tooltip>
        {/if}
      </div>

      {#if viewMode === 'c4' && legendExpanded}
        <div class="arch-legend-key surface-2 rounded-lg shadow-lg">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            {#each C4_LEVELS as level (level)}
              <span class="flex items-center gap-1.5">
                <span class="arch-level-swatch" style="border-color: {c4LevelColor(level)}"></span>
                <span class="text-muted capitalize">{level}</span>
              </span>
            {/each}
          </div>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            {#each C4_RELATION_KINDS as kind (kind)}
              {@const style = c4RelationStyle(kind)}
              <span class="flex items-center gap-1.5">
                <span
                  class:arch-edge-dashed={style.dashed}
                  class="arch-edge-swatch"
                  style="border-color: {style.color}"
                ></span>
                <span class="text-muted">{C4_RELATION_LABEL[kind]()}</span>
              </span>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <div class="absolute top-3 right-3 z-[var(--layer-sticky)]">
      <SegmentedControl
        items={viewItems}
        value={viewMode}
        size="sm"
        class="surface-2"
        aria-label={m.reliability_archViewLabel()}
        onValueChange={changeView}
      />
    </div>

    {#if hoveredNodeId}
      <div
        class:node-actions-three={hoveredNodeHasParent}
        class:node-actions-open={hoverActionsOpen}
        class="node-actions"
        style="left: {hoverAnchor.x}px; top: {hoverAnchor.y}px; width: {hoverActionDiameter}px; height: {hoverActionDiameter}px"
        role="group"
        aria-label={hoveredNodeLabel}
        onpointerenter={() => {
          hoverActionsActive = true;
          cancelHoverClear();
        }}
        onpointerleave={() => {
          hoverActionsActive = false;
          scheduleHoverClear();
        }}
      >
        <div
          class="node-action-shell"
          style="width: {hoverActionSize}px; height: {hoverActionSize}px"
        >
          <Tooltip label={m.reliability_archActionDetails()} asChild openDelay={0}>
            {#snippet children(props)}
              <Button
                {...props}
                variant="secondary"
                size="icon"
                class="node-action"
                type="button"
                aria-label={m.reliability_archActionDetails()}
                onclick={openHoveredDetails}
              >
                <Info size={hoverActionSize * ACTION_ICON_TO_BUBBLE_RATIO} aria-hidden="true" />
              </Button>
            {/snippet}
          </Tooltip>
        </div>
        <div
          class="node-action-shell"
          style="width: {hoverActionSize}px; height: {hoverActionSize}px"
        >
          <Tooltip label={m.reliability_archActionFocus()} asChild openDelay={0}>
            {#snippet children(props)}
              <Button
                {...props}
                variant="secondary"
                size="icon"
                class="node-action"
                type="button"
                aria-label={m.reliability_archActionFocus()}
                onclick={focusHoveredNode}
              >
                <LocateFixed
                  size={hoverActionSize * ACTION_ICON_TO_BUBBLE_RATIO}
                  aria-hidden="true"
                />
              </Button>
            {/snippet}
          </Tooltip>
        </div>
        {#if hoveredNodeHasParent}
          <div
            class="node-action-shell"
            style="width: {hoverActionSize}px; height: {hoverActionSize}px"
          >
            <Tooltip label={m.reliability_archActionParent()} asChild openDelay={0}>
              {#snippet children(props)}
                <Button
                  {...props}
                  variant="secondary"
                  size="icon"
                  class="node-action"
                  type="button"
                  aria-label={m.reliability_archActionParent()}
                  onclick={focusHoveredParent}
                >
                  <CornerUpLeft
                    size={hoverActionSize * ACTION_ICON_TO_BUBBLE_RATIO}
                    aria-hidden="true"
                  />
                </Button>
              {/snippet}
            </Tooltip>
          </div>
        {/if}
      </div>
    {/if}

    <!-- C4 depth is cumulative. Infrastructure retains its physical grouping lenses. -->
    <div
      class="arch-bottom-controls absolute bottom-3 left-1/2 z-[var(--layer-sticky)] flex items-center gap-2"
    >
      {#if viewMode === 'c4'}
        {#if c4FocusRootId}
          <Button variant="outline" size="sm" type="button" onclick={resetC4Focus}>
            {m.reliability_archBackToLandscape()}
          </Button>
        {/if}
        <SegmentedControl
          items={c4LevelItems}
          value={c4Level}
          size="sm"
          class="surface-2"
          aria-label={m.reliability_archLevelLabel()}
          onValueChange={(value) => (c4Level = value as C4Level)}
        />
      {:else}
        <SegmentedControl
          items={modeItems}
          value={groupMode}
          size="sm"
          class="surface-2"
          aria-label={m.reliability_archModeLabel()}
          onValueChange={(v) => (groupMode = v as ArchGroupMode)}
        />
      {/if}
    </div>
  {/if}

  <!-- Live infrastructure detail card -->
  {#if selectedInfra}
    <div
      class="arch-detail surface-2 absolute bottom-3 right-3 z-[var(--layer-sticky)] w-80 max-h-3/4 overflow-y-auto rounded-lg shadow-lg"
    >
      <div
        class="arch-detail-header surface-2 flex items-center justify-between border-b border-border sticky top-0"
      >
        <div class="flex items-center gap-2 min-w-0">
          <span
            class="arch-dot shrink-0"
            style="background-color: {archStatusColor(selectedInfra.status)}"
          ></span>
          <span class="text-foreground font-medium truncate">{selectedInfra.name}</span>
        </div>
        <Button
          variant="ghost"
          type="button"
          class="shrink-0"
          aria-label={m.reliability_archCloseDetails()}
          onclick={clearInfrastructureSelection}>&times;</Button
        >
      </div>
      <div class="arch-detail-body flex flex-col gap-2">
        <div class="flex items-center gap-1.5 flex-wrap">
          <span
            class="arch-chip t-telemetry font-medium capitalize"
            style="background-color: color-mix(in srgb, {archStatusColor(
              selectedInfra.status,
            )} 18%, transparent); color: {archStatusColor(selectedInfra.status)}"
            >{STATUS_LABEL[selectedInfra.status]()}</span
          >
          <span class="arch-chip t-telemetry bg-bg3 text-muted capitalize"
            >{selectedInfra.kind}</span
          >
          {#if selectedInfra.latencyMs != null}
            <span class="arch-chip t-telemetry bg-bg3 text-muted">{selectedInfra.latencyMs}ms</span>
          {/if}
        </div>
        <p class="text-muted">{selectedInfra.description}</p>
        <p class="text-muted">{selectedInfra.statusDetail}</p>

        {#if selectedInfra.metrics && Object.keys(selectedInfra.metrics).length > 0}
          <div class="flex flex-col gap-0.5">
            {#each Object.entries(selectedInfra.metrics) as [k, v] (k)}
              <div class="flex justify-between gap-2">
                <span class="text-muted capitalize">{k}</span>
                <span class="text-foreground t-mono truncate">{v}</span>
              </div>
            {/each}
          </div>
        {/if}

        <div>
          <div class="text-muted uppercase t-telemetry mb-1">
            {m.reliability_archEndpoints()}
          </div>
          <div class="flex flex-col gap-0.5">
            {#each selectedInfra.endpoints as ep (ep)}
              <span class="t-mono text-muted">{ep}</span>
            {/each}
          </div>
        </div>

        <div>
          <div class="text-muted uppercase t-telemetry mb-1">
            {m.reliability_archConnections()}
          </div>
          <div class="flex flex-col gap-1">
            {#each connectionsOf as c (c.other + c.via)}
              <div class="flex flex-col">
                <span class="text-foreground">{c.outbound ? '→' : '←'} {c.other}</span>
                <span class="t-mono text-muted/80 pl-4">{c.via}</span>
              </div>
            {/each}
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- C4 source/evidence detail card -->
  {#if selectedC4}
    <div
      class="arch-detail surface-2 absolute bottom-3 right-3 z-[var(--layer-sticky)] w-80 max-h-3/4 overflow-y-auto rounded-lg shadow-lg"
    >
      <div
        class="arch-detail-header surface-2 flex items-center justify-between border-b border-border sticky top-0"
      >
        <div class="flex items-center gap-2 min-w-0">
          <span
            class="arch-level-swatch shrink-0"
            style="border-color: {c4LevelColor(selectedC4.level)}"
          ></span>
          <span class="text-foreground font-medium truncate">{selectedC4.name}</span>
        </div>
        <Button
          variant="ghost"
          type="button"
          class="shrink-0"
          aria-label={m.reliability_archCloseDetails()}
          onclick={() => (selectedC4 = null)}>&times;</Button
        >
      </div>
      <div class="arch-detail-body flex flex-col gap-3">
        <div class="flex items-center gap-1.5 flex-wrap">
          <span
            class="arch-chip t-telemetry font-medium uppercase"
            style="color: {c4LevelColor(selectedC4.level)}"
          >
            {selectedC4.level}
          </span>
          <span class="arch-chip t-telemetry bg-bg3 text-muted">{selectedC4.technology}</span>
          <span class="arch-chip t-telemetry bg-bg3 text-muted">{selectedC4.reconStatus}</span>
        </div>

        <p class="text-muted">{selectedC4.description}</p>

        <div class="c4-breadcrumbs t-telemetry text-muted">
          {#each c4Breadcrumbs as crumb, index (crumb.id)}
            {#if index > 0}<span aria-hidden="true"> / </span>{/if}
            <span>{crumb.name}</span>
          {/each}
        </div>

        <div>
          <div class="text-muted uppercase t-telemetry mb-1">
            {m.reliability_archConcreteArtefacts()}
          </div>
          <div class="flex flex-col gap-1">
            {#each selectedC4.artefacts as artefact (artefact)}
              <code class="c4-code-row t-mono">{artefact}</code>
            {/each}
          </div>
        </div>

        <div>
          <div class="text-muted uppercase t-telemetry mb-1">
            {m.reliability_archSourceEvidence()}
          </div>
          <div class="flex flex-col gap-1">
            {#each selectedC4.sourceRefs as source (source)}
              <code class="c4-code-row t-mono">{source}</code>
            {/each}
          </div>
        </div>

        {#if c4ConnectionsOf.length > 0}
          <div>
            <div class="text-muted uppercase t-telemetry mb-1">
              {m.reliability_archConnections()}
            </div>
            <div class="flex flex-col gap-2">
              {#each c4ConnectionsOf as connection (connection.other + connection.label)}
                <div class="flex flex-col">
                  <span class="text-foreground">
                    {connection.outbound ? '→' : '←'}
                    {connection.other} · {connection.label}
                  </span>
                  <span class="t-mono text-muted">{connection.technology}</span>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .arch-graph-stage {
    background:
      radial-gradient(
        ellipse 70% 60% at 50% 45%,
        color-mix(in srgb, var(--color-accent) 5%, transparent),
        transparent 70%
      ),
      radial-gradient(
        ellipse 100% 100% at 50% 50%,
        transparent 60%,
        color-mix(in srgb, var(--color-canvas) 35%, transparent)
      );
  }

  .arch-legend {
    padding: var(--space-1);
  }

  .arch-legend-strip {
    gap: var(--space-2);
    min-height: var(--control-height-xs);
    white-space: nowrap;
  }

  .arch-status-key {
    gap: var(--space-1);
  }

  .arch-checked {
    padding-left: var(--space-2);
  }

  .arch-legend :global(.arch-icon-button) {
    width: var(--control-height-xs);
    min-width: var(--control-height-xs);
    height: var(--control-height-xs);
    padding: var(--space-0);
  }

  .arch-legend-key {
    position: absolute;
    top: calc(100% + var(--space-1));
    left: var(--space-0);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: min(26rem, 70vw);
    padding: var(--space-2);
  }

  .arch-dot {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
  }

  .arch-level-swatch {
    width: var(--space-3);
    height: var(--space-3);
    border: var(--space-0-5) solid;
    border-radius: var(--radius-full);
    background: var(--color-surface-3);
  }

  .arch-edge-swatch {
    width: var(--space-6);
    border-top: var(--space-0-5) solid;
  }

  .arch-edge-dashed {
    border-top-style: dashed;
  }

  .node-actions {
    position: absolute;
    z-index: var(--layer-dropdown);
    pointer-events: none;
    transform: translate(-50%, -50%);
  }

  .node-action-shell {
    position: absolute;
    top: 50%;
    left: 50%;
    opacity: 0;
    pointer-events: none;
    transform: translate(-50%, -50%) scale(0.25);
    transition:
      top var(--duration-fast) var(--ease-spring),
      left var(--duration-fast) var(--ease-spring),
      transform var(--duration-fast) var(--ease-spring),
      opacity var(--duration-instant) var(--ease-enter);
    will-change: transform, opacity;
  }

  .node-actions-open .node-action-shell {
    opacity: 1;
    pointer-events: auto;
  }

  .node-actions-open:not(.node-actions-three) .node-action-shell:nth-child(1) {
    top: 15%;
    left: 15%;
    transform: translate(-50%, -50%) scale(1);
  }

  .node-actions-open:not(.node-actions-three) .node-action-shell:nth-child(2) {
    top: 15%;
    left: 85%;
    transform: translate(-50%, -50%) scale(1);
    transition-delay: var(--duration-instant);
  }

  .node-actions-open.node-actions-three .node-action-shell:nth-child(1) {
    top: 25%;
    left: 7%;
    transform: translate(-50%, -50%) scale(1);
  }

  .node-actions-open.node-actions-three .node-action-shell:nth-child(2) {
    top: 0%;
    left: 50%;
    transform: translate(-50%, -50%) scale(1);
    transition-delay: var(--duration-instant);
  }

  .node-actions-open.node-actions-three .node-action-shell:nth-child(3) {
    top: 25%;
    left: 93%;
    transform: translate(-50%, -50%) scale(1);
    transition-delay: var(--duration-fast);
  }

  .node-action-shell :global(.node-action) {
    width: 100%;
    min-width: 100%;
    height: 100%;
    padding: var(--space-0);
    border: var(--hairline) solid var(--color-border-strong);
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-sm);
  }

  .arch-bottom-controls {
    transform: translateX(-50%);
  }

  .arch-detail-header,
  .arch-detail-body {
    padding: var(--space-2) var(--space-3);
  }

  .arch-chip {
    padding: var(--space-0-5) var(--space-1);
    border-radius: var(--radius-xs);
  }

  .c4-breadcrumbs,
  .c4-code-row {
    overflow-wrap: anywhere;
  }

  .c4-code-row {
    padding: var(--space-1) var(--space-2);
    border: var(--hairline) solid var(--color-border);
    border-radius: var(--radius-xs);
    background: var(--color-surface-3);
    color: var(--color-text-secondary);
  }
</style>
