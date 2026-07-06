<script lang="ts">
  import { createQuery } from '@tanstack/svelte-query';
  import { ArrowLeft, Loader2 } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { leaderboardQueryOptions } from './leaderboard-query';

  const query = createQuery(() => leaderboardQueryOptions());

  const rows = $derived(query.data ?? []);
  const loading = $derived(query.isPending);
  const err = $derived(query.error ? String(query.error) : null);
</script>

<div class="flex-1 overflow-y-auto p-6 space-y-4">
  <a href="/agents/workshop/compare" class="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted hover:text-foreground">
    <ArrowLeft size={12} /> {m.workshop_exp_compare()}
  </a>
  <h2 class="font-mono text-sm uppercase tracking-widest text-muted">{m.workshop_exp_leaderboard_title()}</h2>
  <p class="text-[11px] font-mono text-muted-strong">
    {m.workshop_exp_leaderboard_desc()}
  </p>

  {#if loading}
    <p class="text-xs font-mono text-muted inline-flex items-center gap-1.5"><Loader2 size={13} class="animate-spin" /> {m.workshop_exp_loading()}</p>
  {:else if err}
    <p class="text-xs font-mono text-destructive">{err}</p>
  {:else if rows.length === 0}
    <p class="text-xs font-mono text-muted italic">{m.workshop_exp_leaderboard_empty()}</p>
  {:else}
    <table class="w-full text-xs font-mono">
      <thead>
        <tr class="text-left text-muted-strong border-b border-border">
          <th class="py-2 pr-3 font-normal">{m.workshop_exp_col_model()}</th>
          <th class="py-2 px-3 font-normal text-right">{m.workshop_exp_col_win_rate()}</th>
          <th class="py-2 px-3 font-normal text-right">{m.workshop_exp_col_wins()}</th>
          <th class="py-2 px-3 font-normal text-right">{m.workshop_exp_col_ranked()}</th>
          <th class="py-2 px-3 font-normal text-right">{m.workshop_exp_col_avg_rank()}</th>
          <th class="py-2 px-3 font-normal text-right">{m.workshop_exp_col_runs()}</th>
          <th class="py-2 px-3 font-normal text-right">{m.workshop_exp_col_avg_latency()}</th>
          <th class="py-2 pl-3 font-normal text-right">{m.workshop_exp_col_total_cost()}</th>
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
