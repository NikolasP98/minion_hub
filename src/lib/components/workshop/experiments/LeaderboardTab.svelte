<script lang="ts">
  import { onMount } from 'svelte';
  import { ArrowLeft, Loader2 } from 'lucide-svelte';

  type Row = {
    modelId: string;
    rankings: number;
    wins: number;
    winRate: number;
    avgRank: number | null;
    runs: number;
    avgLatencyMs: number | null;
    totalCostUsd: number;
  };

  let rows = $state<Row[]>([]);
  let loading = $state(true);
  let err = $state<string | null>(null);

  onMount(async () => {
    try {
      const res = await fetch('/api/workshop/leaderboard');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      rows = ((await res.json()) as { rows: Row[] }).rows;
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  });
</script>

<div class="flex-1 overflow-y-auto p-6 space-y-4">
  <a href="/agents/workshop/compare" class="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted hover:text-foreground">
    <ArrowLeft size={12} /> Compare
  </a>
  <h2 class="font-mono text-sm uppercase tracking-widest text-muted">Model Leaderboard</h2>
  <p class="text-[11px] font-mono text-muted-strong">
    Win-rate from your comparison rankings, plus latency &amp; cost from comparison runs.
  </p>

  {#if loading}
    <p class="text-xs font-mono text-muted inline-flex items-center gap-1.5"><Loader2 size={13} class="animate-spin" /> loading…</p>
  {:else if err}
    <p class="text-xs font-mono text-destructive">{err}</p>
  {:else if rows.length === 0}
    <p class="text-xs font-mono text-muted italic">No comparison data yet — run a comparison and rank the outputs.</p>
  {:else}
    <table class="w-full text-xs font-mono">
      <thead>
        <tr class="text-left text-muted-strong border-b border-border">
          <th class="py-2 pr-3 font-normal">Model</th>
          <th class="py-2 px-3 font-normal text-right">Win rate</th>
          <th class="py-2 px-3 font-normal text-right">Wins</th>
          <th class="py-2 px-3 font-normal text-right">Ranked</th>
          <th class="py-2 px-3 font-normal text-right">Avg rank</th>
          <th class="py-2 px-3 font-normal text-right">Runs</th>
          <th class="py-2 px-3 font-normal text-right">Avg latency</th>
          <th class="py-2 pl-3 font-normal text-right">Total cost</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.modelId)}
          <tr class="border-b border-border/50 hover:bg-bg2">
            <td class="py-2 pr-3 text-foreground truncate max-w-[220px]">{r.modelId}</td>
            <td class="py-2 px-3 text-right text-accent">{(r.winRate * 100).toFixed(0)}%</td>
            <td class="py-2 px-3 text-right text-muted">{r.wins}</td>
            <td class="py-2 px-3 text-right text-muted">{r.rankings}</td>
            <td class="py-2 px-3 text-right text-muted">{r.avgRank !== null ? r.avgRank.toFixed(2) : '—'}</td>
            <td class="py-2 px-3 text-right text-muted">{r.runs}</td>
            <td class="py-2 px-3 text-right text-muted">{r.avgLatencyMs !== null ? r.avgLatencyMs + 'ms' : '—'}</td>
            <td class="py-2 pl-3 text-right text-muted">{r.totalCostUsd > 0 ? '$' + r.totalCostUsd.toFixed(4) : '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
