<script lang="ts">
    import { onMount } from "svelte";
    import AgentCard from "$lib/components/marketplace/AgentCard.svelte";
    import {
        marketplaceState,
        loadAgents,
        type MarketplaceAgent,
    } from "$lib/state/marketplace.svelte";
    import * as m from "$lib/paraglide/messages";
    import { Search, Grid3X3, List, X } from "lucide-svelte";
    import { diceBearAvatarUrl } from "$lib/utils/avatar";
    import { parseTags } from "$lib/state/marketplace.svelte";

    // Search and filters
    let searchInput = $state("");
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    let sortBy = $state<"popular" | "newest" | "name">("popular");

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

    // Sorted agents
    const sortedAgents = $derived.by(() => {
        const agents = [...marketplaceState.agents];
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

<div class="marketplace-page">
    <!-- Header -->
    <div class="page-header">
        <div class="header-content">
            <h1 class="page-title">{m.marketplace_agents()}</h1>
            <p class="page-subtitle">{m.marketplace_agentsSubtitle()}</p>
        </div>
    </div>

    <!-- Filters Section -->
    <div class="filters-section">
        <!-- Search -->
        <div class="search-box">
            <Search size={16} class="search-icon" />
            <input
                type="text"
                placeholder={m.marketplace_agentsListSearchPlaceholder()}
                value={searchInput}
                oninput={onSearchInput}
                class="search-input"
            />
            {#if searchInput}
                <button
                    type="button"
                    class="clear-btn"
                    onclick={() => {
                        searchInput = "";
                        marketplaceState.searchQuery = "";
                        loadAgents(
                            marketplaceState.selectedCategory ?? undefined,
                        );
                    }}
                >
                    <X size={14} />
                </button>
            {/if}
        </div>

        <!-- Category Pills -->
        <div class="category-pills">
            {#each categories as cat (cat.id ?? "all")}
                <button
                    type="button"
                    class="category-pill"
                    class:active={marketplaceState.selectedCategory === cat.id}
                    onclick={() => selectCategory(cat.id)}
                >
                    {cat.label}
                </button>
            {/each}
        </div>

        <!-- Toolbar -->
        <div class="toolbar">
            <div class="results-count">
                {m.marketplace_agentsListShowing({ count: marketplaceState.agents.length })}
                {#if currentCategory.id}
                    {m.marketplace_agentsListShowingIn({ category: currentCategory.label })}
                {/if}
            </div>

            <div class="toolbar-controls">
                <select bind:value={sortBy} class="sort-select">
                    {#each sortOptions as opt (opt.value)}
                        <option value={opt.value}>{opt.label()}</option>
                    {/each}
                </select>

                <div class="view-toggle">
                    <button
                        type="button"
                        class="view-btn"
                        class:active={viewMode === "grid"}
                        onclick={() => (viewMode = "grid")}
                        aria-label={m.marketplace_agentsListGridView()}
                    >
                        <Grid3X3 size={16} />
                    </button>
                    <button
                        type="button"
                        class="view-btn"
                        class:active={viewMode === "list"}
                        onclick={() => (viewMode = "list")}
                        aria-label={m.marketplace_agentsListListView()}
                    >
                        <List size={16} />
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- Content -->
    <div class="content-area">
        {#if marketplaceState.loading}
            <!-- Loading State -->
            <div class="loading-state">
                <div class="loading-spinner">
                    <div class="spinner-ring"></div>
                    <div class="spinner-ring"></div>
                </div>
                <p class="loading-text">{m.marketplace_agentsListLoading()}</p>
            </div>
        {:else if marketplaceState.agents.length === 0}
            <!-- Empty State -->
            <div class="empty-state">
                <div class="empty-icon">🤖</div>
                <h3 class="empty-title">{m.marketplace_agentsListEmpty()}</h3>
                <p class="empty-message">
                    {#if searchInput || marketplaceState.selectedCategory}
                        {m.marketplace_agentsListEmptyHint()}
                    {:else}
                        {m.marketplace_agentsListEmptySync()}
                    {/if}
                </p>
                {#if searchInput || marketplaceState.selectedCategory}
                    <button
                        type="button"
                        onclick={() => {
                            searchInput = "";
                            marketplaceState.searchQuery = "";
                            selectCategory(null);
                        }}
                        class="clear-filters-btn"
                    >
                        {m.marketplace_agentsListClearFilters()}
                    </button>
                {/if}
            </div>
        {:else}
            <!-- Agent Grid/List -->
            <div class="agent-container" class:list={viewMode === "list"}>
                {#if viewMode === "grid"}
                    <!-- Grid View -->
                    {#each sortedAgents as agent (agent.id)}
                        <AgentCard {agent} />
                    {/each}
                {:else}
                    <!-- List View -->
                    {#each sortedAgents as agent (agent.id)}
                        {@const tags = parseTags(agent.tags)}
                        <div class="list-item">
                            <!-- Mini ID Card on the left -->
                            <!-- Mini ID Card in List View -->
                            <div class="list-card">
                                <!-- Badge Clip -->
                                <div class="list-badge-clip">
                                    <div class="clip-base"></div>
                                    <div class="clip-ring"></div>
                                </div>
                                <div class="list-card-header">
                                    <span class="list-initials"
                                        >{agent.name
                                            .slice(0, 2)
                                            .toUpperCase()}</span
                                    >
                                </div>
                                <div class="list-photo">
                                    <img
                                        src={diceBearAvatarUrl(
                                            agent.avatarSeed,
                                        )}
                                        alt={agent.name}
                                    />
                                </div>
                                <div class="list-card-footer">
                                    <span class="list-brand">MINION</span>
                                </div>
                            </div>

                            <!-- Details on the right -->
                            <div class="list-details">
                                <div class="list-main">
                                    <div class="list-info">
                                        <h3 class="list-name">{agent.name}</h3>
                                        <p class="list-role">{agent.role}</p>
                                        {#if agent.catchphrase}
                                            <p class="list-tagline">
                                                "{agent.catchphrase}"
                                            </p>
                                        {/if}
                                        <div class="list-tags">
                                            <span class="list-category"
                                                >{agent.category}</span
                                            >
                                            {#each tags.slice(0, 3) as tag (tag)}
                                                <span class="list-tag"
                                                    >{tag}</span
                                                >
                                            {/each}
                                        </div>
                                    </div>

                                    <div class="list-stats">
                                        <div class="list-stat">
                                            <span class="stat-number"
                                                >{formatInstallCount(
                                                    agent.installCount,
                                                )}</span
                                            >
                                            <span class="stat-label">{m.marketplace_agentsListHires()}</span
                                            >
                                        </div>
                                        <div class="list-stat">
                                            <span class="stat-number"
                                                >v{agent.version}</span
                                            >
                                            <span class="stat-label"
                                                >{m.marketplace_agentsListVersion()}</span
                                            >
                                        </div>
                                    </div>
                                </div>

                                <div class="list-description">
                                    <p>{agent.description}</p>
                                </div>

                                <div class="list-actions">
                                    <a
                                        href="/marketplace/agents/{agent.id}"
                                        class="btn-secondary">{m.marketplace_agentsListViewProfile()}</a
                                    >
                                    <a
                                        href="/marketplace/agents/{agent.id}?tab=hire"
                                        class="btn-primary">{m.marketplace_agentsListHireMe()}</a
                                    >
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
    .marketplace-page {
        min-height: 100%;
        padding: 24px;
    }

    /* Header */
    .page-header {
        margin-bottom: 24px;
        padding-bottom: 16px;
        border-bottom: 1px solid var(--color-border);
    }

    .page-title {
        font-size: 18px;
        font-weight: 700;
        color: var(--color-foreground);
        margin: 0 0 4px;
        letter-spacing: -0.01em;
    }

    .page-subtitle {
        font-size: 13px;
        color: var(--color-muted);
        margin: 0;
    }

    /* Filters Section */
    .filters-section {
        display: flex;
        flex-direction: column;
        gap: 16px;
        margin-bottom: 24px;
    }

    /* Search */
    .search-box {
        position: relative;
        display: flex;
        align-items: center;
    }

    .search-box :global(.search-icon) {
        position: absolute;
        left: 12px;
        color: var(--color-muted);
        pointer-events: none;
    }

    .search-input {
        width: 100%;
        max-width: 400px;
        padding: 10px 36px;
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        color: var(--color-foreground);
        font-size: 13px;
        transition: all 0.15s ease;
    }

    .search-input::placeholder {
        color: var(--color-muted);
    }

    .search-input:focus {
        outline: none;
        border-color: var(--color-brand-pink);
    }

    .clear-btn {
        position: absolute;
        left: calc(12px + 360px);
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--color-bg3);
        border: none;
        border-radius: 50%;
        color: var(--color-muted);
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .clear-btn:hover {
        background: var(--color-border);
        color: var(--color-foreground);
    }

    /* Category Pills */
    .category-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }

    .category-pill {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 14px;
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 20px;
        color: var(--color-muted);
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .category-pill:hover {
        background: var(--color-bg3);
        color: var(--color-foreground);
    }

    .category-pill.active {
        background: color-mix(
            in srgb,
            var(--color-brand-pink) 15%,
            transparent
        );
        border-color: color-mix(
            in srgb,
            var(--color-brand-pink) 30%,
            transparent
        );
        color: var(--color-brand-pink);
    }

    /* Toolbar */
    .toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-top: 16px;
        border-top: 1px solid var(--color-border);
    }

    .results-count {
        font-size: 13px;
        color: var(--color-muted);
    }

    .toolbar-controls {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .sort-select {
        padding: 8px 12px;
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-foreground);
        font-size: 12px;
        cursor: pointer;
    }

    .sort-select:focus {
        outline: none;
        border-color: var(--color-brand-pink);
    }

    .view-toggle {
        display: flex;
        gap: 2px;
        padding: 3px;
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 6px;
    }

    .view-btn {
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: none;
        border-radius: 4px;
        color: var(--color-muted);
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .view-btn:hover {
        color: var(--color-foreground);
    }

    .view-btn.active {
        color: var(--color-brand-pink);
        background: color-mix(
            in srgb,
            var(--color-brand-pink) 15%,
            transparent
        );
    }

    /* Content Area */
    .content-area {
        min-height: 400px;
    }

    /* Loading State */
    .loading-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 80px 20px;
        gap: 16px;
    }

    .loading-spinner {
        position: relative;
        width: 48px;
        height: 48px;
    }

    .spinner-ring {
        position: absolute;
        inset: 0;
        border: 2px solid transparent;
        border-top-color: var(--color-brand-pink);
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }

    .spinner-ring:nth-child(2) {
        inset: 8px;
        border-top-color: color-mix(
            in srgb,
            var(--color-brand-pink) 60%,
            transparent
        );
        animation-duration: 1.5s;
        animation-direction: reverse;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    .loading-text {
        font-size: 14px;
        color: var(--color-muted);
    }

    /* Empty State */
    .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 80px 20px;
        text-align: center;
    }

    .empty-icon {
        width: 64px;
        height: 64px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 16px;
        font-size: 28px;
        margin-bottom: 16px;
    }

    .empty-title {
        font-size: 16px;
        font-weight: 600;
        color: var(--color-foreground);
        margin: 0 0 4px;
    }

    .empty-message {
        font-size: 13px;
        color: var(--color-muted);
        margin: 0 0 16px;
    }

    .clear-filters-btn {
        padding: 8px 16px;
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-muted);
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .clear-filters-btn:hover {
        background: var(--color-bg3);
        color: var(--color-foreground);
    }

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
        transition: all 0.15s ease;
    }

    .list-item:hover {
        border-color: var(--color-border);
    }

    /* Mini ID Card in List View */
    .list-card {
        width: 140px;
        flex-shrink: 0;
        background: linear-gradient(
            145deg,
            rgba(250, 250, 250, 0.98),
            rgba(240, 240, 242, 0.95)
        );
        border-radius: 10px;
        padding: 12px;
        padding-top: 18px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        position: relative;
    }

    /* Badge Clip for List View */
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

    .list-info {
        flex: 1;
        min-width: 0;
    }

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
        background: color-mix(
            in srgb,
            var(--color-brand-pink) 15%,
            transparent
        );
        border: 1px solid
            color-mix(in srgb, var(--color-brand-pink) 25%, transparent);
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

    .list-description p {
        margin: 0;
    }

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
        .marketplace-page {
            padding: 16px;
        }

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

        .list-initials {
            color: #18181b;
        }

        .list-brand {
            color: #18181b;
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

        .clear-btn {
            left: auto;
            right: 12px;
        }

        .search-input {
            max-width: 100%;
        }
    }
</style>
