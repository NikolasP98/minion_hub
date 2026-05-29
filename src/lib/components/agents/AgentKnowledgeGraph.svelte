<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { fetchKGSnapshot } from '$lib/services/gateway.svelte';
  import * as echarts from 'echarts';
  import * as m from '$lib/paraglide/messages';
  import JsonView from '$lib/components/workforce/JsonView.svelte';

  let { agentId }: { agentId: string } = $props();

  type ObjectType =
    | 'entity' | 'fact' | 'event' | 'preference'
    | 'task' | 'belief' | 'interaction' | 'skill';

  type MemoryObject = {
    id: string;
    type: ObjectType;
    label: string;
    data: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
    ttl: number | null;
  };

  type MemoryRelationship = {
    fromId: string;
    toId: string;
    relType: string;
    weight: number;
    createdAt: number;
  };

  const OBJECT_TYPES: ObjectType[] = [
    'entity', 'fact', 'event', 'preference',
    'task', 'belief', 'interaction', 'skill',
  ];

  const TYPE_COLORS: Record<ObjectType, string> = {
    entity:      '#3b82f6',
    fact:        '#22c55e',
    event:       '#a855f7',
    preference:  '#ec4899',
    task:        '#f59e0b',
    belief:      '#06b6d4',
    interaction: '#ef4444',
    skill:       '#10b981',
  };

  // ── Data state ─────────────────────────────────────────────────────────────
  let nodes = $state<MemoryObject[]>([]);
  let edges = $state<MemoryRelationship[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  // ── Config state ───────────────────────────────────────────────────────────
  let layout = $state<'force' | 'circular'>('force');
  let showNodeLabels = $state(false);
  let showEdgeLabels = $state(false);
  let activeTypes = new SvelteSet<ObjectType>(OBJECT_TYPES);
  let selectedNode = $state<MemoryObject | null>(null);
  let jsonExpanded = $state(false);

  // ── Zoom-to-fit state ──────────────────────────────────────────────────────
  let fitPending = $state(false);
  let fitTimer: ReturnType<typeof setTimeout> | null = null;
  // Non-reactive: tracks whether initial fit has occurred (doesn't trigger effects)
  let hasBeenFitted = false;

  // ── Chart refs ─────────────────────────────────────────────────────────────
  let canvasEl: HTMLDivElement | undefined = $state();
  let chart: echarts.ECharts | null = null;

  // ── Derived ────────────────────────────────────────────────────────────────
  const filteredNodes = $derived(nodes.filter((n) => activeTypes.has(n.type)));
  const filteredNodeIds = $derived(new Set(filteredNodes.map((n) => n.id)));
  const filteredEdges = $derived(
    edges.filter((e) => filteredNodeIds.has(e.fromId) && filteredNodeIds.has(e.toId)),
  );

  const typeCounts = $derived.by(() => {
    const m: Partial<Record<ObjectType, number>> = {};
    for (const n of nodes) m[n.type] = (m[n.type] ?? 0) + 1;
    return m;
  });

  // ── Fetch ──────────────────────────────────────────────────────────────────
  async function refresh() {
    if (loading) return;
    loading = true;
    error = null;
    selectedNode = null;
    try {
      const res = (await fetchKGSnapshot(agentId)) as {
        nodes?: MemoryObject[];
        edges?: MemoryRelationship[];
      } | null;
      nodes = res?.nodes ?? [];
      edges = res?.edges ?? [];
      hasBeenFitted = false;
      fitPending = true;
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  // ── Zoom to fit ────────────────────────────────────────────────────────────
  function zoomToFit() {
    if (!chart) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (chart as any).getModel();
    const series = model?.getSeriesByIndex(0);
    if (!series) return;
    const data = series.getData();
    const count = data.count();
    if (count === 0) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      const itemLayout = data.getItemLayout(i);
      if (!itemLayout) continue;
      const x = itemLayout[0] ?? itemLayout.x;
      const y = itemLayout[1] ?? itemLayout.y;
      if (x == null || y == null) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    if (!isFinite(minX)) return;

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const bboxW = maxX - minX || 1;
    const bboxH = maxY - minY || 1;
    const chartW = chart.getWidth();
    const chartH = chart.getHeight();
    const padding = 0.7;
    const zoom = Math.min(
      (chartW * padding) / bboxW,
      (chartH * padding) / bboxH,
      2.0,
    );

    chart.setOption({
      series: [{ center: [cx, cy], zoom: Math.max(zoom, 0.1) }],
    });
    hasBeenFitted = true;
  }

  // ── Viewport save/restore ──────────────────────────────────────────────────
  function saveViewport(): { center?: unknown; zoom?: number } | null {
    if (!chart) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opt = (chart as any).getOption?.();
    const s = opt?.series?.[0];
    if (!s || s.zoom == null) return null;
    return { center: s.center, zoom: s.zoom };
  }

  function restoreViewport(vp: { center?: unknown; zoom?: number } | null) {
    if (!chart || !vp || vp.zoom == null) return;
    chart.setOption({ series: [{ center: vp.center, zoom: vp.zoom }] });
  }

  // ── ECharts option builder ─────────────────────────────────────────────────
  function buildOption() {
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        enterable: false,
        formatter: (p: { dataType?: string; data?: { value?: MemoryObject }; name?: string }) => {
          if (p.dataType !== 'node' || !p.data?.value) return '';
          const n = p.data.value;
          return `<b>${n.label}</b><br/><span style="color:#a1a1aa">${n.type}</span>`;
        },
      },
      series: [
        {
          type: 'graph',
          layout,
          roam: true,
          draggable: layout === 'force',
          scaleLimit: { min: 0.1, max: 5 },
          // Start zoomed out on first render; zoomToFit will adjust after stabilization
          ...(hasBeenFitted ? {} : { zoom: 0.3, center: ['50%', '50%'] }),
          label: {
            show: showNodeLabels,
            color: '#fafafa',
            fontSize: 10,
            formatter: (params: { name?: string }) => {
              const name = params.name ?? '';
              return name.length > 20 ? name.slice(0, 18) + '\u2026' : name;
            },
          },
          labelLayout: { hideOverlap: true },
          edgeLabel: {
            show: showEdgeLabels,
            formatter: '{c}',
            color: '#a1a1aa',
            fontSize: 9,
          },
          force: { repulsion: 250, edgeLength: [80, 160], gravity: 0.1 },
          categories: OBJECT_TYPES.map((t) => ({
            name: t,
            itemStyle: { color: TYPE_COLORS[t] },
          })),
          data: filteredNodes.map((n) => ({
            id: n.id,
            name: n.label,
            category: OBJECT_TYPES.indexOf(n.type),
            symbolSize: 18,
            value: n,
          })),
          edges: filteredEdges.map((e) => ({
            source: e.fromId,
            target: e.toId,
            label: { show: showEdgeLabels, formatter: e.relType },
            value: e.relType,
            lineStyle: {
              width: Math.max(1, e.weight),
              curveness: 0.2,
              color: '#52525b',
            },
          })),
          lineStyle: { curveness: 0.2, color: '#52525b' },
          emphasis: {
            focus: 'adjacency',
            lineStyle: { width: 4 },
            label: {
              show: true,
              color: '#fafafa',
              fontSize: 11,
              fontWeight: 'bold',
              backgroundColor: 'rgba(9, 9, 11, 0.85)',
              borderColor: '#3b82f6',
              borderWidth: 1,
              borderRadius: 3,
              padding: [2, 6],
            },
            itemStyle: {
              shadowBlur: 10,
              shadowColor: 'rgba(59, 130, 246, 0.5)',
            },
          },
        },
      ],
    };
  }

  // ── Mount / destroy ────────────────────────────────────────────────────────
  onMount(() => {
    if (canvasEl) {
      chart = echarts.init(canvasEl, 'dark');
      chart.on('click', (params: echarts.ECElementEvent) => {
        if (params.dataType === 'node') {
          const d = params.data as { value?: MemoryObject } | null | undefined;
          if (d?.value) selectedNode = d.value;
        }
      });
      chart.on('finished', () => {
        if (!fitPending) return;
        if (fitTimer) clearTimeout(fitTimer);
        fitTimer = setTimeout(() => {
          fitPending = false;
          zoomToFit();
        }, 800);
      });
      const ro = new ResizeObserver(() => chart?.resize());
      ro.observe(canvasEl);
      return () => {
        if (fitTimer) clearTimeout(fitTimer);
        ro.disconnect();
        chart?.dispose();
        chart = null;
      };
    }
  });

  // ── Re-fetch when agentId changes ─────────────────────────────────────────
  $effect(() => {
    agentId;
    untrack(() => refresh());
  });

  // ── Reactive chart update ──────────────────────────────────────────────────
  $effect(() => {
    if (!chart) return;
    const _dep = [filteredNodes, filteredEdges, layout, showNodeLabels, showEdgeLabels];
    void _dep;

    // Save viewport before rebuild so config changes don't reset zoom/pan
    const savedVp = saveViewport();
    chart.setOption(buildOption(), { notMerge: true });

    // Restore viewport unless a zoom-to-fit is pending
    if (!fitPending && savedVp) {
      restoreViewport(savedVp);
    }
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  function toggleType(type: ObjectType) {
    if (activeTypes.has(type)) activeTypes.delete(type);
    else activeTypes.add(type);
  }

  function formatDate(ms: number) {
    return new Date(ms).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }
</script>

<!-- Toolbar -->
<div class="shrink-0 flex items-center gap-3 px-3 py-2 border-b border-border bg-bg2 text-[11px]">
  <button
    type="button"
    class="px-2 py-1 rounded bg-bg1 border border-border hover:border-accent text-foreground cursor-pointer transition-colors"
    disabled={loading}
    onclick={refresh}
  >
    {loading ? m.common_loading() : m.kg_refresh()}
  </button>

  <button
    type="button"
    class="px-2 py-1 rounded bg-bg1 border border-border hover:border-accent text-foreground cursor-pointer transition-colors"
    onclick={zoomToFit}
    title={m.kg_fitTitle()}
  >
    {m.kg_fit()}
  </button>

  {#if !loading && !error}
    <span class="text-muted">
      {m.kg_nodeEdgeCount({ nodes: nodes.length, edges: edges.length })}
    </span>
  {/if}

  {#if error}
    <span class="text-destructive">{error}</span>
  {/if}
</div>

<!-- Body -->
<div class="flex-1 min-h-0 flex overflow-hidden">
  <div class="flex-1 min-w-0 relative">
    {#if loading}
      <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div class="w-4 h-4 border-2 border-border border-t-accent rounded-full animate-spin"></div>
      </div>
    {:else if nodes.length === 0 && !error}
      <div class="absolute inset-0 flex items-center justify-center text-center px-8 pointer-events-none">
        <div>
          <div class="text-muted text-sm">{m.kg_noMemoryObjects()}</div>
          <div class="text-muted-strong text-xs mt-1">{m.kg_noMemoryObjectsHint()}</div>
        </div>
      </div>
    {/if}
    <div bind:this={canvasEl} class="w-full h-full"></div>

    <!-- Floating controls panel (bottom-left) -->
    {#if nodes.length > 0}
      <div class="absolute bottom-3 left-3 z-10 pointer-events-none">
        <div class="pointer-events-auto bg-bg2/90 backdrop-blur-sm border border-border rounded-lg shadow-lg
                    text-[11px] p-2 flex flex-col gap-2 min-w-[180px]">
          <!-- Layout + toggle row -->
          <div class="flex items-center gap-1.5">
            <div class="flex rounded overflow-hidden border border-border flex-1">
              <button
                type="button"
                class="flex-1 py-1 text-center cursor-pointer transition-colors text-[10px]
                  {layout === 'force' ? 'bg-accent text-white' : 'text-muted hover:text-foreground'}"
                onclick={() => (layout = 'force')}
              >{m.kg_layoutForce()}</button>
              <button
                type="button"
                class="flex-1 py-1 text-center cursor-pointer transition-colors border-l border-border text-[10px]
                  {layout === 'circular' ? 'bg-accent text-white' : 'text-muted hover:text-foreground'}"
                onclick={() => (layout = 'circular')}
              >{m.kg_layoutCircular()}</button>
            </div>
            <button
              type="button"
              class="px-1.5 py-1 rounded border cursor-pointer transition-colors text-[10px]
                {showNodeLabels ? 'bg-accent/20 border-accent text-accent' : 'border-border text-muted hover:text-foreground'}"
              onclick={() => (showNodeLabels = !showNodeLabels)}
              title={m.kg_nodeLabels()}
            >Aa</button>
            <button
              type="button"
              class="px-1.5 py-1 rounded border cursor-pointer transition-colors text-[10px]
                {showEdgeLabels ? 'bg-accent/20 border-accent text-accent' : 'border-border text-muted hover:text-foreground'}"
              onclick={() => (showEdgeLabels = !showEdgeLabels)}
              title={m.kg_edgeLabels()}
            >&mdash;</button>
          </div>

          <!-- Type filter pills -->
          <div class="flex flex-wrap gap-1">
            {#each OBJECT_TYPES as type (type)}
              {@const count = typeCounts[type] ?? 0}
              {@const active = activeTypes.has(type)}
              <button
                type="button"
                class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] cursor-pointer transition-all border
                  {count === 0
                    ? 'opacity-30 cursor-default border-border'
                    : active
                      ? 'border-transparent text-white'
                      : 'border-border text-muted-strong hover:text-foreground'}"
                style={active && count > 0 ? `background-color: ${TYPE_COLORS[type]}` : ''}
                disabled={count === 0}
                onclick={() => toggleType(type)}
              >
                <span
                  class="w-1.5 h-1.5 rounded-full shrink-0 {active ? '' : ''}"
                  style="background-color: {TYPE_COLORS[type]}"
                ></span>
                {type}
                <span class="opacity-50">{count}</span>
              </button>
            {/each}
          </div>
        </div>
      </div>
    {/if}

    <!-- Node detail card (bottom-right) -->
    {#if selectedNode}
      <div class="absolute bottom-3 right-3 z-10 pointer-events-none">
        <div class="pointer-events-auto w-[260px] bg-bg2/95 backdrop-blur-sm border border-border
                    rounded-lg shadow-lg text-[11px] overflow-hidden">
          <!-- Header -->
          <div class="flex items-center justify-between px-3 py-2 border-b border-border">
            <div class="flex items-center gap-2 min-w-0">
              <span
                class="w-2.5 h-2.5 rounded-full shrink-0"
                style="background-color: {TYPE_COLORS[selectedNode.type]}"
              ></span>
              <span class="text-foreground font-medium truncate">{selectedNode.label}</span>
            </div>
            <button
              type="button"
              class="text-muted hover:text-foreground cursor-pointer transition-colors shrink-0 ml-2"
              onclick={() => { selectedNode = null; jsonExpanded = false; }}
            >&times;</button>
          </div>

          <!-- Body -->
          <div class="px-3 py-2 space-y-1">
            <div class="flex items-center gap-2">
              <span class="text-muted">{m.kg_nodeType()}</span>
              <span
                class="px-1.5 py-0.5 rounded text-[9px] font-medium text-white"
                style="background-color: {TYPE_COLORS[selectedNode.type]}"
              >{selectedNode.type}</span>
            </div>
            <div>
              <span class="text-muted">{m.kg_nodeCreated()} </span>
              <span class="text-foreground">{formatDate(selectedNode.createdAt)}</span>
            </div>
            {#if Object.keys(selectedNode.data).length > 0}
              <div>
                <button
                  type="button"
                  class="text-muted hover:text-foreground cursor-pointer"
                  onclick={() => (jsonExpanded = !jsonExpanded)}
                >{m.kg_nodeData()} {jsonExpanded ? '\u25BE' : '\u25B8'}</button>
                {#if jsonExpanded}
                  <div class="mt-1 max-h-[150px] overflow-y-auto rounded bg-bg1 p-1.5">
                    <JsonView value={selectedNode.data} />
                  </div>
                {/if}
              </div>
            {:else}
              <div><span class="text-muted">{m.kg_nodeData()}: </span><span class="text-muted-strong">{m.kg_nodeDataEmpty()}</span></div>
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>
