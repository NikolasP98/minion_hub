<script lang="ts">
    import { onMount } from "svelte";
    import AgentCard from "$lib/components/marketplace/AgentCard.svelte";
    import {
        marketplaceState,
        loadAgents,
        type MarketplaceAgent,
    } from "$lib/state/marketplace.svelte";
    import * as m from "$lib/paraglide/messages";
    import { Search, Grid3X3, List, X, Store, Bot, Star } from "lucide-svelte";
    import { diceBearAvatarUrl } from "$lib/utils/avatar";
    import { parseTags } from "$lib/state/marketplace.svelte";

    // Search and filters
    let searchInput = $state("");
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    let sortBy = $state<"popular" | "newest" | "name">("popular");
    let featuredOnly = $state(false);
    let modelFilter = $state('');

    const sortOptions = [
        { value: "popular" as const, label: () => m.marketplace_agentsListSortPopular() },
        { value: "newest" as const, label: () => m.marketplace_agentsListSortNewest() },
        { value: "name" as const, label: () => m.marketplace_agentsListSortName() },
    ];
    let viewMode = $state<"grid" | "list">("grid");

    // Quick category filters
    const categories = [
        { id: null, label: "All" },
        { id: "engineering", label: "Engineering" },
        { id: "product", label: "Product" },
        { id: "data", label: "Data" },
        { id: "creative", label: "Creative" },
        { id: "security", label: "Security" },
    ] as const;

    onMount(() => {
        loadAgents(marketplaceState.selectedCategory ?? undefined);
    });

    function onSearchInput(e: Event) {
        const val = (e.target as HTMLInputElement).value;
        searchInput = val;
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            marketplaceState.searchQuery = val;
            loadAgents(
                marketplaceState.selectedCategory ?? undefined,
                val || undefined,
            );
        }, 300);
    }

    function selectCategory(id: string | null) {
        marketplaceState.selectedCategory = id;
        loadAgents(id ?? undefined, searchInput || undefined);
    }

    function clearSearch() {
        searchInput = "";
        marketplaceState.searchQuery = "";
        loadAgents(marketplaceState.selectedCategory ?? undefined);
    }

    // Sorted agents
    const sortedAgents = $derived.by(() => {
        let agents = [...marketplaceState.agents];
        if (featuredOnly) agents = agents.filter(a => (a.installCount ?? 0) >= 100);
        if (modelFilter) agents = agents.filter(a => a.model?.toLowerCase().includes(modelFilter));
        switch (sortBy) {
            case "popular":
                return agents.sort(
                    (a, b) => (b.installCount ?? 0) - (a.installCount ?? 0),
                );
            case "newest":
                return agents.sort((a, b) => b.createdAt - a.createdAt);
            case "name":
                return agents.sort((a, b) => a.name.localeCompare(b.name));
            default:
                return agents;
        }
    });

    const currentCategory = $derived(
        categories.find((c) => c.id === marketplaceState.selectedCategory) ??
            categories[0],
    );

    function formatInstallCount(n: number | null): string {
        const count = n ?? 0;
        if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
        return String(count);
    }
</script>

<div class="flex flex-col min-h-full">
    <!-- Compact sticky toolbar header -->
    <header class="sticky top-0 z-10 shrink-0 flex flex-col border-b border-border bg-bg2/80 backdrop-blur-sm">
        <!-- Primary row: title + controls -->
        <div class="flex items-center gap-3 px-4 py-2.5">
            <Store size={13} class="text-[var(--color-brand-pink)] shrink-0" />
            <h1 class="text-sm font-semibold tracking-tight">{m.marketplace_agents()}</h1>
            {#if sortedAgents.length > 0}
                <span class="text-[10px] bg-bg3 text-muted-foreground border border-border rounded-full px-1.5 leading-5 tabular-nums">{sortedAgents.length}</span>
            {/if}
            <span class="text-[11px] text-muted-foreground/70 hidden md:block truncate">{m.marketplace_agentsSubtitle()}</span>
            <div class="flex-1"></div>

            <!-- Search -->
            <div class="relative flex items-center">
                <Search size={12} class="absolute left-2.5 text-muted-foreground pointer-events-none shrink-0" />
                <input
                    type="text"
                    placeholder={m.marketplace_agentsListSearchPlaceholder()}
                    value={searchInput}
                    oninput={onSearchInput}
                    class="text-[11px] pl-7 pr-6 py-1 h-7 w-44 bg-bg3 text-foreground border border-border rounded-md placeholder:text-muted-foreground focus:outline-none focus:border-[var(--color-brand-pink)] [color-scheme:dark] transition-colors"
                />
                {#if searchInput}
                    <button
                        type="button"
                        class="absolute right-2 text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                        onclick={clearSearch}
                    >
                        <X size={11} />
                    </button>
                {/if}
            </div>

            <!-- Sort -->
            <select
                bind:value={sortBy}
                class="text-[11px] h-7 py-0 px-2 bg-bg3 text-foreground border border-border rounded-md focus:outline-none focus:border-[var(--color-brand-pink)] [color-scheme:dark] cursor-pointer transition-colors"
            >
                {#each sortOptions as opt (opt.value)}
                    <option value={opt.value}>{opt.label()}</option>
                {/each}
            </select>

            <!-- View toggle -->
            <div class="flex gap-0.5 p-0.5 bg-bg3 border border-border rounded-md">
                <button
                    type="button"
                    onclick={() => (viewMode = "grid")}
                    aria-label={m.marketplace_agentsListGridView()}
                    class="w-6 h-6 flex items-center justify-center rounded cursor-pointer transition-colors
                        {viewMode === 'grid'
                            ? 'bg-[color-mix(in_srgb,var(--color-brand-pink)_15%,transparent)] text-[var(--color-brand-pink)]'
                            : 'text-muted-foreground hover:text-foreground'}"
                >
                    <Grid3X3 size={12} />
                </button>
                <button
                    type="button"
                    onclick={() => (viewMode = "list")}
                    aria-label={m.marketplace_agentsListListView()}
                    class="w-6 h-6 flex items-center justify-center rounded cursor-pointer transition-colors
                        {viewMode === 'list'
                            ? 'bg-[color-mix(in_srgb,var(--color-brand-pink)_15%,transparent)] text-[var(--color-brand-pink)]'
                            : 'text-muted-foreground hover:text-foreground'}"
                >
                    <List size={12} />
                </button>
            </div>
        </div>

        <!-- Filter row: new controls left, pills right -->
        <div class="flex items-center gap-2 px-4 pb-2.5">
            <!-- Featured toggle -->
            <button
                type="button"
                onclick={() => (featuredOnly = !featuredOnly)}
                class="text-[11px] py-0.5 px-2.5 rounded-md border whitespace-nowrap cursor-pointer transition-colors flex items-center gap-1.5
                    {featuredOnly
                        ? 'bg-[color-mix(in_srgb,var(--color-warning)_15%,transparent)] border-[color-mix(in_srgb,var(--color-warning)_30%,transparent)] text-[var(--color-warning)]'
                        : 'bg-bg3 border-border text-muted-foreground hover:text-foreground'}"
            >
                <Star size={10} />
                Featured
            </button>

            <!-- Model filter -->
            <select
                bind:value={modelFilter}
                class="text-[11px] h-6 py-0 px-2 bg-bg3 text-muted-foreground border border-border rounded-md focus:outline-none [color-scheme:dark] cursor-pointer transition-colors hover:text-foreground"
            >
                <option value="">Any Model</option>
                <option value="claude">Claude</option>
                <option value="gpt">GPT</option>
                <option value="llama">Llama</option>
            </select>

            <div class="flex-1"></div>

            <!-- Category pills (right-aligned) -->
            <div class="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
                {#each categories as cat (cat.id ?? "all")}
                    <button
                        type="button"
                        onclick={() => selectCategory(cat.id)}
                        class="text-[11px] py-0.5 px-2.5 rounded-full border whitespace-nowrap cursor-pointer transition-colors
                            {marketplaceState.selectedCategory === cat.id
                                ? 'bg-[color-mix(in_srgb,var(--color-brand-pink)_15%,transparent)] border-[color-mix(in_srgb,var(--color-brand-pink)_30%,transparent)] text-[var(--color-brand-pink)]'
                                : 'bg-bg3 border-border text-muted-foreground hover:text-foreground hover:border-border/80'}"
                    >
                        {cat.label}
                    </button>
                {/each}
            </div>
        </div>
    </header>

    <!-- Content area -->
    <div class="flex-1 p-4">
        {#if marketplaceState.loading}
            <!-- Loading State -->
            <div class="flex flex-col items-center justify-center py-24 gap-3">
                <div class="w-6 h-6 border-2 border-[var(--color-brand-pink)] border-t-transparent rounded-full animate-spin"></div>
                <p class="text-muted-foreground text-xs">{m.marketplace_agentsListLoading()}</p>
            </div>
        {:else if marketplaceState.agents.length === 0}
            <!-- Empty State -->
            <div class="flex flex-col items-center justify-center py-24 gap-3 text-center">
                <Bot size={32} class="text-muted-foreground/30" />
                <div>
                    <h3 class="text-sm font-semibold text-foreground mb-1">{m.marketplace_agentsListEmpty()}</h3>
                    <p class="text-xs text-muted-foreground">
                        {#if searchInput || marketplaceState.selectedCategory}
                            {m.marketplace_agentsListEmptyHint()}
                        {:else}
                            {m.marketplace_agentsListEmptySync()}
                        {/if}
                    </p>
                </div>
                {#if searchInput || marketplaceState.selectedCategory}
                    <button
                        type="button"
                        onclick={() => {
                            searchInput = "";
                            marketplaceState.searchQuery = "";
                            selectCategory(null);
                        }}
                        class="text-xs px-3 py-1.5 bg-bg3 border border-border rounded-md text-muted-foreground hover:text-foreground hover:bg-border cursor-pointer transition-colors"
                    >
                        {m.marketplace_agentsListClearFilters()}
                    </button>
                {/if}
            </div>
        {:else}
            <!-- Results count -->
            <p class="text-[11px] text-muted-foreground mb-3">
                {m.marketplace_agentsListShowing({ count: marketplaceState.agents.length })}
                {#if currentCategory.id}
                    {m.marketplace_agentsListShowingIn({ category: currentCategory.label })}
                {/if}
            </p>

            <!-- Agent Grid/List -->
            <div class="agent-container" class:list={viewMode === "list"}>
                {#if viewMode === "grid"}
                    {#each sortedAgents as agent (agent.id)}
                        <AgentCard {agent} />
                    {/each}
                {:else}
                    {#each sortedAgents as agent (agent.id)}
                        {@const tags = parseTags(agent.tags)}
                        <div class="list-item">
                            <!-- Mini ID Card -->
                            <div class="list-card">
                                <div class="list-badge-clip">
                                    <div class="clip-base"></div>
                                    <div class="clip-ring"></div>
                                </div>
                                <div class="list-card-header">
                                    <span class="list-initials">{agent.name.slice(0, 2).toUpperCase()}</span>
                                </div>
                                <div class="list-photo">
                                    <img src={diceBearAvatarUrl(agent.avatarSeed)} alt={agent.name} />
                                </div>
                                <div class="list-card-footer">
                                    <span class="list-brand">MINION</span>
                                </div>
                            </div>

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
                                    <a href="/marketplace/agents/{agent.id}" class="btn-secondary">{m.marketplace_agentsListViewProfile()}</a>
                                    <a href="/marketplace/agents/{agent.id}?tab=hire" class="btn-primary">{m.marketplace_agentsListHireMe()}</a>
                                </div>
                            </div>
                        </div>
                    {/each}
                {/if}
            </div>
        {/if}
    </div>
</div>

<style>
    /* Agent Container - Grid View */
    .agent-container {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
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
        transition: border-color 0.15s ease;
    }

    .list-item:hover {
        border-color: color-mix(in srgb, var(--color-brand-pink) 30%, transparent);
    }

    /* Mini ID Card in List View */
    .list-card {
        width: 140px;
        flex-shrink: 0;
        background: linear-gradient(145deg, rgba(250, 250, 250, 0.98), rgba(240, 240, 242, 0.95));
        border-radius: 10px;
        padding: 12px;
        padding-top: 18px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        position: relative;
    }

    .list-badge-clip {
        position: absolute;
        top: -6px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 10;
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
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 2px 4px rgba(0, 0, 0, 0.4);
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
        font-family: "JetBrains Mono NF", monospace;
        font-weight: 700;
        font-size: 10px;
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

    .list-brand {
        font-family: "JetBrains Mono NF", monospace;
        font-weight: 800;
        font-size: 12px;
        color: #18181b;
        letter-spacing: 0.05em;
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

    .list-info { flex: 1; min-width: 0; }

    .list-name {
        font-size: 16px;
        font-weight: 700;
        color: var(--color-foreground);
        margin: 0 0 4px;
    }

    .list-role {
        font-size: 13px;
        color: var(--color-muted);
        margin: 0 0 8px;
        font-weight: 500;
    }

    .list-tagline {
        font-size: 12px;
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
        font-size: 10px;
        font-weight: 600;
        text-transform: capitalize;
    }

    .list-tag {
        padding: 3px 10px;
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
        border-radius: 12px;
        color: var(--color-muted);
        font-size: 10px;
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
        font-size: 14px;
        font-weight: 700;
        color: var(--color-foreground);
        font-family: "JetBrains Mono NF", monospace;
    }

    .stat-label {
        font-size: 10px;
        color: var(--color-muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .list-description {
        font-size: 13px;
        line-height: 1.6;
        color: var(--color-muted);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    .list-description p { margin: 0; }

    .list-actions {
        display: flex;
        gap: 10px;
        margin-top: auto;
    }

    .btn-secondary {
        padding: 8px 16px;
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-muted);
        font-size: 12px;
        font-weight: 500;
        text-decoration: none;
        transition: all 0.15s ease;
    }

    .btn-secondary:hover {
        background: var(--color-border);
        color: var(--color-foreground);
    }

    .btn-primary {
        padding: 8px 16px;
        background: var(--color-brand-pink);
        border: none;
        border-radius: 6px;
        color: white;
        font-size: 12px;
        font-weight: 600;
        text-decoration: none;
        transition: all 0.15s ease;
    }

    .btn-primary:hover {
        opacity: 0.9;
        transform: translateY(-1px);
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
</style>
