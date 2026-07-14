<script lang="ts">
  import { createQuery } from '@tanstack/svelte-query';
  import { ArrowRight, Trophy } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { leaderboardQueryOptions, type LeaderboardRow } from './leaderboard-query';

  // Reload trigger: bump `refresh` after saving a ranking to re-pull the top models.
  let { refresh = 0 }: { refresh?: number } = $props();

  const query = createQuery(() => leaderboardQueryOptions());

  $effect(() => {
    if (refresh > 0) void query.refetch();
  });

  const top = $derived(
    (query.data ?? []).filter((r: LeaderboardRow) => r.rankings > 0).slice(0, 3),
  );
</script>

<div class="flex items-center gap-3 rounded border border-border bg-bg2 px-3 h-10">
  <Trophy size={14} class="text-accent/70 shrink-0" />
  <div class="flex-1 min-w-0 flex items-center gap-3 overflow-x-auto">
    {#if query.isPending}
      <span class="text-xs font-mono text-muted-strong">…</span>
    {:else if top.length === 0}
      <span class="text-xs font-mono text-muted-strong">{m.workshop_exp_strip_empty()}</span>
    {:else}
      {#each top as r, i (r.modelId)}
        <span class="text-xs font-mono whitespace-nowrap">
          <span class="text-muted-strong">{i + 1}.</span>
          <span class="text-foreground">{r.modelId}</span>
          <span class="text-accent">{(r.winRate * 100).toFixed(0)}%</span>
        </span>
      {/each}
    {/if}
  </div>
  <a
    href="/agents/workshop/leaderboard"
    class="shrink-0 inline-flex items-center gap-1 text-xs font-mono uppercase tracking-wider text-muted hover:text-foreground transition-colors"
  >
    {m.workshop_exp_leaderboard()}
    <ArrowRight size={12} />
  </a>
</div>
