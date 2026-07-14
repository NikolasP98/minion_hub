<script lang="ts">
  import { Button } from '$lib/components/ui';
import { Search, X, Loader2, ChevronDown, Bot } from 'lucide-svelte';
    import {
        registryState, loadRegistry, registryDerived,
        categoryIcon, agentIcon,
        type RegistryAgent,
    } from '$lib/state/builder';
    import { onMount } from 'svelte';
    import { browser } from '$app/environment';
    import { createVirtualizer } from '$lib/virtual/virtualizer.svelte';
    import * as m from '$lib/paraglide/messages';

    let {
        onSelectAgent,
        scrollContainer,
    }: {
        onSelectAgent: (agent: RegistryAgent) => void;
        /** Bounded scrolling ancestor (host owns it — the grid has no scroller of its own). */
        scrollContainer?: HTMLElement | null;
    } = $props();

    let searchInput = $state('');
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    let showMoreCategories = $state(false);

    const MAX_VISIBLE_PILLS = 12;

    const topCategories = $derived(registryDerived.categories.slice(0, MAX_VISIBLE_PILLS));
    const overflowCategories = $derived(registryDerived.categories.slice(MAX_VISIBLE_PILLS));

    onMount(() => {
        loadRegistry();
    });

    // Column count from the scroll container's own width (it has no max-width cap,
    // unlike the narrower centered content column the grid itself sits in — so it
    // tracks available screen real-estate the same way the old viewport-width
    // Tailwind breakpoints (sm/lg) did).
    let containerWidth = $state(0);
    $effect(() => {
        if (!browser || !scrollContainer) return;
        const ro = new ResizeObserver((entries) => {
            containerWidth = entries[0]?.contentRect.width ?? scrollContainer!.clientWidth;
        });
        ro.observe(scrollContainer);
        return () => ro.disconnect();
    });
    const columns = $derived(containerWidth >= 1024 ? 3 : containerWidth >= 640 ? 2 : 1);

    // Row-chunk the filtered agents into virtualizer rows of `columns` cards each.
    const rows = $derived.by(() => {
        const list = registryDerived.filteredAgents;
        const cols = columns;
        const out: RegistryAgent[][] = [];
        for (let i = 0; i < list.length; i += cols) out.push(list.slice(i, i + cols));
        return out;
    });

    const v = $derived(
        browser && scrollContainer && rows.length > 0
            ? createVirtualizer({
                    count: rows.length,
                    getScrollElement: () => scrollContainer ?? null,
                    getItemKey: (i) => rows[i]?.[0]?.id ?? i,
                    estimateSize: () => 170,
                    ['gap']: 12,
                    overscan: 4,
                })
            : null,
    );

    // Reset scroll to top when the view identity changes (search/category filter).
    $effect(() => {
        void registryState.search;
        void registryState.categoryFilter;
        v?.scrollToOffset(0);
    });

    function onSearchInput(e: Event) {
        const val = (e.target as HTMLInputElement).value;
        searchInput = val;
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            registryState.search = val;
        }, 200);
    }

    function clearSearch() {
        searchInput = '';
        registryState.search = '';
    }

    function setCategory(cat: string | null) {
        registryState.categoryFilter = cat;
        showMoreCategories = false;
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
                    <Button variant="ghost"
                        type="button"
                        class="cat-pill {registryState.categoryFilter === null ? 'active' : ''}"
                        onclick={() => setCategory(null)}
                    >{m.marketplace_agentsListCategoryAll()}</Button>
                    {#each topCategories as { category, count } (category)}
                        <Button variant="ghost"
                            type="button"
                            class="cat-pill {registryState.categoryFilter === category ? 'active' : ''}"
                            onclick={() => setCategory(category)}
                        >
                            <span class="cat-pill-icon">{categoryIcon(category)}</span>
                            {category}
                            <span class="pill-count">{count}</span>
                        </Button>
                    {/each}

                    <!-- Overflow dropdown -->
                    {#if overflowCategories.length > 0}
                        <div class="more-dropdown">
                            <Button variant="ghost"
                                type="button"
                                class="cat-pill more-pill"
                                onclick={() => { showMoreCategories = !showMoreCategories; }}
                            >
                                <ChevronDown size={12} />
                                +{overflowCategories.length} {m.builder_registryMore()}
                            </Button>
                            {#if showMoreCategories}
                                <div class="more-menu" role="presentation" onmousedown={(e) => e.stopPropagation()}>
                                    {#each overflowCategories as { category, count } (category)}
                                        <Button variant="ghost"
                                            type="button"
                                            class="more-item {registryState.categoryFilter === category ? 'selected' : ''}"
                                            onclick={() => setCategory(category)}
                                        >
                                            <span>{categoryIcon(category)} {category}</span>
                                            <span class="cat-count">{count}</span>
                                        </Button>
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
                        <Button variant="ghost" type="button" class="search-clear" onclick={clearSearch} aria-label={m.builder_clear()}>
                            <X size={11} />
                        </Button>
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
    {:else if registryDerived.filteredAgents.length === 0 && registryState.loaded}
        <div class="empty-state">
            <Bot size={24} class="empty-icon" />
            <p class="empty-text">{m.builder_registryNoMatch()}</p>
        </div>
    {:else if v}
        <div class="relative w-full" style="height:{v.getTotalSize()}px">
            {#each v.getVirtualItems() as item (item.key)}
                {@const rowAgents = rows[item.index] ?? []}
                <div
                    data-index={item.index}
                    {@attach (node) => v.measureElement(node)}
                    class="absolute left-0 right-0 grid gap-3"
                    style="transform: translateY({item.start}px); grid-template-columns: repeat({columns}, minmax(0, 1fr));"
                >
                    {#each rowAgents as agent (agent.id)}
                        <Button variant="ghost"
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
                        </Button>
                    {/each}
                </div>
            {/each}
        </div>
    {/if}
</div>

<style>
    .registry-section {
        margin-top: var(--space-8);
        padding-top: var(--space-6);
        border-top: 1px solid var(--color-border);
    }

    .registry-header {
        margin-bottom: var(--space-4);
    }

    .registry-title-row {
        display: flex;
        align-items: baseline;
        gap: var(--space-2);
        margin-bottom: var(--space-3);
    }

    .registry-title {
        font-size: var(--font-size-body);
        font-weight: 600;
        color: var(--color-foreground);
    }

    .registry-count {
        font-size: var(--font-size-caption);
        color: var(--color-muted);
    }

    /* ── Filter Bar ─────────────────────────── */
    .filter-bar {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .cat-pills {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1);
        align-items: center;
    }

    :global(.cat-pill) {
        font-family: inherit;
        font-size: var(--font-size-caption);
        font-weight: 500;
        padding: var(--space-1) var(--space-2);
        border-radius: var(--radius-md);
        border: 1px solid var(--color-border);
        background: transparent;
        color: var(--color-muted);
        cursor: pointer;
        transition: all var(--duration-fast) var(--ease-standard);
    }
    :global(.cat-pill > span) {
        gap: var(--space-1);
    }

    :global(.cat-pill:hover) {
        color: var(--color-foreground);
        border-color: var(--color-foreground);
    }

    :global(.cat-pill.active) {
        color: var(--color-accent);
        border-color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    }

    .cat-pill-icon {
        font-size: var(--font-size-caption);
        line-height: 1;
    }

    .pill-count {
        font-size: var(--font-size-telemetry);
        opacity: 0.7;
    }

    /* ── More Dropdown ─────────────────────── */
    .more-dropdown {
        position: relative;
    }

    :global(.more-pill) {
        opacity: 0.7;
    }

    .more-menu {
        position: absolute;
        top: 100%;
        left: 0;
        margin-top: var(--space-1);
        min-width: 14rem;
        max-height: 20rem;
        overflow-y: auto;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-overlay);
        z-index: var(--layer-modal);
        padding: var(--space-1);
    }

    :global(.more-item) {
        font-family: inherit;
        font-size: var(--font-size-caption);
        width: 100%;
        text-align: left;
        padding: var(--space-2) var(--space-2);
        border-radius: var(--radius-sm);
        border: none;
        background: none;
        color: var(--color-foreground);
        cursor: pointer;
    }
    :global(.more-item > span) {
        width: 100%;
        justify-content: space-between;
    }

    :global(.more-item:hover) {
        background: var(--color-bg3);
    }

    :global(.more-item.selected) {
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    }

    .cat-count {
        font-size: var(--font-size-telemetry);
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
        font-size: var(--font-size-caption);
        padding: var(--space-1) var(--space-6) var(--space-1) var(--space-6);
        height: 1.625rem;
        width: 100%;
        max-width: 16rem;
        border-radius: var(--radius-md);
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

    :global(.search-clear) {
        position: absolute;
        right: 0.375rem;
        color: var(--color-muted);
        background: none;
        border: none;
        cursor: pointer;
        padding: 0;
        display: flex;
    }

    :global(.search-clear:hover) {
        color: var(--color-foreground);
    }

    /* ── Loading / Error / Empty ─────────────── */
    .loading-container {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
        padding: var(--space-8) 0;
    }

    :global(.loading-spinner) {
        color: var(--color-muted);
        animation: spin 1s linear infinite;
    }

    .loading-text {
        font-size: var(--font-size-caption);
        color: var(--color-muted);
    }

    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    .error-banner {
        padding: var(--space-3) var(--space-4);
        border-radius: var(--radius-md);
        font-size: var(--font-size-caption);
        color: var(--color-danger-fg);
        background: var(--color-danger-surface);
        border: 1px solid var(--color-danger-border);
    }

    .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-8) 0;
    }

    :global(.empty-icon) {
        color: var(--color-muted);
        opacity: 0.5;
    }

    .empty-text {
        font-size: var(--font-size-caption);
        color: var(--color-muted);
        margin: 0;
    }

    /* ── Registry Cards ─────────────────────── */
    :global(.reg-card) {
        display: flex;
        align-items: stretch;
        min-height: 6rem;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        background: var(--color-bg2);
        cursor: pointer;
        transition: all var(--duration-fast) var(--ease-standard);
        padding: 0;
        font-family: inherit;
        width: 100%;
        color: inherit;
        text-align: left;
    }
    :global(.reg-card > span) {
        width: 100%;
        align-self: stretch;
        align-items: stretch;
    }

    :global(.reg-card:hover) {
        background: var(--color-bg3);
        border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
    }

    .reg-card-inner {
        display: flex;
        flex-direction: column;
        width: 100%;
        padding: var(--space-3) var(--space-4);
        gap: var(--space-2);
    }

    .reg-card-header {
        display: flex;
        align-items: center;
        gap: var(--space-2);
    }

    .reg-cat-icon {
        font-size: var(--font-size-page-title);
        line-height: 1;
        flex-shrink: 0;
    }

    .reg-name {
        font-size: var(--font-size-caption);
        font-weight: 600;
        color: var(--color-foreground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .reg-desc {
        font-size: var(--font-size-telemetry);
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
        gap: var(--space-2);
        margin-top: auto;
    }

    .reg-category {
        font-size: var(--font-size-telemetry);
        color: var(--color-muted);
        font-family: var(--font-mono, monospace);
        background: var(--color-bg3);
        padding: var(--space-0-5) var(--space-2);
        border-radius: var(--radius-sm);
    }

    .reg-model {
        font-size: var(--font-size-telemetry);
        font-family: var(--font-mono, monospace);
        color: var(--color-muted);
        background: var(--color-bg3);
        padding: var(--space-0-5) var(--space-2);
        border-radius: var(--radius-sm);
        border: 1px solid var(--color-border);
    }

</style>
