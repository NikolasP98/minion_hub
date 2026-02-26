<script lang="ts">
  import Topbar from '$lib/components/Topbar.svelte';
  import { page } from '$app/stores';
  import {
    marketplaceState,
    loadAgents,
    syncFromGitHub,
  } from '$lib/state/marketplace.svelte';
  import AgentCreatorWizard from '$lib/components/marketplace/AgentCreatorWizard.svelte';
  import * as m from '$lib/paraglide/messages';

  import { type Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

  const categories = [
    { id: null, label: () => m.marketplace_agentsListCategoryAll() },
    { id: 'engineering', label: () => m.marketplace_agentsListCategoryEngineering() },
    { id: 'product', label: () => m.marketplace_agentsListCategoryProduct() },
    { id: 'data', label: () => m.marketplace_agentsListCategoryData() },
    { id: 'creative', label: () => m.marketplace_agentsListCategoryCreative() },
    { id: 'security', label: () => m.marketplace_agentsListCategorySecurity() },
  ];

  const sections = [
    { href: '/marketplace/agents', label: 'Agents', active: true },
    { href: '/marketplace/skills', label: 'Skills', active: false },
    { href: '/marketplace/tools', label: 'Tools', active: false },
    { href: '/marketplace/integrations', label: 'Integrations', active: false },
    { href: '/marketplace/plugins', label: 'Plugins', active: false },
  ];

  const currentPath = $derived($page.url.pathname);

  async function handleSync() {
    const result = await syncFromGitHub();
    if (result.errors.length > 0) {
      console.warn('[marketplace] sync errors:', result.errors);
    }
  }

  let showCreatorWizard = $state(false);

  async function selectCategory(id: string | null) {
    marketplaceState.selectedCategory = id;
    await loadAgents(id ?? undefined, marketplaceState.searchQuery || undefined);
  }
</script>

<div class="relative z-10 flex flex-col h-screen overflow-hidden">
  <Topbar />
  <div class="flex flex-1 overflow-hidden">
    <!-- Sidebar -->
    <aside class="w-[200px] shrink-0 border-r border-border flex flex-col overflow-y-auto bg-bg">
      <div class="px-4 pt-5 pb-2">
        <p class="text-[10px] font-semibold tracking-widest uppercase text-muted mb-2">{m.marketplace_browse()}</p>
        <nav class="flex flex-col gap-0.5">
          {#each sections as section (section.href)}
            <a
              href={section.href}
              class="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors duration-100 no-underline {currentPath.startsWith(section.href) ? 'bg-brand-pink/10 text-brand-pink font-medium' : section.active ? 'text-foreground hover:bg-bg3' : 'text-muted/50 cursor-not-allowed pointer-events-none'}"
            >
              {#if currentPath.startsWith(section.href)}
                <span class="w-1.5 h-1.5 rounded-full bg-brand-pink shrink-0"></span>
              {:else}
                <span class="w-1.5 h-1.5 rounded-full bg-transparent shrink-0"></span>
              {/if}
              {section.label}
              {#if !section.active}
                <span class="ml-auto text-[9px] text-muted/40 font-normal">{m.marketplace_comingSoon()}</span>
              {/if}
            </a>
          {/each}
        </nav>
      </div>

      <div class="px-4 pt-4 pb-2">
        <p class="text-[10px] font-semibold tracking-widest uppercase text-muted mb-2">{m.marketplace_filterBy()}</p>
        <nav class="flex flex-col gap-0.5">
          {#each categories as cat (cat.id ?? 'all')}
            <button
              type="button"
              onclick={() => selectCategory(cat.id)}
              class="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors duration-100 text-left w-full {marketplaceState.selectedCategory === cat.id ? 'bg-brand-pink/10 text-brand-pink font-medium' : 'text-foreground hover:bg-bg3'}"
            >
              {cat.label()}
            </button>
          {/each}
        </nav>
      </div>

      <div class="px-4 pt-4 pb-2">
        <button
          type="button"
          onclick={() => { showCreatorWizard = true; }}
          class="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border border-brand-pink/30 bg-brand-pink/5 text-xs text-brand-pink hover:bg-brand-pink/10 transition-all duration-150"
        >
          {m.marketplace_createAgentBtn()}
        </button>
      </div>

      <div class="mt-auto px-4 py-4 border-t border-border">
        <button
          type="button"
          onclick={handleSync}
          disabled={marketplaceState.syncing}
          class="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs text-muted hover:bg-bg3 hover:text-foreground transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span class="text-sm {marketplaceState.syncing ? 'animate-spin' : ''}">↻</span>
          {marketplaceState.syncing ? m.marketplace_syncing() : m.marketplace_syncBtn()}
        </button>
        {#if marketplaceState.syncError}
          <p class="text-[10px] text-red-400 mt-1.5 text-center">{marketplaceState.syncError}</p>
        {/if}
      </div>
    </aside>

    <!-- Main content -->
    <main class="flex-1 overflow-y-auto">
      {@render children()}
    </main>
  </div>
</div>

{#if showCreatorWizard}
  <AgentCreatorWizard onClose={() => { showCreatorWizard = false; }} />
{/if}
