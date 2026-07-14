<script lang="ts">
  import { Search } from 'lucide-svelte';
  import { Button, EmptyState } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import type { BrainSearchHitDTO } from '$lib/types/brains';

  let { brainId }: { brainId: string } = $props();

  let query = $state('');
  let hits = $state<BrainSearchHitDTO[] | null>(null);
  let searching = $state(false);
  let error = $state('');

  async function submit() {
    const q = query.trim();
    if (!q || searching) return;
    searching = true;
    error = '';
    try {
      const res = await fetch(`/api/brains/${encodeURIComponent(brainId)}/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: q, limit: 10 }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        error = (body as { message?: string }).message ?? `Error ${res.status}`;
        hits = null;
        return;
      }
      const body = (await res.json()) as { hits: BrainSearchHitDTO[] };
      hits = body.hits;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      searching = false;
    }
  }
</script>

<div class="flex flex-col gap-3">
  <form class="flex gap-2" onsubmit={(e) => { e.preventDefault(); submit(); }}>
    <input
      type="text"
      bind:value={query}
      placeholder={m.brains_search_placeholder()}
      class="w-full flex-1 rounded-lg border border-border bg-bg3 px-3 py-1.5 text-sm text-accent-foreground placeholder-white/30 outline-none focus:hover:border-[var(--color-border-strong)] focus:ring-0"
    />
    <Button type="submit" variant="primary" size="sm" disabled={!query.trim() || searching} loading={searching}>
      {#snippet icon()}<Search size={14} />{/snippet}
      {m.brains_search_submit()}
    </Button>
  </form>

  {#if error}
    <p class="text-xs text-destructive">{error}</p>
  {/if}

  {#if hits === null}
    <EmptyState title={m.brains_search_empty()} compact />
  {:else if hits.length === 0}
    <EmptyState title={m.brains_search_no_hits()} compact />
  {:else}
    <ol class="flex flex-col gap-2">
      {#each hits as hit (hit.chunkId)}
        <li class="rounded-xl border border-border bg-bg3 p-3">
          <div class="mb-1 flex items-center justify-between gap-2">
            <span class="truncate text-xs font-semibold text-foreground">{hit.documentTitle}</span>
            <span class="shrink-0 rounded-full bg-bg3 px-2 py-0.5 text-[length:var(--font-size-telemetry)] text-muted-foreground">
              {(hit.score * 100).toFixed(0)}% {m.brains_search_score()}
            </span>
          </div>
          <p class="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{hit.chunkText}</p>
        </li>
      {/each}
    </ol>
  {/if}
</div>
