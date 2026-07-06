<script lang="ts" module>
  import type { Component } from 'svelte';

  export interface SideNavItem {
    id: string;
    label: string;
    /** lucide-svelte (or any) component rendered as the leading icon. */
    icon?: Component<{ size?: number | string; class?: string }> | any;
    /** When set, the item renders as an <a>; otherwise a <button> firing onSelect. */
    href?: string;
    badge?: string | number;
    /** Extra text folded into search matching (e.g. nested field labels/help). */
    keywords?: string;
    /** Small trailing accent dot — used for "unsaved changes" markers. */
    dot?: boolean;
    disabled?: boolean;
    /** Renders a small "admin" tag next to the label (matches SettingsNav). */
    adminOnly?: boolean;
    /** Tree nesting depth (1 = child) — indents the row + draws a tree guide. */
    indent?: number;
  }

  export interface SideNavGroup {
    label?: string;
    /** Renders the small "admin" tag on the group header. */
    adminOnly?: boolean;
    items: SideNavItem[];
  }

  function isGroup(x: SideNavItem | SideNavGroup): x is SideNavGroup {
    return Array.isArray((x as SideNavGroup).items);
  }
</script>

<script lang="ts">
  import { Search } from 'lucide-svelte';
  import NavIcon from '$lib/components/layout/NavIcon.svelte';
  import { persistScroll } from '$lib/actions/persist-scroll';

  interface Props {
    /** Accepts a flat item list or grouped sections (detected by `.items`). */
    items: SideNavItem[] | SideNavGroup[];
    /** id of the active item — drives the highlight + aria-current. */
    activeId?: string;
    ariaLabel?: string;
    /** Optional sticky header label (the small uppercase t-label heading). */
    header?: string;
    search?: { enabled: boolean; placeholder?: string };
    searchQuery?: string;
    onSelect?: (id: string) => void;
    /** Draw hairline dividers between groups. */
    dividers?: boolean;
    /** Use the left-border active indicator variant (AgentSettingsNav style). */
    leftBorder?: boolean;
    class?: string;
  }

  let {
    items,
    activeId,
    ariaLabel,
    header,
    search,
    searchQuery = $bindable(''),
    onSelect,
    dividers = true,
    leftBorder = false,
    class: cls = '',
  }: Props = $props();

  // Normalize either shape to groups for a single render path.
  const groups = $derived.by<SideNavGroup[]>(() => {
    const src = items as (SideNavItem | SideNavGroup)[];
    if (src.length === 0) return [];
    if (isGroup(src[0])) return src as SideNavGroup[];
    return [{ items: src as SideNavItem[] }];
  });

  const ql = $derived(searchQuery.trim().toLowerCase());
  function matches(it: SideNavItem): boolean {
    if (!ql) return true;
    return (
      it.label.toLowerCase().includes(ql) ||
      (it.keywords?.toLowerCase().includes(ql) ?? false)
    );
  }

  // Apply the search filter, then drop groups left empty.
  const visibleGroups = $derived.by<SideNavGroup[]>(() =>
    groups
      .map((g) => ({ ...g, items: g.items.filter(matches) }))
      .filter((g) => g.items.length > 0),
  );

  // Preserve this nav's scroll position across navigation (each nav keyed distinctly).
  const scrollKey = $derived(`sidenav:${ariaLabel ?? header ?? 'default'}`);
</script>

<aside
  class="surface-1 shrink-0 w-14 xl:w-[208px] h-full border-r border-[var(--hairline)] flex flex-col overflow-hidden {cls}"
  aria-label={ariaLabel}
>
  {#if search?.enabled}
    <div class="shrink-0 p-2 hidden xl:block">
      <div class="relative">
        <Search size={13} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        <input
          type="text"
          bind:value={searchQuery}
          placeholder={search.placeholder ?? ''}
          class="focus-ring-none w-full h-8 pl-7 pr-2 text-xs rounded-[var(--radius-md)] bg-bg2 border border-[var(--hairline)] text-foreground placeholder:text-muted focus:border-accent/60 transition-colors duration-[150ms]"
          aria-label={search.placeholder ?? ariaLabel}
        />
      </div>
    </div>
  {/if}

  <nav use:persistScroll={scrollKey} class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2 py-3 flex flex-col gap-0.5" class:no-search-pad={search?.enabled}>
    {#if header}
      <div class="set-head t-label hidden xl:block">{header}</div>
    {/if}

    {#each visibleGroups as group, gi (group.label ?? gi)}
      {#if dividers && (gi > 0 || (header && group.label))}
        <div class="set-divider"></div>
      {/if}
      {#if group.label}
        <div class="set-head t-label hidden xl:flex items-center gap-1.5">
          {group.label}
          {#if group.adminOnly}<span class="admin-badge">admin</span>{/if}
        </div>
      {/if}

      {#each group.items as item (item.id)}
        {@const Icon = item.icon}
        {@const active = activeId != null && item.id === activeId}
        {#if item.href}
          <a
            href={item.href}
            class="set-row"
            class:set-child={!!item.indent}
            class:set-active={active && !leftBorder}
            class:set-active-border={active && leftBorder}
            style:--indent={item.indent ?? 0}
            aria-current={active ? 'page' : undefined}
            aria-disabled={item.disabled ? 'true' : undefined}
            title={item.label}
          >
            {#if Icon}<NavIcon icon={Icon} size={16} class="set-icon shrink-0" />{/if}
            <span class="hidden xl:inline flex-1 truncate">{item.label}</span>
            {#if item.adminOnly}<span class="admin-badge hidden xl:inline-flex">admin</span>{/if}
            {#if item.badge != null}<span class="set-badge hidden xl:inline">{item.badge}</span>{/if}
            {#if item.dot && !active}<span class="set-dot shrink-0" aria-label="unsaved changes"></span>{/if}
          </a>
        {:else}
          <button
            type="button"
            class="set-row text-left"
            class:set-child={!!item.indent}
            class:set-active={active && !leftBorder}
            class:set-active-border={active && leftBorder}
            style:--indent={item.indent ?? 0}
            aria-current={active ? 'page' : undefined}
            disabled={item.disabled}
            title={item.label}
            onclick={() => onSelect?.(item.id)}
          >
            {#if Icon}<NavIcon icon={Icon} size={16} class="set-icon shrink-0" />{/if}
            <span class="hidden xl:inline flex-1 truncate">{item.label}</span>
            {#if item.adminOnly}<span class="admin-badge hidden xl:inline-flex">admin</span>{/if}
            {#if item.badge != null}<span class="set-badge hidden xl:inline">{item.badge}</span>{/if}
            {#if item.dot && !active}<span class="set-dot shrink-0" aria-label="unsaved changes"></span>{/if}
          </button>
        {/if}
      {/each}
    {/each}
  </nav>
</aside>

<style>
  /* Drop the nav's own top padding when the search box already supplies it. */
  .no-search-pad {
    padding-top: 0;
  }
  .set-row {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    min-height: 2rem;
    padding: 0.375rem 0.625rem;
    border-radius: var(--radius-md);
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-muted);
    text-decoration: none;
    white-space: nowrap;
    background: transparent;
    border: none;
    cursor: pointer;
    width: 100%;
    transition:
      color var(--duration-fast) var(--ease-standard),
      background-color var(--duration-fast) var(--ease-standard);
  }
  .set-row:disabled,
  .set-row[aria-disabled='true'] {
    opacity: 0.4;
    pointer-events: none;
  }
  .set-row :global(.set-icon) {
    opacity: 0.7;
    transition: opacity var(--duration-fast) var(--ease-standard);
  }
  .set-row:hover {
    color: var(--color-foreground);
    background: rgba(255, 255, 255, 0.05);
  }
  .set-row:hover :global(.set-icon) {
    opacity: 1;
  }
  /* Tree-nested child row: indent + an elbow guide connecting it to the parent. */
  .set-child {
    padding-left: calc(0.625rem + var(--indent, 1) * 1.15rem);
    position: relative;
  }
  .set-child::before {
    content: '';
    position: absolute;
    left: calc(0.625rem + (var(--indent, 1) - 1) * 1.15rem + 0.45rem);
    top: -0.25rem;
    bottom: 50%;
    width: 0.55rem;
    border-left: 1px solid var(--hairline);
    border-bottom: 1px solid var(--hairline);
    border-bottom-left-radius: 5px;
    pointer-events: none;
  }
  /* Icon-only (collapsed, < xl): drop the indent + elbow so the child icon stays
     aligned with its siblings — both only make sense beside a visible label. */
  @media (max-width: 1279.98px) {
    .set-child { padding-left: 0.625rem; }
    .set-child::before { content: none; }
  }
  /* Background-tint active (CRM / Finance / Settings). */
  .set-active {
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    font-weight: 600;
  }
  .set-active :global(.set-icon) {
    opacity: 1;
    color: var(--color-accent);
  }
  /* Left-border active (AgentSettingsNav). */
  .set-active-border {
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    font-weight: 600;
    border-left: 2px solid var(--color-accent);
    margin-left: -1px;
  }
  .set-active-border :global(.set-icon) {
    opacity: 1;
    color: var(--color-accent);
  }
  .set-head {
    padding: 0.5rem 0.625rem 0.25rem;
  }
  .set-divider {
    height: 1px;
    background: var(--hairline);
    margin: 0.375rem 0.375rem;
  }
  .set-badge {
    margin-left: auto;
    font-size: 0.5625rem;
    color: var(--color-muted);
    font-weight: 500;
  }
  .set-dot {
    margin-left: auto;
    width: 0.375rem;
    height: 0.375rem;
    border-radius: 9999px;
    background: var(--color-accent);
  }
  .admin-badge {
    font-size: 0.5rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 0.0625rem 0.25rem;
    border-radius: var(--radius-xs);
    color: var(--color-warning);
    background: color-mix(in srgb, var(--color-warning) 14%, transparent);
  }
</style>
