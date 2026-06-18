<script lang="ts">
  import type { PageData } from './$types';
  import { goto, invalidateAll } from '$app/navigation';
  import { Trophy } from 'lucide-svelte';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import { Sparkles, RefreshCw } from 'lucide-svelte';
  import { PageHeader, Button } from '$lib/components/ui';
  import CrmWordCloud from '$lib/components/crm/CrmWordCloud.svelte';
  import CrmSentimentTrend from '$lib/components/crm/CrmSentimentTrend.svelte';

  let { data }: { data: PageData } = $props();

  const RANGES = [
    { id: '30d', label: () => m.crm_insights_range_30d() },
    { id: '90d', label: () => m.crm_insights_range_90d() },
    { id: '365d', label: () => m.crm_insights_range_365d() },
    { id: 'all', label: () => m.crm_insights_range_all() },
  ];
  function setRange(r: string) {
    const url = new URL(page.url);
    url.searchParams.set('range', r);
    goto(`${url.pathname}${url.search}`, { replaceState: true, keepFocus: true, noScroll: true });
  }

  let analyzing = $state(false);
  // Incremental scoring on first view (one capped batch), like the funnel auto-analyze.
  let tried = $state(false);
  $effect(() => {
    if (!tried) {
      tried = true;
      void analyze();
    }
  });
  async function analyze() {
    if (analyzing) return;
    analyzing = true;
    try {
      const res = await fetch('/api/crm/insights/sentiment', { method: 'POST' });
      if (res.ok) {
        const { scored } = await res.json();
        if (scored > 0) await invalidateAll();
      }
    } finally {
      analyzing = false;
    }
  }

  let rebuilding = $state(false);
  async function rebuildWins() {
    if (rebuilding) return;
    rebuilding = true;
    try {
      const res = await fetch('/api/crm/insights/win-index', { method: 'POST' });
      if (res.ok) await invalidateAll();
    } finally {
      rebuilding = false;
    }
  }
</script>

<svelte:head><title>{m.crm_insights_title()} — {m.crm_title()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
  <PageHeader title={m.crm_insights_title()} subtitle={m.crm_subtitle()}>
    {#snippet leading()}<Sparkles size={16} class="text-accent shrink-0" />{/snippet}
  </PageHeader>

  <div class="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4 max-w-5xl">
    <!-- Word cloud -->
    <section class="card">
      <header class="card-h">
        <span>{m.crm_insights_words_title()}</span>
        <span class="seg" role="group">
          {#each RANGES as r (r.id)}
            <button class="seg-btn" class:active={data.range === r.id} onclick={() => setRange(r.id)}>{r.label()}</button>
          {/each}
        </span>
      </header>
      <CrmWordCloud words={data.words} />
    </section>

    <!-- Sentiment trend -->
    <section class="card">
      <header class="card-h">
        <span>{m.crm_insights_sentiment_title()}</span>
        <Button variant="outline" size="sm" onclick={analyze} disabled={analyzing}>
          <RefreshCw size={14} class={analyzing ? 'animate-spin' : ''} />
          {analyzing ? m.crm_insights_analyzing() : m.crm_insights_analyze()}
        </Button>
      </header>
      <CrmSentimentTrend points={data.sentiment} current={data.current} />
    </section>

    <!-- C3 — learning from winning conversations -->
    <section class="card">
      <header class="card-h">
        <span class="flex items-center gap-1.5"><Trophy size={13} /> {m.crm_wins_title()}</span>
        <Button variant="outline" size="sm" onclick={rebuildWins} disabled={rebuilding}>
          <RefreshCw size={14} class={rebuilding ? 'animate-spin' : ''} />
          {rebuilding ? m.crm_wins_rebuilding() : m.crm_wins_rebuild()}
        </Button>
      </header>
      {#if data.winIndex.count > 0}
        <p class="t-body">{m.crm_wins_status({ count: data.winIndex.count })}</p>
        {#if data.winIndex.thin}<p class="t-caption">{m.crm_wins_thin()}</p>{/if}
      {:else}
        <p class="t-caption">{m.crm_wins_never()}</p>
      {/if}
    </section>
  </div>
</div>

<style>
  .card { border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); padding: 0.85rem 1rem; }
  .card-h { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; font-size: 0.78rem; font-weight: 600; color: var(--color-muted-foreground); text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 0.8rem; }
  .seg { display: inline-flex; gap: 0.15rem; padding: 0.2rem; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--color-card); }
  .seg-btn { padding: 0.2rem 0.55rem; border-radius: var(--radius-sm, 6px); font-size: 0.74rem; font-weight: 500; color: var(--color-muted-foreground); font-variant-numeric: tabular-nums; }
  .seg-btn:hover { color: var(--color-foreground); }
  .seg-btn.active { color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 14%, transparent); font-weight: 600; }
  :global(.trend-head) { display: flex; align-items: baseline; gap: 0.5rem; margin-bottom: 0.4rem; }
  :global(.trend-cur) { font-size: 1.4rem; font-weight: 700; font-variant-numeric: tabular-nums; }
</style>
