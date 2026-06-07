<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import type { EChartsOption } from 'echarts';
  import Chart from '$lib/components/charts/Chart.svelte';
  import { fetchKGSnapshot } from '$lib/services/gateway.svelte';

  let { agentId }: { agentId: string } = $props();

  // ── pgvector memory types ───────────────────────────────────────────────────
  type MemoryRow = {
    id: string;
    agentId: string;
    content: string;
    category: string;
    importance: number;
    source: string;
    createdAt: string;
    occurredAt: string | null;
    metadata: Record<string, unknown>;
  };
  type ScatterPoint = { id: string; content: string; category: string; importance: number; x: number; y: number };
  type SearchHit = MemoryRow & { score: number };

  // ── KG node types ───────────────────────────────────────────────────────────
  type KGNode = {
    id: string;
    type: string;
    label: string;
    data: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
  };

  // ── Unified list row ────────────────────────────────────────────────────────
  type UnifiedRow =
    | { kind: 'memory'; row: MemoryRow; sortMs: number }
    | { kind: 'kg'; node: KGNode; sortMs: number };

  const MEMORY_CATEGORIES = ['preference', 'fact', 'decision', 'entity', 'other'] as const;
  type Category = (typeof MEMORY_CATEGORIES)[number];

  const KG_TYPES = ['entity', 'fact', 'event', 'preference', 'task', 'belief', 'interaction', 'skill'] as const;

  const CATEGORY_COLORS: Record<string, string> = {
    preference: '#ec4899',
    fact: '#22c55e',
    decision: '#f59e0b',
    entity: '#3b82f6',
    other: '#a1a1aa',
    event: '#a855f7',
    task: '#f59e0b',
    belief: '#06b6d4',
    interaction: '#ef4444',
    skill: '#10b981',
    client: '#f97316',
  };
  const colorFor = (c: string) => CATEGORY_COLORS[c] ?? CATEGORY_COLORS.other;

  // ── State ───────────────────────────────────────────────────────────────────
  let memories = $state<MemoryRow[]>([]);
  let stats = $state<{ category: string; count: number }[]>([]);
  let points = $state<ScatterPoint[]>([]);
  let kgNodes = $state<KGNode[]>([]);
  let loading = $state(false);
  let kgLoading = $state(false);
  let error = $state<string | null>(null);

  let activeCategories = new SvelteSet<string>([...MEMORY_CATEGORIES, ...KG_TYPES]);
  let query = $state('');
  let hits = $state<SearchHit[] | null>(null);
  let searching = $state(false);
  let searchError = $state<string | null>(null);

  // ── Load pgvector memories ──────────────────────────────────────────────────
  async function load(id: string) {
    loading = true;
    error = null;
    try {
      const [listRes, scatterRes] = await Promise.all([
        fetch(`/api/agent-memories?agentId=${encodeURIComponent(id)}&stats=1&limit=500`),
        fetch(`/api/agent-memories/scatter?agentId=${encodeURIComponent(id)}`),
      ]);
      if (!listRes.ok) throw new Error(`Failed to load memories (${listRes.status})`);
      const listJson = (await listRes.json()) as { memories: MemoryRow[]; stats?: { category: string; count: number }[] };
      memories = listJson.memories ?? [];
      stats = listJson.stats ?? [];
      points = scatterRes.ok ? ((await scatterRes.json()) as { points: ScatterPoint[] }).points : [];
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load memories';
    } finally {
      loading = false;
    }
  }

  // ── Load KG nodes ───────────────────────────────────────────────────────────
  async function loadKG(id: string) {
    kgLoading = true;
    try {
      const res = (await fetchKGSnapshot(id)) as { nodes?: KGNode[] } | null;
      kgNodes = res?.nodes ?? [];
    } catch {
      kgNodes = [];
    } finally {
      kgLoading = false;
    }
  }

  $effect(() => {
    const id = agentId;
    if (id) {
      void load(id);
      void loadKG(id);
    }
  });

  // ── Semantic search ─────────────────────────────────────────────────────────
  async function runSearch() {
    const q = query.trim();
    if (!q) { hits = null; return; }
    searching = true;
    searchError = null;
    try {
      const res = await fetch('/api/agent-memories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId, query: q, limit: 20 }),
      });
      if (!res.ok) {
        searchError = res.status === 503 ? 'Search unavailable (embeddings not configured)' : `Search failed (${res.status})`;
        hits = null;
        return;
      }
      hits = ((await res.json()) as { hits: SearchHit[] }).hits;
    } catch {
      searchError = 'Search failed';
      hits = null;
    } finally {
      searching = false;
    }
  }
  function clearSearch() { query = ''; hits = null; searchError = null; }

  function toggleCategory(c: string) {
    if (activeCategories.has(c)) activeCategories.delete(c);
    else activeCategories.add(c);
  }

  const countFor = (c: string) => stats.find((s) => s.category === c)?.count ?? 0;
  const totalCount = $derived(stats.reduce((a, s) => a + s.count, 0));

  // ── Unified sorted list ─────────────────────────────────────────────────────
  const unifiedRows = $derived.by((): UnifiedRow[] => {
    if (hits !== null) {
      return hits.map((h) => ({ kind: 'memory' as const, row: h, sortMs: new Date(h.createdAt).getTime() }));
    }
    const memRows: UnifiedRow[] = memories
      .filter((r) => activeCategories.has(r.category))
      .map((r) => ({ kind: 'memory' as const, row: r, sortMs: new Date(r.createdAt).getTime() }));
    const kgRows: UnifiedRow[] = kgNodes
      .filter((n) => activeCategories.has(n.type))
      .map((n) => ({ kind: 'kg' as const, node: n, sortMs: n.createdAt }));
    return [...memRows, ...kgRows].sort((a, b) => b.sortMs - a.sortMs);
  });

  // ── Scatter (pgvector only) ─────────────────────────────────────────────────
  const scatterOptions = $derived<EChartsOption>({
    grid: { left: 8, right: 8, top: 8, bottom: 8 },
    xAxis: { show: false, scale: true },
    yAxis: { show: false, scale: true },
    tooltip: {
      trigger: 'item',
      formatter: (p: unknown) => {
        const d = (p as { data: { name: string; cat: string } }).data;
        return `<b>${escapeHtml(d.cat)}</b><br/>${escapeHtml(d.name).slice(0, 120)}`;
      },
    },
    series: MEMORY_CATEGORIES.filter((c) => activeCategories.has(c)).map((c) => ({
      name: c,
      type: 'scatter',
      itemStyle: { color: colorFor(c), opacity: 0.8 },
      data: points
        .filter((pt) => pt.category === c)
        .map((pt) => ({
          value: [pt.x, pt.y],
          name: pt.content,
          cat: pt.category,
          symbolSize: 8 + Math.max(0, Math.min(1, pt.importance)) * 14,
        })),
    })),
  });

  function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
  }
  function fmtDate(ms: number | string): string {
    const d = typeof ms === 'number' ? new Date(ms) : new Date(ms);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
  }
  function truncate(s: string, n = 120) { return s.length > n ? s.slice(0, n) + '…' : s; }
</script>

<div class="flex-1 min-h-0 flex flex-col overflow-hidden p-3 gap-3">
  <!-- Toolbar -->
  <div class="flex flex-wrap items-center gap-2">
    <div class="flex items-center gap-1">
      <input
        type="text"
        bind:value={query}
        onkeydown={(e) => e.key === 'Enter' && runSearch()}
        placeholder="Search memories semantically…"
        class="px-2 py-1 text-[12px] rounded bg-card border border-border text-foreground w-56 focus:outline-none focus:border-accent"
      />
      <button
        type="button"
        onclick={runSearch}
        disabled={searching}
        class="px-2 py-1 text-[11px] font-semibold rounded bg-accent/15 text-accent border border-accent/30 cursor-pointer hover:bg-accent/25 disabled:opacity-50"
      >
        {searching ? '…' : 'Search'}
      </button>
      {#if hits !== null}
        <button type="button" onclick={clearSearch} class="px-2 py-1 text-[11px] text-muted hover:text-foreground cursor-pointer">
          Clear
        </button>
      {/if}
    </div>
    <div class="flex-1"></div>
    <!-- Category pills: memory categories + KG source badge -->
    <div class="flex flex-wrap items-center gap-1">
      {#each MEMORY_CATEGORIES as c (c)}
        <button
          type="button"
          onclick={() => toggleCategory(c)}
          class="px-2 py-0.5 text-[10px] font-semibold rounded-full border transition-colors cursor-pointer
            {activeCategories.has(c) ? 'text-foreground' : 'text-muted opacity-50'}"
          style="border-color: {colorFor(c)}; background: {activeCategories.has(c) ? colorFor(c) + '22' : 'transparent'}"
        >
          <span class="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style="background:{colorFor(c)}"></span>
          {c} {countFor(c)}
        </button>
      {/each}
      <!-- KG toggle -->
      {#if kgNodes.length > 0}
        <button
          type="button"
          onclick={() => KG_TYPES.forEach((t) => toggleCategory(t))}
          class="px-2 py-0.5 text-[10px] font-semibold rounded-full border transition-colors cursor-pointer
            {KG_TYPES.some((t) => activeCategories.has(t)) ? 'text-foreground' : 'text-muted opacity-50'}"
          style="border-color: #7c3aed; background: {KG_TYPES.some((t) => activeCategories.has(t)) ? '#7c3aed22' : 'transparent'}"
        >
          <span class="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style="background:#7c3aed"></span>
          graph {kgNodes.length}
        </button>
      {/if}
    </div>
  </div>

  {#if searchError}
    <div class="text-[11px] text-amber-400">{searchError}</div>
  {/if}

  <!-- Semantic scatter (pgvector only) -->
  <div class="rounded-lg border border-border bg-card/40 relative" style="height: 200px">
    {#if points.length > 1}
      <Chart options={scatterOptions} height="200px" />
    {:else}
      <div class="absolute inset-0 flex items-center justify-center text-[11px] text-muted">
        {loading ? 'Loading…' : 'Not enough embedded memories to plot yet.'}
      </div>
    {/if}
  </div>

  <!-- Unified list: KG nodes + pgvector memories, sorted most recent first -->
  <div class="flex-1 min-h-0 overflow-auto rounded-lg border border-border">
    {#if (loading || kgLoading) && unifiedRows.length === 0}
      <div class="p-6 text-center text-[12px] text-muted">Loading…</div>
    {:else if error}
      <div class="p-6 text-center text-[12px] text-red-400">{error}</div>
    {:else if unifiedRows.length === 0}
      <div class="p-6 text-center text-[12px] text-muted">
        {hits !== null ? 'No matches.' : totalCount === 0 && kgNodes.length === 0 ? 'No memories captured yet.' : 'No memories in the selected categories.'}
      </div>
    {:else}
      <table class="w-full text-[12px] border-collapse">
        <thead class="sticky top-0 bg-card text-muted">
          <tr class="text-left">
            <th class="px-3 py-2 font-semibold">Memory</th>
            <th class="px-3 py-2 font-semibold w-24">Type</th>
            <th class="px-3 py-2 font-semibold w-16">Source</th>
            {#if hits !== null}<th class="px-3 py-2 font-semibold w-16">Score</th>{/if}
            <th class="px-3 py-2 font-semibold w-24">Date</th>
          </tr>
        </thead>
        <tbody>
          {#each unifiedRows as item (item.kind === 'memory' ? item.row.id : item.node.id)}
            {#if item.kind === 'memory'}
              {@const row = item.row}
              <tr class="border-t border-border/60 hover:bg-card/60">
                <td class="px-3 py-2 text-foreground">{truncate(row.content)}</td>
                <td class="px-3 py-2">
                  <span class="px-1.5 py-0.5 rounded-full text-[10px] font-semibold" style="background:{colorFor(row.category)}22; color:{colorFor(row.category)}">
                    {row.category}
                  </span>
                </td>
                <td class="px-3 py-2 text-muted">{row.source}</td>
                {#if hits !== null}<td class="px-3 py-2 text-accent">{(row as SearchHit).score?.toFixed(2)}</td>{/if}
                <td class="px-3 py-2 text-muted">{fmtDate(row.createdAt)}</td>
              </tr>
            {:else}
              {@const node = item.node}
              <tr class="border-t border-border/60 hover:bg-card/60 opacity-90">
                <td class="px-3 py-2 text-foreground">
                  <span class="font-medium">{node.label}</span>
                  {#if Object.keys(node.data).length > 0}
                    <span class="ml-2 text-muted text-[11px]">{truncate(JSON.stringify(node.data), 80)}</span>
                  {/if}
                </td>
                <td class="px-3 py-2">
                  <span class="px-1.5 py-0.5 rounded-full text-[10px] font-semibold" style="background:#7c3aed22; color:#a78bfa">
                    {node.type}
                  </span>
                </td>
                <td class="px-3 py-2 text-muted">kg</td>
                {#if hits !== null}<td class="px-3 py-2"></td>{/if}
                <td class="px-3 py-2 text-muted">{fmtDate(node.createdAt)}</td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>
