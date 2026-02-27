<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { fetchKGSnapshot } from '$lib/services/gateway.svelte';
  import * as echarts from 'echarts';

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
  let showNodeLabels = $state(true);
  let showEdgeLabels = $state(false);
  let activeTypes = new SvelteSet<ObjectType>(OBJECT_TYPES);
  let selectedNode = $state<MemoryObject | null>(null);
  let jsonExpanded = $state(false);

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
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
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
          label: { show: showNodeLabels, color: '#fafafa', fontSize: 10 },
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
          emphasis: { focus: 'adjacency', lineStyle: { width: 4 } },
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
      const ro = new ResizeObserver(() => chart?.resize());
      ro.observe(canvasEl);
      return () => {
        ro.disconnect();
        chart?.dispose();
        chart = null;
      };
    }
  });

  // ── Re-fetch when agentId changes ─────────────────────────────────────────
  $effect(() => {
    agentId; // reactive dependency
    refresh();
  });

  // ── Reactive chart update ──────────────────────────────────────────────────
  $effect(() => {
    if (!chart) return;
    // Track all config + data dependencies
    const _dep = [filteredNodes, filteredEdges, layout, showNodeLabels, showEdgeLabels];
    void _dep;
    chart.setOption(buildOption(), { notMerge: true });
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
    {loading ? 'Loading…' : 'Refresh'}
  </button>

  {#if !loading && !error}
    <span class="text-muted">
      {nodes.length} node{nodes.length !== 1 ? 's' : ''} · {edges.length} edge{edges.length !== 1 ? 's' : ''}
    </span>
  {/if}

  {#if error}
    <span class="text-destructive">{error}</span>
  {/if}
</div>

<!-- Body -->
<div class="flex-1 min-h-0 flex overflow-hidden">

  <!-- Canvas area -->
  <div class="flex-1 min-w-0 relative">
    {#if loading}
      <div class="absolute inset-0 flex items-center justify-center">
        <div class="w-4 h-4 border-2 border-border border-t-accent rounded-full animate-spin"></div>
      </div>
    {:else if nodes.length === 0 && !error}
      <div class="absolute inset-0 flex items-center justify-center text-center px-8">
        <div>
          <div class="text-muted text-sm">No memory objects yet</div>
          <div class="text-muted/60 text-xs mt-1">The agent stores facts here as it learns.</div>
        </div>
      </div>
    {/if}
    <div bind:this={canvasEl} class="w-full h-full"></div>
  </div>

  <!-- Config sidebar -->
  <div class="w-[220px] shrink-0 border-l border-border bg-bg2 overflow-y-auto flex flex-col text-[11px]">

    <!-- Layout toggle -->
    <div class="px-3 pt-3 pb-2">
      <div class="text-muted mb-1.5 font-semibold uppercase tracking-wide text-[10px]">Layout</div>
      <div class="flex rounded overflow-hidden border border-border">
        <button
          type="button"
          class="flex-1 py-1 text-center cursor-pointer transition-colors
            {layout === 'force' ? 'bg-accent text-white' : 'bg-bg1 text-muted hover:text-foreground'}"
          onclick={() => (layout = 'force')}
        >Force</button>
        <button
          type="button"
          class="flex-1 py-1 text-center cursor-pointer transition-colors border-l border-border
            {layout === 'circular' ? 'bg-accent text-white' : 'bg-bg1 text-muted hover:text-foreground'}"
          onclick={() => (layout = 'circular')}
        >Circular</button>
      </div>
    </div>

    <!-- Label toggles -->
    <div class="px-3 pb-2 border-b border-border">
      <label class="flex items-center gap-2 cursor-pointer py-0.5">
        <input type="checkbox" bind:checked={showNodeLabels} class="accent-accent" />
        <span class="text-foreground">Node labels</span>
      </label>
      <label class="flex items-center gap-2 cursor-pointer py-0.5">
        <input type="checkbox" bind:checked={showEdgeLabels} class="accent-accent" />
        <span class="text-foreground">Edge labels</span>
      </label>
    </div>

    <!-- Type filters -->
    <div class="px-3 pt-2 pb-2 border-b border-border">
      <div class="text-muted mb-1.5 font-semibold uppercase tracking-wide text-[10px]">Filter by type</div>
      {#each OBJECT_TYPES as type (type)}
        {@const count = typeCounts[type] ?? 0}
        {@const active = activeTypes.has(type)}
        <label class="flex items-center gap-2 cursor-pointer py-0.5 {count === 0 ? 'opacity-40' : ''}">
          <input
            type="checkbox"
            checked={active}
            disabled={count === 0}
            onchange={() => toggleType(type)}
            class="accent-accent"
          />
          <span
            class="w-2 h-2 rounded-full shrink-0"
            style="background-color: {TYPE_COLORS[type]}"
          ></span>
          <span class="text-foreground flex-1">{type}</span>
          <span class="text-muted">{count}</span>
        </label>
      {/each}
    </div>

    <!-- Selected node panel -->
    {#if selectedNode}
      <div class="px-3 pt-2 pb-3">
        <div class="text-muted mb-1.5 font-semibold uppercase tracking-wide text-[10px]">Selected node</div>
        <div class="space-y-1">
          <div>
            <span class="text-muted">label: </span>
            <span class="text-foreground break-words">{selectedNode.label}</span>
          </div>
          <div>
            <span class="text-muted">type: </span>
            <span style="color: {TYPE_COLORS[selectedNode.type]}">{selectedNode.type}</span>
          </div>
          <div>
            <span class="text-muted">created: </span>
            <span class="text-foreground">{formatDate(selectedNode.createdAt)}</span>
          </div>
          {#if Object.keys(selectedNode.data).length > 0}
            <div>
              <button
                type="button"
                class="text-muted hover:text-foreground cursor-pointer"
                onclick={() => (jsonExpanded = !jsonExpanded)}
              >
                data {jsonExpanded ? '▾' : '▸'}
              </button>
              {#if jsonExpanded}
                <pre class="mt-1 text-[10px] bg-bg1 rounded p-1.5 overflow-x-auto text-foreground whitespace-pre-wrap break-all">{JSON.stringify(selectedNode.data, null, 2)}</pre>
              {/if}
            </div>
          {:else}
            <div><span class="text-muted">data: </span><span class="text-muted/60">empty</span></div>
          {/if}
        </div>
        <button
          type="button"
          class="mt-2 text-muted hover:text-foreground cursor-pointer"
          onclick={() => { selectedNode = null; jsonExpanded = false; }}
        >✕ clear</button>
      </div>
    {/if}
  </div>
</div>
