<script lang="ts">
  import { Button } from '$lib/components/ui';
import * as m from '$lib/paraglide/messages';
  import { SvelteSet } from 'svelte/reactivity';
  import type { EChartsOption } from 'echarts';
  import { createQuery } from '@tanstack/svelte-query';
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

  // KG types that don't overlap with MEMORY_CATEGORIES — only shown when data exists
  const KG_EXTRA_TYPES = ['event', 'task', 'belief', 'interaction', 'skill'] as const;

  const CATEGORY_COLORS: Record<string, string> = {
    preference: 'var(--color-pink)',
    fact: 'var(--color-success-fg)',
    decision: 'var(--color-warning-fg)',
    entity: 'var(--color-accent)',
    other: 'var(--color-text-tertiary)',
    event: 'var(--color-purple)',
    task: 'var(--color-warning-fg)',
    belief: 'var(--color-cyan)',
    interaction: 'var(--color-danger-fg)',
    skill: 'var(--color-emerald)',
    client: 'var(--color-warning-fg)',
  };
  const colorFor = (c: string) => CATEGORY_COLORS[c] ?? CATEGORY_COLORS.other;

  // ── State ───────────────────────────────────────────────────────────────────
  let kgNodes = $state<KGNode[]>([]);
  let kgLoading = $state(false);

  let activeCategories = new SvelteSet<string>([...MEMORY_CATEGORIES, ...KG_EXTRA_TYPES]);
  let query = $state('');
  let hits = $state<SearchHit[] | null>(null);
  let searching = $state(false);
  let searchError = $state<string | null>(null);

  // ── pgvector memories + scatter (two parallel GETs on open; cached 60s so
  // re-opening the panel for an already-viewed agent is instant) ─────────────
  async function fetchMemoryList(id: string) {
    const res = await fetch(`/api/agent-memories?agentId=${encodeURIComponent(id)}&stats=1&limit=500`);
    if (!res.ok) throw new Error(`Failed to load memories (${res.status})`);
    return (await res.json()) as { memories: MemoryRow[]; stats?: { category: string; count: number }[] };
  }
  async function fetchScatterPoints(id: string) {
    const res = await fetch(`/api/agent-memories/scatter?agentId=${encodeURIComponent(id)}`);
    if (!res.ok) return [];
    return ((await res.json()) as { points: ScatterPoint[] }).points;
  }

  const memoriesQuery = createQuery(() => ({
    queryKey: ['agent-memories', agentId],
    queryFn: () => fetchMemoryList(agentId),
    staleTime: 60_000,
    enabled: !!agentId,
  }));
  const scatterQuery = createQuery(() => ({
    queryKey: ['agent-memories', 'scatter', agentId],
    queryFn: () => fetchScatterPoints(agentId),
    staleTime: 60_000,
    enabled: !!agentId,
  }));

  const memories = $derived(memoriesQuery.data?.memories ?? []);
  const stats = $derived(memoriesQuery.data?.stats ?? []);
  const points = $derived(scatterQuery.data ?? []);
  const loading = $derived(memoriesQuery.isPending);
  const error = $derived(
    memoriesQuery.isError
      ? memoriesQuery.error instanceof Error
        ? memoriesQuery.error.message
        : 'Failed to load memories'
      : null,
  );

  // ── Load KG nodes (WS/gateway RPC — not a Query candidate) ──────────────────
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
    if (id) void loadKG(id);
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

  const countFor = (c: string) =>
    (stats.find((s) => s.category === c)?.count ?? 0) +
    kgNodes.filter((n) => n.type === c).length;
  const totalCount = $derived(stats.reduce((a, s) => a + s.count, 0));

  // KG-only types that actually have data (drives extra pills)
  const activeKgExtraTypes = $derived(
    KG_EXTRA_TYPES.filter((t) => kgNodes.some((n) => n.type === t)),
  );

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
        placeholder={m.memory_searchPlaceholder()}
        class="px-2 py-1 text-[length:var(--font-size-caption)] rounded bg-card border border-border text-foreground w-56 focus:outline-none focus:border-accent"
      />
      <Button variant="ghost"
        type="button"
        onclick={runSearch}
        disabled={searching}
        class="px-2 py-1 text-[length:var(--font-size-caption)] font-semibold rounded bg-accent/15 text-accent border border-accent/30 cursor-pointer hover:bg-accent/25 disabled:opacity-50"
      >
        {searching ? '…' : m.memory_search()}
      </Button>
      {#if hits !== null}
        <Button variant="ghost" type="button" onclick={clearSearch} class="px-2 py-1 text-[length:var(--font-size-caption)] text-muted hover:text-foreground cursor-pointer">
          {m.memory_clear()}
        </Button>
      {/if}
    </div>
    <div class="flex-1"></div>
    <!-- Category pills: pgvector + KG-extra types unified -->
    <div class="flex flex-wrap items-center gap-1">
      {#each MEMORY_CATEGORIES as c (c)}
        <Button variant="ghost"
          type="button"
          onclick={() => toggleCategory(c)}
          class="px-2 py-0.5 text-[length:var(--font-size-telemetry)] font-semibold rounded-full border transition-colors cursor-pointer
            {activeCategories.has(c) ? 'text-foreground' : 'text-muted opacity-50'}"
          style="border-color: {colorFor(c)}; background: {activeCategories.has(c) ? colorFor(c) + '22' : 'transparent'}"
        >
          <span class="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style="background:{colorFor(c)}"></span>
          {c} {countFor(c)}
        </Button>
      {/each}
      <!-- KG-exclusive types (event, task, belief, etc.) — only when data exists -->
      {#each activeKgExtraTypes as t (t)}
        <Button variant="ghost"
          type="button"
          onclick={() => toggleCategory(t)}
          class="px-2 py-0.5 text-[length:var(--font-size-telemetry)] font-semibold rounded-full border transition-colors cursor-pointer
            {activeCategories.has(t) ? 'text-foreground' : 'text-muted opacity-50'}"
          style="border-color: {colorFor(t)}; background: {activeCategories.has(t) ? colorFor(t) + '22' : 'transparent'}"
        >
          <span class="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style="background:{colorFor(t)}"></span>
          {t} {countFor(t)}
        </Button>
      {/each}
    </div>
  </div>

  {#if searchError}
    <div class="text-[length:var(--font-size-caption)] text-[var(--color-warning-fg)]">{searchError}</div>
  {/if}

  <!-- Semantic scatter (pgvector only) -->
  <div class="rounded-lg border border-border bg-card/40 relative" style="height: 200px">
    {#if points.length > 1}
      <Chart options={scatterOptions} height="200px" />
    {:else}
      <div class="absolute inset-0 flex items-center justify-center text-[length:var(--font-size-caption)] text-muted">
        {loading ? m.common_loading() : m.memory_notEnough()}
      </div>
    {/if}
  </div>

  <!-- Unified list: KG nodes + pgvector memories, sorted most recent first -->
  <div class="flex-1 min-h-0 overflow-auto rounded-lg border border-border">
    {#if (loading || kgLoading) && unifiedRows.length === 0}
      <div class="p-6 text-center text-[length:var(--font-size-caption)] text-muted">{m.common_loading()}</div>
    {:else if error}
      <div class="p-6 text-center text-[length:var(--font-size-caption)] text-[var(--color-danger-fg)]">{error}</div>
    {:else if unifiedRows.length === 0}
      <div class="p-6 text-center text-[length:var(--font-size-caption)] text-muted">
        {hits !== null ? m.common_noMatches() : totalCount === 0 && kgNodes.length === 0 ? m.memory_noCaptures() : m.memory_noCategories()}
      </div>
    {:else}
      <table class="w-full text-[length:var(--font-size-caption)] border-collapse">
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
                  <span class="px-1.5 py-0.5 rounded-full text-[length:var(--font-size-telemetry)] font-semibold" style="background:{colorFor(row.category)}22; color:{colorFor(row.category)}">
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
                    <span class="ml-2 text-muted text-[length:var(--font-size-caption)]">{truncate(JSON.stringify(node.data), 80)}</span>
                  {/if}
                </td>
                <td class="px-3 py-2">
                  <span class="px-1.5 py-0.5 rounded-full text-[length:var(--font-size-telemetry)] font-semibold" style="background:var(--color-purple)22; color:var(--color-purple)">
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
