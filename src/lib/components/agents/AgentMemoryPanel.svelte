<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import type { EChartsOption } from 'echarts';
  import Chart from '$lib/components/charts/Chart.svelte';

  let { agentId }: { agentId: string } = $props();

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

  const CATEGORIES = ['preference', 'fact', 'decision', 'entity', 'other'] as const;
  type Category = (typeof CATEGORIES)[number];
  const CATEGORY_COLORS: Record<string, string> = {
    preference: '#ec4899',
    fact: '#22c55e',
    decision: '#f59e0b',
    entity: '#3b82f6',
    other: '#a1a1aa',
  };
  const colorFor = (c: string) => CATEGORY_COLORS[c] ?? CATEGORY_COLORS.other;

  // ── State ──────────────────────────────────────────────────────────────────
  let memories = $state<MemoryRow[]>([]);
  let stats = $state<{ category: string; count: number }[]>([]);
  let points = $state<ScatterPoint[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  let activeCategories = new SvelteSet<Category>(CATEGORIES);
  let query = $state('');
  let hits = $state<SearchHit[] | null>(null);
  let searching = $state(false);
  let searchError = $state<string | null>(null);

  // ── Load ───────────────────────────────────────────────────────────────────
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

  $effect(() => {
    const id = agentId;
    if (id) void load(id);
  });

  // ── Semantic search ──────────────────────────────────────────────────────────
  async function runSearch() {
    const q = query.trim();
    if (!q) {
      hits = null;
      return;
    }
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
  function clearSearch() {
    query = '';
    hits = null;
    searchError = null;
  }

  function toggleCategory(c: Category) {
    if (activeCategories.has(c)) activeCategories.delete(c);
    else activeCategories.add(c);
  }

  const countFor = (c: string) => stats.find((s) => s.category === c)?.count ?? 0;
  const totalCount = $derived(stats.reduce((a, s) => a + s.count, 0));

  // Rows shown in the table: search hits take precedence, else category-filtered list.
  const visibleRows = $derived(
    hits ?? memories.filter((mrow) => activeCategories.has(mrow.category as Category)),
  );

  // ── Scatter chart options ────────────────────────────────────────────────────
  const scatterOptions = $derived<EChartsOption>({
    grid: { left: 8, right: 8, top: 8, bottom: 8 },
    xAxis: { show: false, scale: true },
    yAxis: { show: false, scale: true },
    tooltip: {
      trigger: 'item',
      formatter: (p: unknown) => {
        const d = (p as { data: { name: string; cat: string } }).data;
        return `<b>${d.cat}</b><br/>${escapeHtml(d.name).slice(0, 120)}`;
      },
    },
    series: CATEGORIES.filter((c) => activeCategories.has(c)).map((c) => ({
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
    return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch);
  }
  function fmtDate(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
  }
</script>

<div class="flex-1 min-h-0 flex flex-col overflow-hidden p-3 gap-3">
  <!-- Toolbar: search + category pills -->
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
    <div class="flex flex-wrap items-center gap-1">
      {#each CATEGORIES as c (c)}
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
    </div>
  </div>

  {#if searchError}
    <div class="text-[11px] text-amber-400">{searchError}</div>
  {/if}

  <!-- Semantic scatter -->
  <div class="rounded-lg border border-border bg-card/40 relative" style="height: 260px">
    {#if points.length > 1}
      <Chart options={scatterOptions} height="260px" />
    {:else}
      <div class="absolute inset-0 flex items-center justify-center text-[11px] text-muted">
        {loading ? 'Loading…' : 'Not enough embedded memories to plot yet.'}
      </div>
    {/if}
  </div>

  <!-- Table -->
  <div class="flex-1 min-h-0 overflow-auto rounded-lg border border-border">
    {#if loading && memories.length === 0}
      <div class="p-6 text-center text-[12px] text-muted">Loading memories…</div>
    {:else if error}
      <div class="p-6 text-center text-[12px] text-red-400">{error}</div>
    {:else if visibleRows.length === 0}
      <div class="p-6 text-center text-[12px] text-muted">
        {hits !== null ? 'No matches.' : totalCount === 0 ? 'No memories captured yet.' : 'No memories in the selected categories.'}
      </div>
    {:else}
      <table class="w-full text-[12px] border-collapse">
        <thead class="sticky top-0 bg-card text-muted">
          <tr class="text-left">
            <th class="px-3 py-2 font-semibold">Memory</th>
            <th class="px-3 py-2 font-semibold w-24">Category</th>
            <th class="px-3 py-2 font-semibold w-16">Imp.</th>
            <th class="px-3 py-2 font-semibold w-20">Source</th>
            {#if hits !== null}<th class="px-3 py-2 font-semibold w-16">Score</th>{/if}
            <th class="px-3 py-2 font-semibold w-24">Date</th>
          </tr>
        </thead>
        <tbody>
          {#each visibleRows as row (row.id)}
            <tr class="border-t border-border/60 hover:bg-card/60">
              <td class="px-3 py-2 text-foreground">{row.content}</td>
              <td class="px-3 py-2">
                <span class="px-1.5 py-0.5 rounded-full text-[10px] font-semibold" style="background:{colorFor(row.category)}22; color:{colorFor(row.category)}">
                  {row.category}
                </span>
              </td>
              <td class="px-3 py-2 text-muted">{row.importance.toFixed(2)}</td>
              <td class="px-3 py-2 text-muted">{row.source}</td>
              {#if hits !== null}<td class="px-3 py-2 text-accent">{(row as SearchHit).score?.toFixed(2)}</td>{/if}
              <td class="px-3 py-2 text-muted">{fmtDate(row.createdAt)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>
