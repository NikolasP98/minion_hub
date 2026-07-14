<script lang="ts">
  import { onDestroy } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { createDebouncer } from '$lib/pacer/index.svelte';
  import AgentCard from '$lib/components/marketplace/AgentCard.svelte';
  import { fetchAgents, type MarketplaceAgent } from '$lib/state/features/marketplace.svelte';
  import * as m from '$lib/paraglide/messages';
  import { Search, Grid3X3, List, X, Bot, Star } from 'lucide-svelte';
  import { diceBearAvatarUrl } from '$lib/utils/avatar';
  import { parseTags } from '$lib/state/features/marketplace.svelte';
  import { holo } from '$lib/actions/holo';
  import { Button, Input, PageHeader, Select } from '$lib/components/ui';
  import { AsyncBoundary, PageBody, PageShell } from '$lib/components/ui/foundations';

  // Search and filters
  let searchInput = $state('');
  // Debounced term feeds the queryKey — race-safe (stale in-flight responses
  // for a superseded term are just a different cache entry, never rendered).
  let debouncedTerm = $state('');
  const searchDebouncer = createDebouncer((v: string) => (debouncedTerm = v), { wait: 300 });
  onDestroy(() => searchDebouncer.cancel());

  let selectedCategory = $state<string | null>(null);
  let sortBy = $state<'popular' | 'newest' | 'name'>('popular');
  let featuredOnly = $state(false);
  let modelFilter = $state('');

  const sortOptions = [
    { value: 'popular' as const, label: () => m.marketplace_agentsListSortPopular() },
    { value: 'newest' as const, label: () => m.marketplace_agentsListSortNewest() },
    { value: 'name' as const, label: () => m.marketplace_agentsListSortName() },
  ];
  let viewMode = $state<'grid' | 'list'>('grid');

  // Quick category filters
  const categories = [
    { id: null, label: () => m.marketplace_agentsListCategoryAll() },
    { id: 'engineering', label: () => m.marketplace_agentsListCategoryEngineering() },
    { id: 'product', label: () => m.marketplace_agentsListCategoryProduct() },
    { id: 'data', label: () => m.marketplace_agentsListCategoryData() },
    { id: 'creative', label: () => m.marketplace_agentsListCategoryCreative() },
    { id: 'security', label: () => m.marketplace_agentsListCategorySecurity() },
  ] as const;

  const agentsQuery = createQuery(() => ({
    queryKey: ['marketplace', 'agents', selectedCategory, debouncedTerm],
    queryFn: () => fetchAgents(selectedCategory ?? undefined, debouncedTerm || undefined),
  }));

  function onSearchInput(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    searchInput = val;
    searchDebouncer.run(val);
  }

  function selectCategory(id: string | null) {
    selectedCategory = id;
  }

  function clearSearch() {
    searchInput = '';
    searchDebouncer.cancel();
    debouncedTerm = '';
  }

  // Sorted agents
  const sortedAgents = $derived.by(() => {
    let agents = [...(agentsQuery.data ?? [])];
    if (featuredOnly) agents = agents.filter((a) => (a.installCount ?? 0) >= 100);
    if (modelFilter) agents = agents.filter((a) => a.model?.toLowerCase().includes(modelFilter));
    switch (sortBy) {
      case 'popular':
        return agents.sort((a, b) => (b.installCount ?? 0) - (a.installCount ?? 0));
      case 'newest':
        return agents.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
      case 'name':
        return agents.sort((a, b) => a.name.localeCompare(b.name));
      default:
        return agents;
    }
  });

  const currentCategory = $derived(
    categories.find((c) => c.id === selectedCategory) ?? categories[0],
  );

  const sortSelectOptions = $derived(
    sortOptions.map((option) => ({ value: option.value, label: option.label() })),
  );
  const modelOptions = [
    { value: '', label: m.marketplace_agentsAnyModel() },
    { value: 'claude', label: 'Claude' },
    { value: 'gpt', label: 'GPT' },
    { value: 'llama', label: 'Llama' },
  ];
  const hasFilters = $derived(
    Boolean(searchInput || selectedCategory || featuredOnly || modelFilter),
  );

  function clearFilters() {
    clearSearch();
    selectedCategory = null;
    featuredOnly = false;
    modelFilter = '';
  }

  const pageState = $derived(
    agentsQuery.isPending
      ? { kind: 'loading' as const, label: m.marketplace_agentsListLoading() }
      : agentsQuery.isError
        ? {
            kind: 'error' as const,
            description:
              agentsQuery.error instanceof Error
                ? agentsQuery.error.message
                : String(agentsQuery.error),
            retry: () => agentsQuery.refetch(),
          }
        : sortedAgents.length === 0
          ? {
              kind: 'empty' as const,
              title: m.marketplace_agentsListEmpty(),
              description: hasFilters
                ? m.marketplace_agentsListEmptyHint()
                : m.marketplace_agentsListEmptySync(),
            }
          : { kind: 'ready' as const },
  );

  function formatInstallCount(n: number | null): string {
    const count = n ?? 0;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
    return String(count);
  }
</script>

<PageShell archetype="collection" scroll="region" labelledBy="marketplace-agents-title">
  <PageHeader
    title={m.marketplace_agents()}
    subtitle={m.marketplace_agentsSubtitle()}
    titleId="marketplace-agents-title"
  >
    {#snippet leading()}<Bot size={15} class="text-[var(--color-brand-pink)] shrink-0" />{/snippet}
    {#snippet secondaryActions()}
      <Input
        type="search"
        size="sm"
        placeholder={m.marketplace_agentsListSearchPlaceholder()}
        value={searchInput}
        oninput={onSearchInput}
        class="w-48"
      >
        {#snippet leading()}<Search size={12} />{/snippet}
        {#if searchInput}
          {#snippet trailing()}
            <Button
              variant="ghost"
              size="icon"
              onclick={clearSearch}
              aria-label={m.builder_clear()}
            >
              <X size={11} />
            </Button>
          {/snippet}
        {/if}
      </Input>
      <Select bind:value={sortBy} options={sortSelectOptions} size="sm" class="w-36" />
      <div class="flex gap-1" role="group" aria-label={m.marketplace_agentsListGridView()}>
        <Button
          variant={viewMode === 'grid' ? 'primary' : 'ghost'}
          size="icon"
          onclick={() => (viewMode = 'grid')}
          aria-label={m.marketplace_agentsListGridView()}
          aria-pressed={viewMode === 'grid'}><Grid3X3 size={12} /></Button
        >
        <Button
          variant={viewMode === 'list' ? 'primary' : 'ghost'}
          size="icon"
          onclick={() => (viewMode = 'list')}
          aria-label={m.marketplace_agentsListListView()}
          aria-pressed={viewMode === 'list'}><List size={12} /></Button
        >
      </div>
    {/snippet}
  </PageHeader>

  <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
    <Button
      variant={featuredOnly ? 'primary' : 'secondary'}
      size="sm"
      onclick={() => (featuredOnly = !featuredOnly)}
      aria-pressed={featuredOnly}><Star size={10} />{m.marketplace_agentsFeatured()}</Button
    >
    <Select bind:value={modelFilter} options={modelOptions} size="xs" class="w-32" />
    <div
      class="ml-auto flex max-w-full gap-1.5 overflow-x-auto [scrollbar-width:none]"
      role="group"
      aria-label={m.marketplace_agents()}
    >
      {#each categories as cat (cat.id ?? 'all')}
        <Button
          variant={selectedCategory === cat.id ? 'primary' : 'secondary'}
          size="sm"
          class="rounded-full"
          onclick={() => selectCategory(cat.id)}
          aria-pressed={selectedCategory === cat.id}>{cat.label()}</Button
        >
      {/each}
    </div>
  </div>

  <PageBody padding="compact" scroll="region">
    <AsyncBoundary state={pageState}>
      <!-- Results count -->
      <p class="text-xs text-muted-foreground mb-3">
        {m.marketplace_agentsListShowing({ count: (agentsQuery.data ?? []).length })}
        {#if currentCategory.id}
          {m.marketplace_agentsListShowingIn({ category: currentCategory.label() })}
        {/if}
      </p>

      <!-- Agent Grid/List -->
      <div class="agent-container" class:list={viewMode === 'list'}>
        {#if viewMode === 'grid'}
          {#each sortedAgents as agent (agent.id)}
            <AgentCard {agent} />
          {/each}
        {:else}
          {#each sortedAgents as agent (agent.id)}
            {@const tags = parseTags(agent.tags)}
            <div class="list-item" use:holo>
              <!-- Mini ID Card -->
              <div class="list-card-wrap">
                <div class="list-badge-clip">
                  <div class="clip-base"></div>
                  <div class="clip-ring"></div>
                </div>
                <div class="list-card">
                  <!-- Holo layers -->
                  <div class="lc-glare" aria-hidden="true"></div>
                  <div class="lc-sheen" aria-hidden="true"></div>
                  <div class="list-card-header">
                    <span class="list-initials">{agent.name.slice(0, 2).toUpperCase()}</span>
                  </div>
                  <div class="list-photo">
                    <img
                      src={diceBearAvatarUrl(agent.avatarSeed, agent.archetype ?? 'copilot')}
                      alt={agent.name}
                    />
                  </div>
                  <div class="list-card-footer">
                    <span class="list-brand">MINION</span>
                  </div>
                </div>
                <!-- end list-card -->
              </div>
              <!-- end list-card-wrap -->

              <!-- Details -->
              <div class="list-details">
                <div class="list-main">
                  <div class="list-info">
                    <h3 class="list-name">{agent.name}</h3>
                    <p class="list-role">{agent.role}</p>
                    {#if agent.catchphrase}
                      <p class="list-tagline">"{agent.catchphrase}"</p>
                    {/if}
                    <div class="list-tags">
                      <span class="list-category">{agent.category}</span>
                      {#each tags.slice(0, 3) as tag (tag)}
                        <span class="list-tag">{tag}</span>
                      {/each}
                    </div>
                  </div>

                  <div class="list-stats">
                    <div class="list-stat">
                      <span class="stat-number">{formatInstallCount(agent.installCount)}</span>
                      <span class="stat-label">{m.marketplace_agentsListHires()}</span>
                    </div>
                    <div class="list-stat">
                      <span class="stat-number">v{agent.version}</span>
                      <span class="stat-label">{m.marketplace_agentsListVersion()}</span>
                    </div>
                  </div>
                </div>

                <div class="list-description">
                  <p>{agent.description}</p>
                </div>

                <div class="list-actions">
                  <Button href="/marketplace/agents/{agent.id}" variant="secondary" size="sm"
                    >{m.marketplace_agentsListViewProfile()}</Button
                  >
                  <Button href="/marketplace/agents/{agent.id}?tab=hire" variant="primary" size="sm"
                    >{m.marketplace_agentsListHireMe()}</Button
                  >
                </div>
              </div>
            </div>
          {/each}
        {/if}
      </div>
      {#snippet emptyAction()}
        {#if hasFilters}
          <Button variant="secondary" size="sm" onclick={clearFilters}>
            {m.marketplace_agentsListClearFilters()}
          </Button>
        {/if}
      {/snippet}
    </AsyncBoundary>
  </PageBody>
</PageShell>

<style>
  /* Agent Container - Grid View */
  .agent-container {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 20px;
  }

  /* Agent Container - List View */
  .agent-container.list {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* List Item */
  .list-item {
    display: flex;
    gap: 20px;
    padding: 16px;
    background: var(--color-bg2);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    transition: border-color var(--duration-fast) var(--ease-standard);
  }

  .list-item:hover {
    border-color: color-mix(in srgb, var(--color-brand-pink) 30%, transparent);
  }

  /* Wrapper: flex column so clip stacks above card */
  .list-card-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex-shrink: 0;
  }

  /* Mini ID Card in List View */
  .list-card {
    width: 140px;
    background: linear-gradient(145deg, rgba(250, 250, 250, 0.98), rgba(240, 240, 242, 0.95));
    border-radius: 10px;
    padding: 12px;
    padding-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    position: relative;
    overflow: hidden;
  }

  /* Clip sits above card as a flex item; negative margin pulls card up
       so the clip's bottom half overlaps the card top edge */
  .list-badge-clip {
    position: relative;
    z-index: 10;
    margin-bottom: -11px; /* half of clip height (21px) → 50/50 straddle */
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .list-badge-clip .clip-base {
    width: 28px;
    height: 16px;
    background: linear-gradient(145deg, #3a3a3c, #1c1c1e);
    border-radius: 3px 3px 0 0;
    border: 1px solid #48484a;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.1),
      0 2px 4px rgba(0, 0, 0, 0.4);
  }

  .list-badge-clip .clip-ring {
    width: 16px;
    height: 6px;
    background: linear-gradient(145deg, #48484a, #2c2c2e);
    border-radius: 0 0 8px 8px;
    border: 1px solid #5a5a5c;
    margin-top: -1px;
  }

  .list-card-header {
    background: linear-gradient(90deg, #1c1c1e, #2c2c2e);
    border-radius: 6px;
    padding: 6px 10px;
  }

  .list-initials {
    font-family: 'JetBrains Mono NF', monospace;
    font-weight: 700;
    font-size: var(--font-size-caption, 12px);
    color: #fafafa;
    letter-spacing: 0.1em;
  }

  .list-photo {
    width: 100%;
    aspect-ratio: 1;
    background: #ffffff;
    border-radius: 8px;
    padding: 4px;
  }

  .list-photo img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 4px;
  }

  .list-card-footer {
    margin-top: auto;
    padding-top: 8px;
    border-top: 1px dashed rgba(0, 0, 0, 0.15);
  }

  /* List-brand text — dark with pink fading underline */
  .list-brand {
    font-family: 'JetBrains Mono NF', monospace;
    font-weight: 800;
    font-size: var(--font-size-caption, 12px);
    letter-spacing: 0.05em;
    color: #18181b;
    display: inline-block;
    position: relative;
  }

  .list-brand::after {
    content: '';
    position: absolute;
    left: 0;
    bottom: -2px;
    width: 100%;
    height: 2px;
    background: linear-gradient(90deg, var(--color-brand-pink), transparent);
    opacity: 0.85;
  }

  /* List Details */
  .list-details {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }

  .list-main {
    display: flex;
    justify-content: space-between;
    gap: 16px;
  }

  .list-info {
    flex: 1;
    min-width: 0;
  }

  .list-name {
    font-size: var(--font-size-section-title, 16px);
    font-weight: 700;
    color: var(--color-foreground);
    margin: 0 0 4px;
  }

  .list-role {
    font-size: var(--font-size-body, 14px);
    color: var(--color-muted);
    margin: 0 0 8px;
    font-weight: 500;
  }

  .list-tagline {
    font-size: var(--font-size-caption, 12px);
    color: var(--color-brand-pink);
    font-style: italic;
    margin: 0 0 12px;
  }

  .list-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .list-category {
    padding: 3px 10px;
    background: color-mix(in srgb, var(--color-brand-pink) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-brand-pink) 25%, transparent);
    border-radius: 12px;
    color: var(--color-brand-pink);
    font-size: var(--font-size-caption, 12px);
    font-weight: 600;
    text-transform: capitalize;
  }

  .list-tag {
    padding: 3px 10px;
    background: var(--color-bg3);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    color: var(--color-muted);
    font-size: var(--font-size-caption, 12px);
  }

  .list-stats {
    display: flex;
    flex-direction: column;
    gap: 12px;
    text-align: right;
  }

  .list-stat {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }

  .stat-number {
    font-size: var(--font-size-body, 14px);
    font-weight: 700;
    color: var(--color-foreground);
    font-family: 'JetBrains Mono NF', monospace;
  }

  .stat-label {
    font-size: var(--font-size-caption, 12px);
    color: var(--color-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .list-description {
    font-size: var(--font-size-body, 14px);
    line-height: 1.6;
    color: var(--color-muted);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .list-description p {
    margin: 0;
  }

  .list-actions {
    display: flex;
    gap: 10px;
    margin-top: auto;
  }

  /* Responsive */
  @media (max-width: 768px) {
    .agent-container {
      grid-template-columns: 1fr;
    }

    .list-item {
      flex-direction: column;
      gap: 16px;
    }

    .list-card-wrap {
      width: 100%;
    }

    .list-card {
      width: 100%;
      flex-direction: row;
      align-items: center;
      padding: 12px 16px;
    }

    .list-photo {
      width: 48px;
      height: 48px;
    }

    .list-card-header,
    .list-card-footer {
      margin: 0;
      padding: 0;
      border: none;
      background: transparent;
    }

    .list-main {
      flex-direction: column;
      gap: 12px;
    }

    .list-stats {
      flex-direction: row;
      justify-content: flex-start;
      text-align: left;
    }

    .list-stat {
      align-items: flex-start;
    }
  }

  /* ── List-card holographic effect ───────────────────────────── */

  /* Register typed CSS vars for smooth interpolation (global at-rules) */
  @property --mx {
    syntax: '<number>';
    inherits: true;
    initial-value: 0.5;
  }
  @property --my {
    syntax: '<number>';
    inherits: true;
    initial-value: 0.5;
  }

  /* Graceful snap-back on leave (slow) */
  .list-item {
    transition:
      --mx 0.45s ease-out,
      --my 0.45s ease-out;
  }
  /* Responsive tracking on hover (fast) */
  :global(.list-item.holo-active) {
    transition:
      --mx 0.1s ease-out,
      --my 0.1s ease-out;
  }

  /* Transform on the wrapper so clip and card rotate together */
  .list-card-wrap {
    transform: perspective(600px) rotateX(calc((0.5 - var(--my, 0.5)) * 8deg))
      rotateY(calc((var(--mx, 0.5) - 0.5) * 8deg));
  }

  /* "MINION" watermark — behind card content, above card background */
  .list-card::before {
    content: 'MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  ';
    position: absolute;
    inset: 0;
    font-family: 'JetBrains Mono NF', monospace;
    font-size: var(--font-size-caption, 12px);
    font-weight: 700;
    letter-spacing: 0.04em;
    word-spacing: 1.8em;
    line-height: 5;
    background: linear-gradient(
      calc(110deg + var(--my, 0.5) * 60deg),
      hsl(calc(var(--mx, 0.5) * 300deg + 160deg) 70% 48%),
      hsl(calc(var(--mx, 0.5) * 300deg + 240deg) 72% 52%),
      hsl(calc(var(--mx, 0.5) * 300deg + 320deg) 70% 48%)
    );
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    opacity: calc(0.12 + abs(var(--mx, 0.5) - 0.5) * 0.55 + abs(var(--my, 0.5) - 0.5) * 0.55);
    transform: rotate(-45deg) scale(1.8);
    transform-origin: center;
    word-break: break-all;
    pointer-events: none;
    z-index: 2;
  }

  .lc-glare {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    z-index: 2;
    background: radial-gradient(
      ellipse 60% 50% at calc(var(--mx, 0.5) * 100%) calc(var(--my, 0.5) * 100%),
      rgba(255, 255, 255, 0.35),
      transparent 70%
    );
    mix-blend-mode: overlay;
    opacity: 0;
    transition: opacity var(--duration-slow) var(--ease-standard);
  }

  :global(.list-item.holo-active) .lc-glare {
    opacity: 0.6;
  }

  .lc-sheen {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    z-index: 15;
    background: linear-gradient(
      calc(115deg + var(--my, 0.5) * 20deg),
      transparent,
      transparent calc(var(--mx, 0.5) * 100% - 22%),
      rgba(255, 255, 255, 0.08) calc(var(--mx, 0.5) * 100% - 10%),
      rgba(255, 255, 255, 0.38) calc(var(--mx, 0.5) * 100%),
      rgba(255, 255, 255, 0.08) calc(var(--mx, 0.5) * 100% + 10%),
      transparent calc(var(--mx, 0.5) * 100% + 22%),
      transparent
    );
    mix-blend-mode: overlay;
    opacity: 0;
    transition: opacity var(--duration-slow) var(--ease-standard);
  }

  :global(.list-item.holo-active) .lc-sheen {
    opacity: 1;
  }

  /* Ensure list-card content sits above holo overlays but below sheen */
  .list-badge-clip,
  .list-card-header,
  .list-photo,
  .list-card-footer {
    position: relative;
    z-index: 3;
  }
</style>
