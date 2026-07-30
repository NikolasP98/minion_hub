<!--
  CrmGraph — org + up to 60 recently-active contacts, edges colored by the
  contact's relationship category (spec v2 WP1: "real relationships", no more
  channel nodes).

  Same physics/rendering stack as the Organization overview graph
  (`$lib/components/overview/graph/{simulation,renderer}.ts`, reused as-is)
  with a shallower ring set (org → contact) passed to the renderer as a
  presentation config. `buildCrmGraph` is the CRM-specific transform.
-->
<script lang="ts">
  import { Button, Input, Select, type SelectOption } from '$lib/components/ui';
  import { onMount } from 'svelte';
  import { invalidate } from '$app/navigation';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import * as m from '$lib/paraglide/messages';
  import { theme } from '$lib/state/ui/theme.svelte';
  import { buildCrmGraph, relationshipCategoryColor, CRM_RADII } from './build-crm-graph';
  import { RELATIONSHIP_CATEGORIES, type RelationshipCategory } from '$lib/components/crm/crm-relationship';
  import { relationshipCategoryLabel } from '$lib/components/crm/crm-i18n';
  import type { GraphNode } from '$lib/components/overview/graph/build-graph';
  import { createSimulation, type Simulation, type SimNode } from '$lib/components/overview/graph/simulation';
  import { createRenderer, themeLabelColors, type Renderer } from '$lib/components/overview/graph/renderer';
  import type { ContactGraphRow } from '$server/services/crm-contacts.service';

  interface Props {
    org: { id: string; name: string };
    rows: ContactGraphRow[];
  }
  let { org, rows }: Props = $props();

  let canvasEl: HTMLCanvasElement | undefined = $state();
  let selected = $state<GraphNode | null>(null);
  let nodeCount = $state(0);
  let activeLegendCategory = $state<RelationshipCategory | null>(null);

  let _renderer: Renderer | null = null;
  let _sim: Simulation | null = null;
  let _ready = false;
  let _graphSig = '';

  $effect(() => {
    void [org, rows];
    if (!_ready) return;
    rebuild();
  });

  // Re-resolve label colors from the active theme's CSS tokens whenever the
  // theme changes (see OverviewGraph.svelte — same shared renderer/bug).
  $effect(() => {
    void [theme.presetId, theme.accentId];
    const renderer = _renderer;
    if (!renderer) return;
    requestAnimationFrame(() => renderer.updatePresentation({ labelColors: themeLabelColors() }));
  });

  const categoryOf = (row: ContactGraphRow): RelationshipCategory => row.relationship?.category ?? 'unknown';

  // ── Selected-contact relationship editor ─────────────────────────────────
  const selectedContactId = $derived(
    selected?.kind === 'contact' ? selected.id.slice('contact:'.length) : null,
  );
  const selectedRow = $derived(
    selectedContactId ? (rows.find((r) => r.contactId === selectedContactId) ?? null) : null,
  );
  const selectedRelationship = $derived(selectedRow?.relationship ?? null);

  let editLabel = $state('');
  let editCategory = $state<string>('unknown');
  let saving = $state(false);

  // Seed the editor from the newly-selected contact's stored relationship
  // (and re-seed after a save/resume round-trip refreshes `rows`).
  $effect(() => {
    editLabel = selectedRelationship?.label ?? '';
    editCategory = selectedRelationship?.category ?? 'unknown';
  });

  const categoryOptions: SelectOption[] = RELATIONSHIP_CATEGORIES.map((c) => ({
    value: c,
    label: relationshipCategoryLabel(c),
  }));

  async function saveRelationship() {
    if (!selectedContactId || saving) return;
    saving = true;
    try {
      const res = await fetch(`/api/crm/contacts/${selectedContactId}/relationship`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: editLabel.trim() || null, category: editCategory }),
      });
      if (res.ok) await invalidate('crm:graph');
    } finally {
      saving = false;
    }
  }

  async function resumeAiSuggestions() {
    if (!selectedContactId || saving) return;
    saving = true;
    try {
      const res = await fetch(`/api/crm/contacts/${selectedContactId}/relationship`, { method: 'DELETE' });
      if (res.ok) await invalidate('crm:graph');
    } finally {
      saving = false;
    }
  }

  let adjacencyMap = new SvelteMap<string, SvelteSet<string>>();
  let metaById = new Map<string, GraphNode>();

  function adjacency(id: string): SvelteSet<string> {
    return adjacencyMap.get(id) ?? new SvelteSet([id]);
  }

  function focusSetFor(node: GraphNode | null): SvelteSet<string> | null {
    if (!node) return null;
    return adjacency(node.id);
  }

  /** org + every contact currently in `category` — backs the legend filter. */
  function categoryFocusSet(category: RelationshipCategory): SvelteSet<string> | null {
    const ids = rows.filter((r) => categoryOf(r) === category).map((r) => `contact:${r.contactId}`);
    return ids.length > 0 ? new SvelteSet([org.id, ...ids]) : null;
  }

  function toggleLegendCategory(category: RelationshipCategory) {
    if (!_renderer) return;
    if (activeLegendCategory === category) {
      activeLegendCategory = null;
      selected = null;
      _renderer.setFocus(null);
    } else {
      activeLegendCategory = category;
      selected = null;
      _renderer.setFocus(categoryFocusSet(category));
    }
  }

  function reindex(nodes: GraphNode[], edges: { source: string; target: string }[]) {
    metaById = new Map(nodes.map((nd) => [nd.id, nd]));
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
  }

  function rebuild() {
    if (!_renderer || !_sim) return;
    const { nodes, edges } = buildCrmGraph({ org, rows });
    const sig = JSON.stringify(nodes) + JSON.stringify(edges);
    if (sig === _graphSig) return;
    _graphSig = sig;
    nodeCount = nodes.length;
    reindex(nodes, edges);

    if (selected && !metaById.has(selected.id)) {
      selected = null;
      _renderer.setFocus(null);
    }

    // Reapply an active legend filter against the refreshed row set (rows may
    // have changed category after a save — see OverviewGraph.svelte for the
    // same reapply-on-rebuild pattern).
    if (activeLegendCategory) {
      _renderer.setFocus(categoryFocusSet(activeLegendCategory));
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
      const renderer = await createRenderer(canvasEl!, {}, {
        rings: [CRM_RADII.contact],
        labelColors: themeLabelColors(),
      });
      if (disposed) {
        renderer.destroy();
        return;
      }
      _renderer = renderer;

      const { nodes, edges } = buildCrmGraph({ org, rows });
      _graphSig = JSON.stringify(nodes) + JSON.stringify(edges);
      nodeCount = nodes.length;
      reindex(nodes, edges);

      _sim = createSimulation(nodes, edges, { reducedMotion });
      renderer.setGraph(_sim.nodes() as SimNode[], edges);
      renderer.fitView();

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
          if (!selected && !activeLegendCategory) r.setFocus(id ? adjacency(id) : null);
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
        } else if (!moved && mode === 'pan' && (selected || activeLegendCategory)) {
          selected = null;
          activeLegendCategory = null;
          r.setFocus(null);
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
      const node = metaById.get(id) ?? null;
      selected = node;
      activeLegendCategory = null;
      if (!node) return;
      r.setFocus(focusSetFor(node));
      if (node.kind === 'org') {
        const p = r.fitParams();
        if (p) r.animateTo(p.center, p.zoom);
      } else {
        // Center on the LIVE simulated position, not the static build-time
        // anchor (node.ax/ay) — wander/collision drift it from where it
        // actually renders (see OverviewGraph.svelte for the same fix).
        const pos = r.nodePosition(id);
        if (pos) r.animateTo(pos, 1.55);
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
</script>

<div class="relative w-full h-full crm-graph-stage">
  <canvas bind:this={canvasEl} class="w-full h-full block touch-none"></canvas>

  {#if nodeCount <= 1}
    <div class="absolute inset-0 flex items-center justify-center text-center px-8 pointer-events-none">
      <div class="text-muted text-sm">{m.crm_graph_empty()}</div>
    </div>
  {/if}

  <!-- Category legend (clickable filter) -->
  {#if nodeCount > 1}
    <div
      class="absolute bottom-3 left-3 z-[var(--layer-sticky)] flex flex-col gap-0.5 text-[length:var(--font-size-telemetry)] text-muted bg-bg2/80 backdrop-blur-sm border border-border rounded-lg px-2 py-1.5"
    >
      {#each RELATIONSHIP_CATEGORIES as category (category)}
        {@const count = rows.filter((r) => categoryOf(r) === category).length}
        {@const active = activeLegendCategory === category}
        {#if count > 0}
          <Button
            variant="ghost"
            type="button"
            class="flex items-center gap-1.5 px-1 py-0.5 rounded transition-colors cursor-pointer text-left w-full {active
              ? 'bg-accent/20 text-accent'
              : 'hover:text-foreground'}"
            onclick={() => toggleLegendCategory(category)}
            aria-pressed={active}
          >
            <span
              class="w-2 h-2 rounded-full shrink-0"
              style="background-color: {relationshipCategoryColor(category)}"
            ></span>
            <span>{relationshipCategoryLabel(category)}</span>
            <span class="ml-auto opacity-60 tabular-nums">{count}</span>
          </Button>
        {/if}
      {/each}
    </div>
  {/if}

  {#if selected}
    <div
      class="absolute bottom-3 right-3 z-[var(--layer-sticky)] w-[280px] bg-bg2/95 backdrop-blur-sm border border-border rounded-lg shadow-lg text-[length:var(--font-size-caption)] overflow-hidden"
    >
      <div class="flex items-center justify-between px-3 py-2 border-b border-border">
        <div class="flex items-center gap-2 min-w-0">
          <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: {selected.color}"
          ></span>
          <span class="text-foreground font-medium truncate">{selected.label}</span>
        </div>
        <Button
          variant="ghost"
          type="button"
          class="text-muted hover:text-foreground cursor-pointer shrink-0 ml-2"
          onclick={() => (selected = null)}>&times;</Button
        >
      </div>
      <div class="px-3 py-2 flex flex-col gap-2">
        <span
          class="w-fit px-1.5 py-0.5 rounded bg-bg1 border border-border text-[length:var(--font-size-telemetry)] font-medium text-foreground capitalize"
          >{selected.kind}</span
        >

        {#if selected.kind === 'contact'}
          {#if selectedRelationship}
            <div class="flex items-center gap-1.5 flex-wrap">
              <span
                class="w-2 h-2 rounded-full shrink-0"
                style="background-color: {relationshipCategoryColor(selectedRelationship.category)}"
              ></span>
              <span class="text-foreground font-medium">{relationshipCategoryLabel(selectedRelationship.category)}</span>
              {#if selectedRelationship.label}
                <span class="text-muted">"{selectedRelationship.label}"</span>
              {/if}
              {#if selectedRelationship.source === 'user'}
                <span
                  class="px-1 py-0 rounded bg-bg1 border border-border text-[length:var(--font-size-telemetry)] font-semibold uppercase tracking-wide text-muted"
                  >{m.crm_relationship_pinned()}</span
                >
              {/if}
            </div>
          {:else}
            <p class="text-muted">{m.crm_relationship_none()}</p>
          {/if}

          <Input
            bind:value={editLabel}
            size="sm"
            placeholder={m.crm_relationship_label_placeholder()}
            disabled={saving}
          />
          <Select bind:value={editCategory} size="sm" options={categoryOptions} disabled={saving} />
          <div class="flex items-center gap-2">
            <Button variant="primary" size="sm" type="button" onclick={saveRelationship} disabled={saving}>
              {m.crm_relationship_save()}
            </Button>
            {#if selectedRelationship?.source === 'user'}
              <Button variant="ghost" size="sm" type="button" onclick={resumeAiSuggestions} disabled={saving}>
                {m.crm_relationship_resume_ai()}
              </Button>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .crm-graph-stage {
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
</style>
