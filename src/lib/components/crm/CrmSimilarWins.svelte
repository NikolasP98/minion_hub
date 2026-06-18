<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { Button } from '$lib/components/ui';
  import { Trophy, Search } from 'lucide-svelte';

  type Win = { contactId: string; displayName: string | null; similarity: number; bought: string[]; snippet: string };
  let { contactId }: { contactId: string } = $props();

  let loading = $state(false);
  let wins = $state<Win[] | null>(null);

  async function find() {
    if (loading) return;
    loading = true;
    try {
      const r = await fetch(`/api/crm/contacts/${contactId}/similar-wins`);
      if (r.ok) wins = (await r.json()).wins as Win[];
    } finally {
      loading = false;
    }
  }
</script>

<section class="card">
  <header class="card-h"><span class="flex items-center gap-1.5"><Trophy size={13} /> {m.crm_similar_title()}</span></header>
  {#if wins === null}
    <Button variant="outline" size="sm" onclick={find} disabled={loading}>
      <Search size={14} /> {loading ? m.crm_similar_finding() : m.crm_similar_find()}
    </Button>
  {:else if wins.length === 0}
    <p class="t-caption">{m.crm_similar_none()}</p>
  {:else}
    <ul class="wins">
      {#each wins as w (w.contactId)}
        <li class="win">
          <div class="win-top">
            <a class="win-name" href={`/crm/${w.contactId}`}>{w.displayName ?? w.contactId}</a>
            <span class="win-pct">{m.crm_similar_match({ pct: Math.round(w.similarity * 100) })}</span>
          </div>
          {#if w.bought.length}
            <div class="win-bought">{#each w.bought.slice(0, 4) as b (b)}<span class="chip">{b}</span>{/each}</div>
          {/if}
          {#if w.snippet}<p class="win-snip t-caption">{w.snippet}</p>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .card { border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); padding: 0.85rem 1rem; }
  .card-h { display: flex; align-items: center; justify-content: space-between; font-size: 0.78rem; font-weight: 600; color: var(--color-muted-foreground); text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 0.6rem; }
  .wins { display: flex; flex-direction: column; gap: 0.6rem; }
  .win { display: flex; flex-direction: column; gap: 0.25rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--hairline); }
  .win:last-child { border-bottom: none; padding-bottom: 0; }
  .win-top { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; }
  .win-name { font-weight: 600; color: var(--color-accent); }
  .win-name:hover { text-decoration: underline; }
  .win-pct { font-size: 0.72rem; color: var(--color-muted-foreground); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .win-bought { display: flex; flex-wrap: wrap; gap: 0.25rem; }
  .chip { font-size: 0.66rem; padding: 0.05rem 0.4rem; border-radius: 999px; background: color-mix(in srgb, var(--color-accent) 12%, transparent); color: var(--color-accent); }
  .win-snip { overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
</style>
