<script lang="ts">
    import { Search, X, Loader2, ChevronDown, Bot } from 'lucide-svelte';
    import {
        registryState, loadRegistry, registryDerived,
        loadMore, resetVisibleCount,
        categoryIcon, agentIcon,
        type RegistryAgent,
    } from '$lib/state/builder';
    import { onMount } from 'svelte';
    import * as m from '$lib/paraglide/messages';

    let { onSelectAgent }: { onSelectAgent: (agent: RegistryAgent) => void } = $props();

    let searchInput = $state('');
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    let sentinel: HTMLDivElement | undefined = $state();
    let showMoreCategories = $state(false);

    const MAX_VISIBLE_PILLS = 12;

    const topCategories = $derived(registryDerived.categories.slice(0, MAX_VISIBLE_PILLS));
    const overflowCategories = $derived(registryDerived.categories.slice(MAX_VISIBLE_PILLS));

    onMount(() => {
        loadRegistry();
    });

    // Intersection observer for infinite scroll
    $effect(() => {
        if (!sentinel) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting && registryDerived.visibleAgents.length < registryDerived.filteredAgents.length) {
                    loadMore();
                }
            },
            { rootMargin: '200px' },
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    });

    function onSearchInput(e: Event) {
        const val = (e.target as HTMLInputElement).value;
        searchInput = val;
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            registryState.search = val;
            resetVisibleCount();
        }, 200);
    }

    function clearSearch() {
        searchInput = '';
        registryState.search = '';
        resetVisibleCount();
    }

    function setCategory(cat: string | null) {
        registryState.categoryFilter = cat;
        showMoreCategories = false;
        resetVisibleCount();
    }
</script>

<div class="registry-section">
    <div class="registry-header">
        <div class="registry-title-row">
            <h3 class="registry-title">{m.builder_registryTitle()}</h3>
            <span class="registry-count">
                {#if registryState.loaded}
                    {registryDerived.filteredAgents.length.toLocaleString()} {m.builder_registryAgentsCount()}
                {/if}
            </span>
        </div>

        <!-- Filter bar -->
        {#if registryState.loaded}
            <div class="filter-bar">
                <!-- Category pills -->
                <div class="cat-pills">
                    <button
                        type="button"
                        class="cat-pill {registryState.categoryFilter === null ? 'active' : ''}"
                        onclick={() => setCategory(null)}
                    >{m.marketplace_agentsListCategoryAll()}</button>
                    {#each topCategories as { category, count } (category)}
                        <button
                            type="button"
                            class="cat-pill {registryState.categoryFilter === category ? 'active' : ''}"
                            onclick={() => setCategory(category)}
                        >
                            <span class="cat-pill-icon">{categoryIcon(category)}</span>
                            {category}
                            <span class="pill-count">{count}</span>
                        </button>
                    {/each}

                    <!-- Overflow dropdown -->
                    {#if overflowCategories.length > 0}
                        <div class="more-dropdown">
                            <button
                                type="button"
                                class="cat-pill more-pill"
                                onclick={() => { showMoreCategories = !showMoreCategories; }}
                            >
                                <ChevronDown size={12} />
                                +{overflowCategories.length} {m.builder_registryMore()}
                            </button>
                            {#if showMoreCategories}
                                <div class="more-menu" role="presentation" onmousedown={(e) => e.stopPropagation()}>
                                    {#each overflowCategories as { category, count } (category)}
                                        <button
                                            type="button"
                                            class="more-item {registryState.categoryFilter === category ? 'selected' : ''}"
                                            onclick={() => setCategory(category)}
                                        >
                                            <span>{categoryIcon(category)} {category}</span>
                                            <span class="cat-count">{count}</span>
                                        </button>
                                    {/each}
                                </div>
                            {/if}
                        </div>
                    {/if}
                </div>

                <!-- Search -->
                <div class="search-box">
                    <Search size={12} class="search-icon" />
                    <input
                        type="text"
                        placeholder={m.builder_registrySearchPlaceholder()}
                        value={searchInput}
                        oninput={onSearchInput}
                        class="search-input"
                    />
                    {#if searchInput}
                        <button type="button" class="search-clear" onclick={clearSearch}>
                            <X size={11} />
                        </button>
                    {/if}
                </div>
            </div>
        {/if}
    </div>

    <!-- Content -->
    {#if registryState.loading}
        <div class="loading-container">
            <Loader2 size={20} class="loading-spinner" />
            <span class="loading-text">{m.builder_registryLoading()}</span>
        </div>
    {:else if registryState.error}
        <div class="error-banner">{registryState.error}</div>
    {:else if registryDerived.visibleAgents.length === 0 && registryState.loaded}
        <div class="empty-state">
            <Bot size={24} class="empty-icon" />
            <p class="empty-text">{m.builder_registryNoMatch()}</p>
        </div>
    {:else}
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {#each registryDerived.visibleAgents as agent (agent.id)}
                <button
                    type="button"
                    class="reg-card"
                    onclick={() => onSelectAgent(agent)}
                >
                    <div class="reg-card-inner">
                        <div class="reg-card-header">
                            <span class="reg-cat-icon">{agentIcon(agent)}</span>
                            <span class="reg-name">{agent.name}</span>
                        </div>
                        {#if agent.description}
                            <span class="reg-desc">{agent.description}</span>
                        {/if}
                        <div class="reg-footer">
                            {#each agent.categories as cat}
                                <span class="reg-category">{cat}</span>
                            {/each}
                            {#if agent.model}
                                <span class="reg-model">{agent.model}</span>
                            {/if}
                        </div>
                    </div>
                </button>
            {/each}
        </div>

        <!-- Load more sentinel -->
        {#if registryDerived.visibleAgents.length < registryDerived.filteredAgents.length}
            <div bind:this={sentinel} class="sentinel">
                <Loader2 size={16} class="loading-spinner" />
                <span class="loading-text">{m.builder_registryLoadingMore()}</span>
            </div>
        {/if}
    {/if}
</div>

<style>
    .registry-section {
        margin-top: 2rem;
        padding-top: 1.5rem;
        border-top: 1px solid var(--color-border);
    }

    .registry-header {
        margin-bottom: 1rem;
    }

    .registry-title-row {
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
        margin-bottom: 0.75rem;
    }

    .registry-title {
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--color-foreground);
    }

    .registry-count {
        font-size: 0.6875rem;
        color: var(--color-muted);
    }

    /* ── Filter Bar ─────────────────────────── */
    .filter-bar {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .cat-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
        align-items: center;
    }

    .cat-pill {
        font-family: inherit;
        font-size: 0.6875rem;
        font-weight: 500;
        padding: 0.25rem 0.5rem;
        border-radius: 0.375rem;
        border: 1px solid var(--color-border);
        background: transparent;
        color: var(--color-muted);
        cursor: pointer;
        transition: all var(--duration-fast) var(--ease-standard);
        display: flex;
        align-items: center;
        gap: 0.25rem;
    }

    .cat-pill:hover {
        color: var(--color-foreground);
        border-color: var(--color-foreground);
    }

    .cat-pill.active {
        color: var(--color-accent);
        border-color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    }

    .cat-pill-icon {
        font-size: 0.75rem;
        line-height: 1;
    }

    .pill-count {
        font-size: 0.5625rem;
        opacity: 0.7;
    }

    /* ── More Dropdown ─────────────────────── */
    .more-dropdown {
        position: relative;
    }

    .more-pill {
        opacity: 0.7;
    }

    .more-menu {
        position: absolute;
        top: 100%;
        left: 0;
        margin-top: 0.25rem;
        min-width: 14rem;
        max-height: 20rem;
        overflow-y: auto;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 0.5rem;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        z-index: 50;
        padding: 0.25rem;
    }

    .more-item {
        font-family: inherit;
        font-size: 0.6875rem;
        width: 100%;
        text-align: left;
        padding: 0.375rem 0.5rem;
        border-radius: 0.25rem;
        border: none;
        background: none;
        color: var(--color-foreground);
        cursor: pointer;
        display: flex;
        justify-content: space-between;
    }

    .more-item:hover {
        background: var(--color-bg3);
    }

    .more-item.selected {
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    }

    .cat-count {
        font-size: 0.5625rem;
        color: var(--color-muted);
    }

    /* ── Search ─────────────────────────────── */
    .search-box {
        position: relative;
        display: flex;
        align-items: center;
    }

    :global(.search-icon) {
        position: absolute;
        left: 0.5rem;
        color: var(--color-muted);
        pointer-events: none;
    }

    .search-input {
        font-family: inherit;
        font-size: 0.6875rem;
        padding: 0.25rem 1.5rem 0.25rem 1.5rem;
        height: 1.625rem;
        width: 100%;
        max-width: 16rem;
        border-radius: 0.375rem;
        border: 1px solid var(--color-border);
        background: var(--color-bg3);
        color: var(--color-foreground);
        outline: none;
        transition: border-color var(--duration-fast) var(--ease-standard);
        color-scheme: dark;
    }

    .search-input:focus {
        border-color: var(--color-accent);
    }

    .search-input::placeholder {
        color: var(--color-muted);
    }

    .search-clear {
        position: absolute;
        right: 0.375rem;
        color: var(--color-muted);
        background: none;
        border: none;
        cursor: pointer;
        padding: 0;
        display: flex;
    }

    .search-clear:hover {
        color: var(--color-foreground);
    }

    /* ── Loading / Error / Empty ─────────────── */
    .loading-container {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        padding: 2rem 0;
    }

    :global(.loading-spinner) {
        color: var(--color-muted);
        animation: spin 1s linear infinite;
    }

    .loading-text {
        font-size: 0.75rem;
        color: var(--color-muted);
    }

    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    .error-banner {
        padding: 0.75rem 1rem;
        border-radius: 0.5rem;
        font-size: 0.75rem;
        color: var(--color-error, #ef4444);
        background: color-mix(in srgb, var(--color-error, #ef4444) 8%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-error, #ef4444) 25%, transparent);
    }

    .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        padding: 2rem 0;
    }

    :global(.empty-icon) {
        color: var(--color-muted);
        opacity: 0.5;
    }

    .empty-text {
        font-size: 0.75rem;
        color: var(--color-muted);
        margin: 0;
    }

    /* ── Registry Cards ─────────────────────── */
    .reg-card {
        display: flex;
        align-items: stretch;
        min-height: 6rem;
        border: 1px solid var(--color-border);
        border-radius: 0.625rem;
        background: var(--color-bg2);
        cursor: pointer;
        transition: all var(--duration-fast) var(--ease-standard);
        padding: 0;
        font-family: inherit;
        width: 100%;
        color: inherit;
        text-align: left;
    }

    .reg-card:hover {
        background: var(--color-bg3);
        border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
    }

    .reg-card-inner {
        display: flex;
        flex-direction: column;
        width: 100%;
        padding: 0.75rem 1rem;
        gap: 0.375rem;
    }

    .reg-card-header {
        display: flex;
        align-items: center;
        gap: 0.375rem;
    }

    .reg-cat-icon {
        font-size: 1rem;
        line-height: 1;
        flex-shrink: 0;
    }

    .reg-name {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--color-foreground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .reg-desc {
        font-size: 0.625rem;
        color: var(--color-muted);
        line-height: 1.4;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
    }

    .reg-footer {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        margin-top: auto;
    }

    .reg-category {
        font-size: 0.5625rem;
        color: var(--color-muted);
        font-family: var(--font-mono, monospace);
        background: var(--color-bg3);
        padding: 0.0625rem 0.375rem;
        border-radius: 0.25rem;
    }

    .reg-model {
        font-size: 0.5625rem;
        font-family: var(--font-mono, monospace);
        color: var(--color-muted);
        background: var(--color-bg3);
        padding: 0.0625rem 0.375rem;
        border-radius: 0.25rem;
        border: 1px solid var(--color-border);
    }

    .sentinel {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        padding: 1.5rem 0;
    }
</style>
