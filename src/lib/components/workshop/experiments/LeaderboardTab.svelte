<script lang="ts">
  import { createQuery } from '@tanstack/svelte-query';
  import { ArrowLeft, Loader2 } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import { leaderboardQueryOptions, type LeaderboardRow } from './leaderboard-query';

  const query = createQuery(() => leaderboardQueryOptions());

  const rows = $derived(query.data ?? []);
  const loading = $derived(query.isPending);
  const err = $derived(query.error ? String(query.error) : null);

  const numCellClass = 'text-muted tabular-nums';
  const columns: DataColumn<LeaderboardRow>[] = [
    {
      key: 'modelId',
      label: m.workshop_exp_col_model(),
      fill: true,
      cellClass: 'truncate max-w-[220px] text-foreground',
    },
    {
      key: 'winRate',
      label: m.workshop_exp_col_win_rate(),
      align: 'right',
      numeric: true,
      custom: true,
      cellClass: 'text-accent',
    },
    {
      key: 'wins',
      label: m.workshop_exp_col_wins(),
      align: 'right',
      numeric: true,
      cellClass: numCellClass,
    },
    {
      key: 'rankings',
      label: m.workshop_exp_col_ranked(),
      align: 'right',
      numeric: true,
      cellClass: numCellClass,
    },
    {
      key: 'avgRank',
      label: m.workshop_exp_col_avg_rank(),
      align: 'right',
      numeric: true,
      custom: true,
      cellClass: numCellClass,
    },
    {
      key: 'runs',
      label: m.workshop_exp_col_runs(),
      align: 'right',
      numeric: true,
      cellClass: numCellClass,
    },
    {
      key: 'avgLatencyMs',
      label: m.workshop_exp_col_avg_latency(),
      align: 'right',
      numeric: true,
      custom: true,
      cellClass: numCellClass,
    },
    {
      key: 'totalCostUsd',
      label: m.workshop_exp_col_total_cost(),
      align: 'right',
      numeric: true,
      custom: true,
      cellClass: numCellClass,
    },
  ];
</script>

<div class="flex-1 overflow-y-auto p-6 space-y-4">
  <a
    href="/agents/workshop/compare"
    class="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-muted hover:text-foreground"
  >
    <ArrowLeft size={12} />
    {m.workshop_exp_compare()}
  </a>
  <h2 class="font-mono text-sm uppercase tracking-widest text-muted">
    {m.workshop_exp_leaderboard_title()}
  </h2>
  <p class="text-xs font-mono text-muted-strong">
    {m.workshop_exp_leaderboard_desc()}
  </p>

  {#if loading}
    <p class="text-xs font-mono text-muted inline-flex items-center gap-1.5">
      <Loader2 size={13} class="animate-spin" />
      {m.workshop_exp_loading()}
    </p>
  {:else if err}
    <p class="text-xs font-mono text-destructive">{err}</p>
  {:else if rows.length === 0}
    <p class="text-xs font-mono text-muted italic">{m.workshop_exp_leaderboard_empty()}</p>
  {:else}
    <DataTable
      variant="plain"
      data={rows}
      {columns}
      getRowId={(r) => r.modelId}
      initialSort={{ key: 'winRate', dir: 'desc' }}
      emptyMessage={m.workshop_exp_leaderboard_empty()}
    >
      {#snippet cell(r: LeaderboardRow, col: DataColumn<LeaderboardRow>)}
        {#if col.key === 'winRate'}
          {(r.winRate * 100).toFixed(0)}%
        {:else if col.key === 'avgRank'}
          {r.avgRank !== null ? r.avgRank.toFixed(2) : '—'}
        {:else if col.key === 'avgLatencyMs'}
          {r.avgLatencyMs !== null ? r.avgLatencyMs + 'ms' : '—'}
        {:else if col.key === 'totalCostUsd'}
          {r.totalCostUsd > 0 ? '$' + r.totalCostUsd.toFixed(4) : '—'}
        {/if}
      {/snippet}
    </DataTable>
  {/if}
</div>
