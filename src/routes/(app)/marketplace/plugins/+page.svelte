<script lang="ts">
    import { Search, Grid3X3, List, X, Puzzle, Package, Star, Download } from "lucide-svelte";

    interface Plugin {
        id: string;
        name: string;
        description: string;
        category: 'tools' | 'integrations' | 'themes' | 'ui' | 'automation';
        tags: string[];
        version: string;
        author: string;
        status: 'stable' | 'beta' | 'experimental';
        installs: number;
        stars: number;
        color: string;
    }

    const ALL_PLUGINS: Plugin[] = [
        { id: '1', name: 'Notion Integration', description: 'Sync your Notion workspace with Claude Code — read pages, create tasks, and update databases directly from sessions.', category: 'integrations', tags: ['notion', 'productivity', 'sync'], version: '1.2.0', author: 'claude-team', status: 'stable', installs: 3840, stars: 1240, color: '#10b981' },
        { id: '2', name: 'Auto Commit', description: 'Automatically stage and commit code changes when Claude finishes a task, with smart commit message generation.', category: 'automation', tags: ['git', 'commit', 'workflow'], version: '2.1.3', author: 'devtools-lab', status: 'stable', installs: 2910, stars: 980, color: '#f59e0b' },
        { id: '3', name: 'Dark Forest Theme', description: 'Ultra-dark OLED theme with deep forest greens and muted earth tones. Easy on the eyes for long sessions.', category: 'themes', tags: ['dark', 'oled', 'green'], version: '1.0.4', author: 'nightcrew', status: 'stable', installs: 2100, stars: 870, color: '#8b5cf6' },
        { id: '4', name: 'Linear Sync', description: 'Two-way sync with Linear issue tracking — see active issues, create new ones, and update status from Claude Code.', category: 'integrations', tags: ['linear', 'issues', 'project'], version: '0.9.1', author: 'productivity-inc', status: 'beta', installs: 1450, stars: 620, color: '#10b981' },
        { id: '5', name: 'Terminal Powerpack', description: 'Extends the built-in terminal with syntax highlighting, persistent history search, and 40+ shell utility shortcuts.', category: 'tools', tags: ['terminal', 'shell', 'utilities'], version: '3.0.0', author: 'shellworks', status: 'stable', installs: 5200, stars: 1890, color: '#3b82f6' },
        { id: '6', name: 'Kanban Board', description: 'Visual task board that tracks Claude session progress across multiple agents and projects in real time.', category: 'ui', tags: ['kanban', 'tasks', 'visual'], version: '1.1.0', author: 'ui-forge', status: 'stable', installs: 1320, stars: 540, color: '#ec4899' },
        { id: '7', name: 'Slack Notifier', description: 'Send session completion alerts, error reports, and milestone notifications directly to your Slack channels.', category: 'integrations', tags: ['slack', 'notifications', 'alerts'], version: '1.3.2', author: 'comms-kit', status: 'stable', installs: 1870, stars: 710, color: '#10b981' },
        { id: '8', name: 'Voice Input', description: 'Speak your prompts aloud using Web Speech API. Hands-free coding for when typing just gets in the way.', category: 'ui', tags: ['voice', 'speech', 'accessibility'], version: '0.6.0', author: 'a11y-lab', status: 'beta', installs: 690, stars: 340, color: '#ec4899' },
        { id: '9', name: 'Accent Color Pack', description: '24 additional accent color presets — from arctic cyan to molten orange — to make the hub truly yours.', category: 'themes', tags: ['colors', 'accent', 'customization'], version: '1.0.0', author: 'nightcrew', status: 'stable', installs: 1580, stars: 610, color: '#8b5cf6' },
        { id: '10', name: 'Scheduled Tasks', description: 'Run agent sessions on a cron schedule. Define recurring workflows and let your agents work while you sleep.', category: 'automation', tags: ['cron', 'schedule', 'background'], version: '0.8.0', author: 'devtools-lab', status: 'beta', installs: 830, stars: 410, color: '#f59e0b' },
        { id: '11', name: 'Code Diff Viewer', description: 'Side-by-side diff viewer for reviewing every file Claude modifies, with accept/reject controls per change.', category: 'tools', tags: ['diff', 'review', 'git'], version: '2.0.1', author: 'shellworks', status: 'stable', installs: 4100, stars: 1560, color: '#3b82f6' },
        { id: '12', name: 'Session Recorder', description: 'Record, replay, and share complete Claude sessions as interactive playbacks. Great for onboarding and demos.', category: 'tools', tags: ['record', 'replay', 'demo'], version: '0.4.2', author: 'devtools-lab', status: 'experimental', installs: 290, stars: 180, color: '#3b82f6' },
    ];

    const categories = [
        { id: null, label: 'All' },
        { id: 'tools', label: 'Tools' },
        { id: 'integrations', label: 'Integrations' },
        { id: 'themes', label: 'Themes' },
        { id: 'ui', label: 'UI' },
        { id: 'automation', label: 'Automation' },
    ] as const;

    const statusOptions = [
        { value: '', label: 'Any Status' },
        { value: 'stable', label: 'Stable' },
        { value: 'beta', label: 'Beta' },
        { value: 'experimental', label: 'Experimental' },
    ];

    let searchInput = $state('');
    let selectedCategory = $state<string | null>(null);
    let statusFilter = $state('');
    let starredOnly = $state(false);
    let sortBy = $state<'popular' | 'newest' | 'name'>('popular');
    let viewMode = $state<'grid' | 'list'>('grid');
    let installed = $state<Set<string>>(new Set());

    function formatCount(n: number): string {
        if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
        return String(n);
    }

    const STATUS_COLOR: Record<string, string> = {
        stable: 'var(--color-success)',
        beta: 'var(--color-warning)',
        experimental: 'var(--color-purple)',
    };

    const filtered = $derived.by(() => {
        let plugins = [...ALL_PLUGINS];
        if (selectedCategory) plugins = plugins.filter(p => p.category === selectedCategory);
        if (statusFilter) plugins = plugins.filter(p => p.status === statusFilter);
        if (starredOnly) plugins = plugins.filter(p => p.stars >= 700);
        if (searchInput.trim()) {
            const q = searchInput.toLowerCase();
            plugins = plugins.filter(p =>
                p.name.toLowerCase().includes(q) ||
                p.description.toLowerCase().includes(q) ||
                p.tags.some(t => t.includes(q))
            );
        }
        switch (sortBy) {
            case 'popular': return plugins.sort((a, b) => b.installs - a.installs);
            case 'newest': return plugins.sort((a, b) => parseFloat(b.version) - parseFloat(a.version));
            case 'name': return plugins.sort((a, b) => a.name.localeCompare(b.name));
            default: return plugins;
        }
    });

    function clearSearch() {
        searchInput = '';
    }
</script>

<div class="flex flex-col min-h-full">
    <!-- Compact sticky toolbar header -->
    <header class="sticky top-0 z-10 shrink-0 flex flex-col border-b border-border bg-bg2/80 backdrop-blur-sm">
        <!-- Primary row -->
        <div class="flex items-center gap-3 px-4 py-2.5">
            <Puzzle size={13} class="text-[var(--color-brand-pink)] shrink-0" />
            <h1 class="text-sm font-semibold tracking-tight">Plugins</h1>
            {#if filtered.length > 0}
                <span class="text-[10px] bg-bg3 text-muted-foreground border border-border rounded-full px-1.5 leading-5 tabular-nums">{filtered.length}</span>
            {/if}
            <span class="text-[11px] text-muted-foreground/70 hidden md:block truncate">Find and install plugins that extend Minion Hub</span>
            <div class="flex-1"></div>

            <!-- Search -->
            <div class="relative flex items-center">
                <Search size={12} class="absolute left-2.5 text-muted-foreground pointer-events-none shrink-0" />
                <input
                    type="text"
                    placeholder="Search plugins…"
                    bind:value={searchInput}
                    class="text-[11px] pl-7 pr-6 py-1 h-7 w-44 bg-bg3 text-foreground border border-border rounded-md placeholder:text-muted-foreground focus:outline-none focus:border-[var(--color-brand-pink)] [color-scheme:dark] transition-colors"
                />
                {#if searchInput}
                    <button type="button" class="absolute right-2 text-muted-foreground hover:text-foreground cursor-pointer transition-colors" onclick={clearSearch}>
                        <X size={11} />
                    </button>
                {/if}
            </div>

            <!-- Sort -->
            <select
                bind:value={sortBy}
                class="text-[11px] h-7 py-0 px-2 bg-bg3 text-foreground border border-border rounded-md focus:outline-none focus:border-[var(--color-brand-pink)] [color-scheme:dark] cursor-pointer transition-colors"
            >
                <option value="popular">Most Popular</option>
                <option value="newest">Newest</option>
                <option value="name">Name</option>
            </select>

            <!-- View toggle -->
            <div class="flex gap-0.5 p-0.5 bg-bg3 border border-border rounded-md">
                <button type="button" onclick={() => (viewMode = 'grid')} class="w-6 h-6 flex items-center justify-center rounded cursor-pointer transition-colors {viewMode === 'grid' ? 'bg-[color-mix(in_srgb,var(--color-brand-pink)_15%,transparent)] text-[var(--color-brand-pink)]' : 'text-muted-foreground hover:text-foreground'}">
                    <Grid3X3 size={12} />
                </button>
                <button type="button" onclick={() => (viewMode = 'list')} class="w-6 h-6 flex items-center justify-center rounded cursor-pointer transition-colors {viewMode === 'list' ? 'bg-[color-mix(in_srgb,var(--color-brand-pink)_15%,transparent)] text-[var(--color-brand-pink)]' : 'text-muted-foreground hover:text-foreground'}">
                    <List size={12} />
                </button>
            </div>
        </div>

        <!-- Filter row: new controls left, pills right -->
        <div class="flex items-center gap-2 px-4 pb-2.5">
            <!-- Status filter -->
            <select
                bind:value={statusFilter}
                class="text-[11px] h-6 py-0 px-2 bg-bg3 text-muted-foreground border border-border rounded-md focus:outline-none [color-scheme:dark] cursor-pointer transition-colors hover:text-foreground"
            >
                {#each statusOptions as opt (opt.value)}
                    <option value={opt.value}>{opt.label}</option>
                {/each}
            </select>

            <!-- Starred/popular toggle -->
            <button
                type="button"
                onclick={() => (starredOnly = !starredOnly)}
                class="text-[11px] py-0.5 px-2.5 rounded-md border whitespace-nowrap cursor-pointer transition-colors flex items-center gap-1.5
                    {starredOnly
                        ? 'bg-[color-mix(in_srgb,var(--color-warning)_15%,transparent)] border-[color-mix(in_srgb,var(--color-warning)_30%,transparent)] text-[var(--color-warning)]'
                        : 'bg-bg3 border-border text-muted-foreground hover:text-foreground'}"
            >
                <Star size={10} />
                Popular
            </button>

            <div class="flex-1"></div>

            <!-- Category pills (right-aligned) -->
            <div class="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
                {#each categories as cat (cat.id ?? 'all')}
                    <button
                        type="button"
                        onclick={() => { selectedCategory = cat.id; }}
                        class="text-[11px] py-0.5 px-2.5 rounded-full border whitespace-nowrap cursor-pointer transition-colors
                            {selectedCategory === cat.id
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
        {#if filtered.length === 0}
            <div class="flex flex-col items-center justify-center py-24 gap-3 text-center">
                <Package size={32} class="text-muted-foreground/30" />
                <div>
                    <h3 class="text-sm font-semibold text-foreground mb-1">No plugins found</h3>
                    <p class="text-xs text-muted-foreground">Try adjusting your filters or search query</p>
                </div>
                {#if searchInput || selectedCategory || statusFilter || starredOnly}
                    <button
                        type="button"
                        onclick={() => { searchInput = ''; selectedCategory = null; statusFilter = ''; starredOnly = false; }}
                        class="text-xs px-3 py-1.5 bg-bg3 border border-border rounded-md text-muted-foreground hover:text-foreground hover:bg-border cursor-pointer transition-colors"
                    >
                        Clear filters
                    </button>
                {/if}
            </div>
        {:else}
            <p class="text-[11px] text-muted-foreground mb-3">Showing {filtered.length} plugin{filtered.length !== 1 ? 's' : ''}</p>

            {#if viewMode === 'grid'}
                <div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
                    {#each filtered as plugin (plugin.id)}
                        <div class="plugin-card">
                            <div class="plugin-card-top">
                                <!-- Icon -->
                                <div class="plugin-icon" style:background="color-mix(in srgb, {plugin.color} 15%, transparent)" style:border-color="color-mix(in srgb, {plugin.color} 25%, transparent)">
                                    <span class="plugin-letter" style:color={plugin.color}>{plugin.name[0]}</span>
                                </div>
                                <div class="plugin-meta">
                                    <div class="flex items-center gap-1.5">
                                        <span class="plugin-name">{plugin.name}</span>
                                        <span class="status-dot" style:background={STATUS_COLOR[plugin.status]} title={plugin.status}></span>
                                    </div>
                                    <span class="plugin-author">by {plugin.author}</span>
                                </div>
                            </div>

                            <p class="plugin-desc">{plugin.description}</p>

                            <div class="plugin-tags">
                                <span class="cat-badge" style:color={plugin.color} style:background="color-mix(in srgb, {plugin.color} 12%, transparent)" style:border-color="color-mix(in srgb, {plugin.color} 22%, transparent)">{plugin.category}</span>
                                {#each plugin.tags.slice(0, 2) as tag (tag)}
                                    <span class="tag-badge">{tag}</span>
                                {/each}
                            </div>

                            <div class="plugin-footer">
                                <div class="plugin-stats">
                                    <span class="stat"><Download size={10} />{formatCount(plugin.installs)}</span>
                                    <span class="stat"><Star size={10} />{formatCount(plugin.stars)}</span>
                                    <span class="version">v{plugin.version}</span>
                                </div>
                                <button
                                    type="button"
                                    onclick={() => installed.has(plugin.id) ? installed.delete(plugin.id) : installed.add(plugin.id)}
                                    class="install-btn {installed.has(plugin.id) ? 'installed' : ''}"
                                >
                                    {installed.has(plugin.id) ? 'Installed' : 'Install'}
                                </button>
                            </div>
                        </div>
                    {/each}
                </div>
            {:else}
                <div class="flex flex-col gap-2">
                    {#each filtered as plugin (plugin.id)}
                        <div class="plugin-list-item">
                            <div class="plugin-icon sm" style:background="color-mix(in srgb, {plugin.color} 15%, transparent)" style:border-color="color-mix(in srgb, {plugin.color} 25%, transparent)">
                                <span class="plugin-letter" style:color={plugin.color}>{plugin.name[0]}</span>
                            </div>
                            <div class="list-main">
                                <div class="list-top">
                                    <span class="plugin-name">{plugin.name}</span>
                                    <span class="status-dot" style:background={STATUS_COLOR[plugin.status]}></span>
                                    <span class="plugin-author">by {plugin.author} · v{plugin.version}</span>
                                </div>
                                <p class="plugin-desc">{plugin.description}</p>
                                <div class="plugin-tags">
                                    <span class="cat-badge" style:color={plugin.color} style:background="color-mix(in srgb, {plugin.color} 12%, transparent)" style:border-color="color-mix(in srgb, {plugin.color} 22%, transparent)">{plugin.category}</span>
                                    {#each plugin.tags.slice(0, 3) as tag (tag)}
                                        <span class="tag-badge">{tag}</span>
                                    {/each}
                                </div>
                            </div>
                            <div class="list-right">
                                <div class="plugin-stats">
                                    <span class="stat"><Download size={10} />{formatCount(plugin.installs)}</span>
                                    <span class="stat"><Star size={10} />{formatCount(plugin.stars)}</span>
                                </div>
                                <button
                                    type="button"
                                    onclick={() => installed.has(plugin.id) ? installed.delete(plugin.id) : installed.add(plugin.id)}
                                    class="install-btn {installed.has(plugin.id) ? 'installed' : ''}"
                                >
                                    {installed.has(plugin.id) ? 'Installed' : 'Install'}
                                </button>
                            </div>
                        </div>
                    {/each}
                </div>
            {/if}
        {/if}
    </div>
</div>

<style>
    /* Plugin card (grid view) */
    .plugin-card {
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 10px;
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        transition: border-color 0.15s ease;
        cursor: default;
    }
    .plugin-card:hover { border-color: color-mix(in srgb, var(--color-brand-pink) 30%, transparent); }

    .plugin-card-top { display: flex; align-items: flex-start; gap: 10px; }

    .plugin-icon {
        width: 36px;
        height: 36px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        border: 1px solid;
    }
    .plugin-icon.sm { width: 28px; height: 28px; flex-shrink: 0; border-radius: 6px; border: 1px solid; }

    .plugin-letter { font-size: 15px; font-weight: 800; line-height: 1; }
    .plugin-icon.sm .plugin-letter { font-size: 12px; }

    .plugin-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .plugin-name { font-size: 13px; font-weight: 600; color: var(--color-foreground); }
    .plugin-author { font-size: 10px; color: var(--color-muted); }

    .status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }

    .plugin-desc {
        font-size: 11px;
        line-height: 1.55;
        color: var(--color-muted);
        margin: 0;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    .plugin-tags { display: flex; flex-wrap: wrap; gap: 4px; }

    .cat-badge {
        font-size: 9px;
        font-weight: 600;
        text-transform: capitalize;
        padding: 2px 7px;
        border-radius: 10px;
        border: 1px solid;
        letter-spacing: 0.02em;
    }
    .tag-badge {
        font-size: 9px;
        padding: 2px 7px;
        border-radius: 10px;
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
        color: var(--color-muted);
    }

    .plugin-footer { display: flex; align-items: center; justify-content: space-between; margin-top: auto; }

    .plugin-stats { display: flex; align-items: center; gap: 10px; }
    .stat { display: flex; align-items: center; gap: 3px; font-size: 10px; color: var(--color-muted); font-variant-numeric: tabular-nums; }
    .version { font-size: 10px; color: var(--color-muted); font-family: monospace; }

    .install-btn {
        font-size: 11px;
        font-weight: 600;
        padding: 5px 12px;
        border-radius: 6px;
        border: 1px solid var(--color-border);
        background: var(--color-bg3);
        color: var(--color-muted-foreground);
        cursor: pointer;
        transition: all 0.15s ease;
        white-space: nowrap;
    }
    .install-btn:hover { background: var(--color-brand-pink); border-color: var(--color-brand-pink); color: white; }
    .install-btn.installed { background: color-mix(in srgb, var(--color-success) 15%, transparent); border-color: color-mix(in srgb, var(--color-success) 30%, transparent); color: var(--color-success); }
    .install-btn.installed:hover { background: color-mix(in srgb, var(--color-destructive) 15%, transparent); border-color: color-mix(in srgb, var(--color-destructive) 30%, transparent); color: var(--color-destructive); }

    /* List view */
    .plugin-list-item {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 12px 14px;
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        transition: border-color 0.15s ease;
    }
    .plugin-list-item:hover { border-color: color-mix(in srgb, var(--color-brand-pink) 30%, transparent); }

    .list-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
    .list-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .plugin-list-item .plugin-desc { -webkit-line-clamp: 1; line-clamp: 1; }

    .list-right { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; flex-shrink: 0; }
</style>
