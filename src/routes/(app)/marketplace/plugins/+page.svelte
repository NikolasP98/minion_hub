<script lang="ts">
  import { Search, Grid3X3, List, X, Puzzle, Package, Star, Download } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { Button, Input, PageHeader, Select } from '$lib/components/ui';
  import { AsyncBoundary, PageBody, PageShell } from '$lib/components/ui/foundations';

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
    {
      id: '1',
      name: 'Notion Integration',
      description:
        'Sync your Notion workspace with Claude Code — read pages, create tasks, and update databases directly from sessions.',
      category: 'integrations',
      tags: ['notion', 'productivity', 'sync'],
      version: '1.2.0',
      author: 'claude-team',
      status: 'stable',
      installs: 3840,
      stars: 1240,
      color: 'var(--color-success)',
    },
    {
      id: '2',
      name: 'Auto Commit',
      description:
        'Automatically stage and commit code changes when Claude finishes a task, with smart commit message generation.',
      category: 'automation',
      tags: ['git', 'commit', 'workflow'],
      version: '2.1.3',
      author: 'devtools-lab',
      status: 'stable',
      installs: 2910,
      stars: 980,
      color: 'var(--color-warning)',
    },
    {
      id: '3',
      name: 'Dark Forest Theme',
      description:
        'Ultra-dark OLED theme with deep forest greens and muted earth tones. Easy on the eyes for long sessions.',
      category: 'themes',
      tags: ['dark', 'oled', 'green'],
      version: '1.0.4',
      author: 'nightcrew',
      status: 'stable',
      installs: 2100,
      stars: 870,
      color: 'var(--color-purple)',
    },
    {
      id: '4',
      name: 'Linear Sync',
      description:
        'Two-way sync with Linear issue tracking — see active issues, create new ones, and update status from Claude Code.',
      category: 'integrations',
      tags: ['linear', 'issues', 'project'],
      version: '0.9.1',
      author: 'productivity-inc',
      status: 'beta',
      installs: 1450,
      stars: 620,
      color: 'var(--color-success)',
    },
    {
      id: '5',
      name: 'Terminal Powerpack',
      description:
        'Extends the built-in terminal with syntax highlighting, persistent history search, and 40+ shell utility shortcuts.',
      category: 'tools',
      tags: ['terminal', 'shell', 'utilities'],
      version: '3.0.0',
      author: 'shellworks',
      status: 'stable',
      installs: 5200,
      stars: 1890,
      color: 'var(--color-info)',
    },
    {
      id: '6',
      name: 'Kanban Board',
      description:
        'Visual task board that tracks Claude session progress across multiple agents and projects in real time.',
      category: 'ui',
      tags: ['kanban', 'tasks', 'visual'],
      version: '1.1.0',
      author: 'ui-forge',
      status: 'stable',
      installs: 1320,
      stars: 540,
      color: 'var(--color-brand-pink)',
    },
    {
      id: '7',
      name: 'Slack Notifier',
      description:
        'Send session completion alerts, error reports, and milestone notifications directly to your Slack channels.',
      category: 'integrations',
      tags: ['slack', 'notifications', 'alerts'],
      version: '1.3.2',
      author: 'comms-kit',
      status: 'stable',
      installs: 1870,
      stars: 710,
      color: 'var(--color-success)',
    },
    {
      id: '8',
      name: 'Voice Input',
      description:
        'Speak your prompts aloud using Web Speech API. Hands-free coding for when typing just gets in the way.',
      category: 'ui',
      tags: ['voice', 'speech', 'accessibility'],
      version: '0.6.0',
      author: 'a11y-lab',
      status: 'beta',
      installs: 690,
      stars: 340,
      color: 'var(--color-brand-pink)',
    },
    {
      id: '9',
      name: 'Accent Color Pack',
      description:
        '24 additional accent color presets — from arctic cyan to molten orange — to make the hub truly yours.',
      category: 'themes',
      tags: ['colors', 'accent', 'customization'],
      version: '1.0.0',
      author: 'nightcrew',
      status: 'stable',
      installs: 1580,
      stars: 610,
      color: 'var(--color-purple)',
    },
    {
      id: '10',
      name: 'Scheduled Tasks',
      description:
        'Run agent sessions on a cron schedule. Define recurring workflows and let your agents work while you sleep.',
      category: 'automation',
      tags: ['cron', 'schedule', 'background'],
      version: '0.8.0',
      author: 'devtools-lab',
      status: 'beta',
      installs: 830,
      stars: 410,
      color: 'var(--color-warning)',
    },
    {
      id: '11',
      name: 'Code Diff Viewer',
      description:
        'Side-by-side diff viewer for reviewing every file Claude modifies, with accept/reject controls per change.',
      category: 'tools',
      tags: ['diff', 'review', 'git'],
      version: '2.0.1',
      author: 'shellworks',
      status: 'stable',
      installs: 4100,
      stars: 1560,
      color: 'var(--color-info)',
    },
    {
      id: '12',
      name: 'Session Recorder',
      description:
        'Record, replay, and share complete Claude sessions as interactive playbacks. Great for onboarding and demos.',
      category: 'tools',
      tags: ['record', 'replay', 'demo'],
      version: '0.4.2',
      author: 'devtools-lab',
      status: 'experimental',
      installs: 290,
      stars: 180,
      color: 'var(--color-info)',
    },
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
    if (selectedCategory) plugins = plugins.filter((p) => p.category === selectedCategory);
    if (statusFilter) plugins = plugins.filter((p) => p.status === statusFilter);
    if (starredOnly) plugins = plugins.filter((p) => p.stars >= 700);
    if (searchInput.trim()) {
      const q = searchInput.toLowerCase();
      plugins = plugins.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.tags.some((t) => t.includes(q)),
      );
    }
    switch (sortBy) {
      case 'popular':
        return plugins.sort((a, b) => b.installs - a.installs);
      case 'newest':
        return plugins.sort((a, b) => parseFloat(b.version) - parseFloat(a.version));
      case 'name':
        return plugins.sort((a, b) => a.name.localeCompare(b.name));
      default:
        return plugins;
    }
  });

  function clearSearch() {
    searchInput = '';
  }

  function clearFilters() {
    searchInput = '';
    selectedCategory = null;
    statusFilter = '';
    starredOnly = false;
  }

  const sortOptions = [
    { value: 'popular', label: m.marketplace_agentsListSortPopular() },
    { value: 'newest', label: m.marketplace_agentsListSortNewest() },
    { value: 'name', label: m.marketplace_agentsListSortName() },
  ];
  const pageState = $derived(
    filtered.length === 0
      ? {
          kind: 'empty' as const,
          title: m.marketplace_pluginsNoResults(),
          description: m.marketplace_agentsListEmptyHint(),
        }
      : { kind: 'ready' as const },
  );
</script>

<PageShell archetype="collection" scroll="region" labelledBy="marketplace-plugins-title">
  <!-- Compact toolbar header — fixed; only the content below scrolls -->
  <header class="shrink-0 flex flex-col border-b border-border bg-bg2/80 backdrop-blur-sm">
    <!-- Primary row -->
    <div class="flex items-center gap-3 px-4 py-2.5 md:pr-[var(--notch-clearance)]">
      <Puzzle size={13} class="text-[var(--color-brand-pink)] shrink-0" />
      <h1 id="marketplace-plugins-title" class="text-sm font-semibold tracking-tight">
        {m.marketplace_plugins()}
      </h1>
      {#if filtered.length > 0}
        <span
          class="text-xs bg-bg3 text-muted-foreground border border-border rounded-full px-1.5 leading-5 tabular-nums"
          >{filtered.length}</span
        >
      {/if}
      <span class="text-xs text-muted-strong hidden md:block truncate"
        >{m.marketplace_pluginsSubtitle()}</span
      >
      <div class="flex-1"></div>

      <!-- Search -->
      <div class="relative flex items-center">
        <Search
          size={12}
          class="absolute left-2.5 text-muted-foreground pointer-events-none shrink-0"
        />
        <input
          type="text"
          placeholder={m.marketplace_pluginsSearch()}
          bind:value={searchInput}
          class="text-xs pl-7 pr-6 py-1 h-7 w-44 bg-bg3 text-foreground border border-border rounded-md placeholder:text-muted-foreground focus:outline-none focus:border-[var(--color-brand-pink)] [color-scheme:dark] transition-colors"
        />
        {#if searchInput}
          <Button
            variant="ghost"
            size="icon"
            type="button"
            class="absolute right-1 h-6 w-6 text-muted-foreground"
            onclick={clearSearch}
            aria-label={m.builder_clear()}
          >
            <X size={11} />
          </Button>
        {/if}
      </div>

      <!-- Sort -->
      <Select
        bind:value={sortBy}
        size="xs"
        class="text-xs h-7 py-0 px-2 bg-bg3 text-foreground border border-border rounded-md focus:outline-none focus:border-[var(--color-brand-pink)] [color-scheme:dark] cursor-pointer transition-colors"
      >
        <option value="popular">{m.marketplace_agentsListSortPopular()}</option>
        <option value="newest">{m.marketplace_agentsListSortNewest()}</option>
        <option value="name">{m.marketplace_agentsListSortName()}</option>
      </Select>

      <!-- View toggle -->
      <div class="flex gap-0.5 p-0.5 bg-bg3 border border-border rounded-md">
        <Button
          variant="ghost"
          size="icon"
          type="button"
          onclick={() => (viewMode = 'grid')}
          aria-label={m.marketplace_agentsListGridView()}
          aria-pressed={viewMode === 'grid'}
          class="w-6 h-6 {viewMode === 'grid'
            ? 'bg-[color-mix(in_srgb,var(--color-brand-pink)_15%,transparent)] text-[var(--color-brand-pink)]'
            : 'text-muted-foreground'}"
        >
          <Grid3X3 size={12} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          type="button"
          onclick={() => (viewMode = 'list')}
          aria-label={m.marketplace_agentsListListView()}
          aria-pressed={viewMode === 'list'}
          class="w-6 h-6 {viewMode === 'list'
            ? 'bg-[color-mix(in_srgb,var(--color-brand-pink)_15%,transparent)] text-[var(--color-brand-pink)]'
            : 'text-muted-foreground'}"
        >
          <List size={12} />
        </Button>
      </div>
    </div>

    <!-- Filter row: new controls left, pills right -->
    <div class="flex items-center gap-2 px-4 pb-2.5">
      <!-- Status filter -->
      <Select
        bind:value={statusFilter}
        size="xs"
        class="text-xs h-6 py-0 px-2 bg-bg3 text-muted-foreground border border-border rounded-md focus:outline-none [color-scheme:dark] cursor-pointer transition-colors hover:text-foreground"
      >
        {#each statusOptions as opt (opt.value)}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </Select>

      <!-- Starred/popular toggle -->
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onclick={() => (starredOnly = !starredOnly)}
        class="text-xs py-0.5 px-2.5 rounded-md border whitespace-nowrap cursor-pointer transition-colors flex items-center gap-1.5
                    {starredOnly
          ? 'bg-[color-mix(in_srgb,var(--color-warning)_15%,transparent)] border-[color-mix(in_srgb,var(--color-warning)_30%,transparent)] text-[var(--color-warning)]'
          : 'bg-bg3 border-border text-muted-foreground hover:text-foreground'}"
      >
        <Star size={10} />
        {m.marketplace_pluginsPopular()}
      </Button>

      <div class="flex-1"></div>

      <!-- Category pills (right-aligned) -->
      <div class="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
        {#each categories as cat (cat.id ?? 'all')}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onclick={() => {
              selectedCategory = cat.id;
            }}
            class="text-xs py-0.5 px-2.5 rounded-full border whitespace-nowrap cursor-pointer transition-colors
                            {selectedCategory === cat.id
              ? 'bg-[color-mix(in_srgb,var(--color-brand-pink)_15%,transparent)] border-[color-mix(in_srgb,var(--color-brand-pink)_30%,transparent)] text-[var(--color-brand-pink)]'
              : 'bg-bg3 border-border text-muted-foreground hover:text-foreground hover:border-border/80'}"
          >
            {cat.label}
          </Button>
        {/each}
      </div>
    </div>
  </header>

  <!-- Content area — owns the scroll -->
  <PageBody padding="compact" scroll="region">
    {#if filtered.length === 0}
      <div class="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <Package size={32} class="text-muted-strong" />
        <div>
          <h3 class="text-sm font-semibold text-foreground mb-1">
            {m.marketplace_pluginsNoResults()}
          </h3>
          <p class="text-xs text-muted-foreground">{m.marketplace_agentsListEmptyHint()}</p>
        </div>
        {#if searchInput || selectedCategory || statusFilter || starredOnly}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onclick={() => {
              searchInput = '';
              selectedCategory = null;
              statusFilter = '';
              starredOnly = false;
            }}
            class="text-xs px-3 py-1.5 bg-bg3 border border-border rounded-md text-muted-foreground hover:text-foreground hover:bg-border cursor-pointer transition-colors"
          >
            {m.marketplace_agentsListClearFilters()}
          </Button>
        {/if}
      </div>
    {:else}
      <p class="text-xs text-muted-foreground mb-3">
        {filtered.length === 1
          ? m.marketplace_pluginsShowing({ count: filtered.length })
          : m.marketplace_pluginsShowingPlural({ count: filtered.length })}
      </p>

      {#if viewMode === 'grid'}
        <div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
          {#each filtered as plugin (plugin.id)}
            <div class="plugin-card">
              <div class="plugin-card-top">
                <!-- Icon -->
                <div
                  class="plugin-icon"
                  style:background="color-mix(in srgb, {plugin.color} 15%, transparent)"
                  style:border-color="color-mix(in srgb, {plugin.color} 25%, transparent)"
                >
                  <span class="plugin-letter" style:color={plugin.color}>{plugin.name[0]}</span>
                </div>
                <div class="plugin-meta">
                  <div class="flex items-center gap-1.5">
                    <span class="plugin-name">{plugin.name}</span>
                    <span
                      class="status-dot"
                      style:background={STATUS_COLOR[plugin.status]}
                      title={plugin.status}
                    ></span>
                  </div>
                  <span class="plugin-author">{m.marketplace_by({ author: plugin.author })}</span>
                </div>
              </div>

              <p class="plugin-desc">{plugin.description}</p>

              <div class="plugin-tags">
                <span
                  class="cat-badge"
                  style:color={plugin.color}
                  style:background="color-mix(in srgb, {plugin.color} 12%, transparent)"
                  style:border-color="color-mix(in srgb, {plugin.color} 22%, transparent)"
                  >{plugin.category}</span
                >
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
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onclick={() =>
                    installed.has(plugin.id)
                      ? installed.delete(plugin.id)
                      : installed.add(plugin.id)}
                  class="install-btn {installed.has(plugin.id) ? 'installed' : ''}"
                >
                  {installed.has(plugin.id) ? m.marketplace_installed() : m.marketplace_install()}
                </Button>
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <div class="flex flex-col gap-2">
          {#each filtered as plugin (plugin.id)}
            <div class="plugin-list-item">
              <div
                class="plugin-icon sm"
                style:background="color-mix(in srgb, {plugin.color} 15%, transparent)"
                style:border-color="color-mix(in srgb, {plugin.color} 25%, transparent)"
              >
                <span class="plugin-letter" style:color={plugin.color}>{plugin.name[0]}</span>
              </div>
              <div class="list-main">
                <div class="list-top">
                  <span class="plugin-name">{plugin.name}</span>
                  <span class="status-dot" style:background={STATUS_COLOR[plugin.status]}></span>
                  <span class="plugin-author"
                    >{m.marketplace_by({ author: plugin.author })} · v{plugin.version}</span
                  >
                </div>
                <p class="plugin-desc">{plugin.description}</p>
                <div class="plugin-tags">
                  <span
                    class="cat-badge"
                    style:color={plugin.color}
                    style:background="color-mix(in srgb, {plugin.color} 12%, transparent)"
                    style:border-color="color-mix(in srgb, {plugin.color} 22%, transparent)"
                    >{plugin.category}</span
                  >
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
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onclick={() =>
                    installed.has(plugin.id)
                      ? installed.delete(plugin.id)
                      : installed.add(plugin.id)}
                  class="install-btn {installed.has(plugin.id) ? 'installed' : ''}"
                >
                  {installed.has(plugin.id) ? m.marketplace_installed() : m.marketplace_install()}
                </Button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </PageBody>
</PageShell>

<style>
  /* Plugin card (grid view) */
  .plugin-card {
    background: var(--color-bg2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    transition: border-color var(--duration-fast) var(--ease-standard);
    cursor: default;
  }
  .plugin-card:hover {
    border-color: color-mix(in srgb, var(--color-brand-pink) 30%, transparent);
  }

  .plugin-card-top {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
  }

  .plugin-icon {
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-lg);
    border: 1px solid;
  }
  .plugin-icon.sm {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border-radius: var(--radius-md);
    border: 1px solid;
  }

  .plugin-letter {
    font-size: var(--font-size-body, 14px);
    font-weight: 800;
    line-height: 1;
  }
  .plugin-icon.sm .plugin-letter {
    font-size: var(--font-size-caption, 12px);
  }

  .plugin-meta {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }
  .plugin-name {
    font-size: var(--font-size-body, 14px);
    font-weight: 600;
    color: var(--color-foreground);
  }
  .plugin-author {
    font-size: var(--font-size-caption, 12px);
    color: var(--color-muted);
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
  }

  .plugin-desc {
    font-size: var(--font-size-caption, 12px);
    line-height: 1.55;
    color: var(--color-muted);
    margin: 0;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .plugin-tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .cat-badge {
    font-size: var(--font-size-caption, 12px);
    font-weight: 600;
    text-transform: capitalize;
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    border: 1px solid;
    letter-spacing: 0.02em;
  }
  .tag-badge {
    font-size: var(--font-size-caption, 12px);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    background: var(--color-bg3);
    border: 1px solid var(--color-border);
    color: var(--color-muted);
  }

  .plugin-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: auto;
  }

  .plugin-stats {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .stat {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-caption, 12px);
    color: var(--color-muted);
    font-variant-numeric: tabular-nums;
  }
  .version {
    font-size: var(--font-size-caption, 12px);
    color: var(--color-muted);
    font-family: monospace;
  }

  :global(.install-btn) {
    font-size: var(--font-size-caption, 12px);
    font-weight: 600;
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-bg3);
    color: var(--color-muted-foreground);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-standard);
    white-space: nowrap;
  }
  :global(.install-btn:hover) {
    background: var(--color-brand-pink);
    border-color: var(--color-brand-pink);
    color: var(--color-accent-foreground);
  }
  :global(.install-btn.installed) {
    background: color-mix(in srgb, var(--color-success) 15%, transparent);
    border-color: color-mix(in srgb, var(--color-success) 30%, transparent);
    color: var(--color-success);
  }
  :global(.install-btn.installed:hover) {
    background: color-mix(in srgb, var(--color-destructive) 15%, transparent);
    border-color: color-mix(in srgb, var(--color-destructive) 30%, transparent);
    color: var(--color-destructive);
  }

  /* List view */
  .plugin-list-item {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--color-bg2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    transition: border-color var(--duration-fast) var(--ease-standard);
  }
  .plugin-list-item:hover {
    border-color: color-mix(in srgb, var(--color-brand-pink) 30%, transparent);
  }

  .list-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .list-top {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .plugin-list-item .plugin-desc {
    -webkit-line-clamp: 1;
    line-clamp: 1;
  }

  .list-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-2);
    flex-shrink: 0;
  }
</style>
