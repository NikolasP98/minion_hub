<script lang="ts">
  import { onMount } from 'svelte';
  import AgentCard from '$lib/components/marketplace/AgentCard.svelte';
  import { marketplaceState, loadAgents, syncFromGitHub } from '$lib/state/marketplace.svelte';

  let searchInput = $state('');
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    loadAgents(marketplaceState.selectedCategory ?? undefined);
  });

  function onSearchInput(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    searchInput = val;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      marketplaceState.searchQuery = val;
      loadAgents(marketplaceState.selectedCategory ?? undefined, val || undefined);
    }, 300);
  }

  async function handleSync() {
    await syncFromGitHub();
  }
</script>

<div class="p-6 flex flex-col gap-6 min-h-full">
  <!-- Header -->
  <div class="flex items-center justify-between gap-4">
    <div>
      <h1 class="text-lg font-bold text-foreground">Agents</h1>
      <p class="text-xs text-muted mt-0.5">Browse and install pre-built AI agents</p>
    </div>

    <!-- Search -->
    <div class="relative flex-1 max-w-xs">
      <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted text-xs pointer-events-none">⌕</span>
      <input
        type="text"
        placeholder="Search agents…"
        value={searchInput}
        oninput={onSearchInput}
        class="w-full pl-7 pr-3 py-1.5 rounded-lg border border-border bg-bg2 text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-brand-pink/40 transition-colors"
      />
    </div>
  </div>

  <!-- Loading -->
  {#if marketplaceState.loading}
    <div class="flex items-center justify-center py-16 text-muted text-sm">
      <span class="animate-spin mr-2">↻</span>
      Loading agents…
    </div>

  <!-- Empty state -->
  {:else if marketplaceState.agents.length === 0}
    <div class="flex flex-col items-center justify-center py-20 gap-4 text-center">
      <div class="w-16 h-16 rounded-full bg-bg3 border border-border flex items-center justify-center text-2xl opacity-50">
        🤖
      </div>
      <div>
        <p class="text-sm font-medium text-foreground">No agents yet</p>
        <p class="text-xs text-muted mt-1">
          {#if marketplaceState.searchQuery || marketplaceState.selectedCategory}
            Try adjusting your filters
          {:else}
            Sync from GitHub to populate the marketplace
          {/if}
        </p>
      </div>
      {#if !marketplaceState.searchQuery && !marketplaceState.selectedCategory}
        <button
          type="button"
          onclick={handleSync}
          disabled={marketplaceState.syncing}
          class="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-pink/10 border border-brand-pink/30 text-brand-pink text-xs hover:bg-brand-pink/20 transition-colors disabled:opacity-50"
        >
          <span class={marketplaceState.syncing ? 'animate-spin' : ''}>↻</span>
          {marketplaceState.syncing ? 'Syncing…' : 'Sync from GitHub'}
        </button>
      {/if}
    </div>

  <!-- Grid -->
  {:else}
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {#each marketplaceState.agents as agent (agent.id)}
        <AgentCard {agent} />
      {/each}
    </div>
  {/if}
</div>
