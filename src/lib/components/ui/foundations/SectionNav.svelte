<script lang="ts" module>
  import type { LucideIcon } from '$lib/plugins/icon-map';

  // lucide-svelte still publishes legacy constructor types while Hub uses the
  // Svelte 5 component runtime. Keep the boundary explicit and type-safe.
  export type SectionNavIcon = LucideIcon | string;

  export interface SectionNavItem {
    id: string;
    label: string;
    href?: string;
    icon?: SectionNavIcon;
    badge?: string | number;
    disabled?: boolean;
    dot?: boolean;
  }

  export interface SectionNavGroup {
    id: string;
    label?: string;
    items: SectionNavItem[];
  }
</script>

<script lang="ts">
  import NavIcon from '$lib/components/layout/NavIcon.svelte';

  interface Props {
    items: SectionNavItem[] | SectionNavGroup[];
    ariaLabel: string;
    activeId?: string;
    onSelect?: (id: string) => void;
    search?: { enabled: boolean; placeholder?: string };
    searchQuery?: string;
    class?: string;
  }

  let {
    items,
    ariaLabel,
    activeId,
    onSelect,
    search,
    searchQuery = $bindable(''),
    class: cls = '',
  }: Props = $props();

  function isGroup(item: SectionNavItem | SectionNavGroup): item is SectionNavGroup {
    return 'items' in item;
  }

  const groups = $derived.by<SectionNavGroup[]>(() => {
    if (items.length === 0) return [];
    const candidates = items as Array<SectionNavItem | SectionNavGroup>;
    return isGroup(candidates[0])
      ? (items as SectionNavGroup[])
      : [{ id: 'default', items: items as SectionNavItem[] }];
  });

  const normalizedQuery = $derived(searchQuery.trim().toLocaleLowerCase());
  const visibleGroups = $derived.by<SectionNavGroup[]>(() =>
    groups
      .map((group) => ({
        ...group,
        items: normalizedQuery
          ? group.items.filter((item) => item.label.toLocaleLowerCase().includes(normalizedQuery))
          : group.items,
      }))
      .filter((group) => group.items.length > 0),
  );
</script>

<aside data-component="section-nav" data-part="section-nav" aria-label={ariaLabel} class={cls}>
  {#if search?.enabled}
    <div class="nav-search">
      <label>
        <span class="visually-hidden">{search.placeholder ?? ariaLabel}</span>
        <input
          type="search"
          bind:value={searchQuery}
          placeholder={search.placeholder ?? ''}
          aria-label={search.placeholder ?? ariaLabel}
        />
      </label>
    </div>
  {/if}
  <nav>
    {#each visibleGroups as group (group.id)}
      <div class="nav-group" role="group" aria-label={group.label}>
        {#if group.label}<span class="group-label">{group.label}</span>{/if}
        <div class="group-items">
          {#each group.items as item (item.id)}
            {@const Icon = item.icon}
            {@const active = item.id === activeId}
            {#if item.href && !item.disabled}
              <a
                href={item.href}
                class:active
                class="nav-item"
                aria-current={active ? 'page' : undefined}
              >
                {#if Icon}<span class="nav-icon" aria-hidden="true"><NavIcon icon={Icon} size={16} /></span>{/if}
                <span class="item-label">{item.label}</span>
                {#if item.badge != null}<span class="item-badge">{item.badge}</span>{/if}
                {#if item.dot}<span class="item-dot" aria-hidden="true"></span>{/if}
              </a>
            {:else if item.href}
              <span class="nav-item" role="link" aria-disabled="true">
                {#if Icon}<span class="nav-icon" aria-hidden="true"><NavIcon icon={Icon} size={16} /></span>{/if}
                <span class="item-label">{item.label}</span>
                {#if item.badge != null}<span class="item-badge">{item.badge}</span>{/if}
              </span>
            {:else}
              <button
                type="button"
                class:active
                class="nav-item"
                disabled={item.disabled}
                aria-current={active ? 'page' : undefined}
                onclick={() => onSelect?.(item.id)}
              >
                {#if Icon}<span class="nav-icon" aria-hidden="true"><NavIcon icon={Icon} size={16} /></span>{/if}
                <span class="item-label">{item.label}</span>
                {#if item.badge != null}<span class="item-badge">{item.badge}</span>{/if}
                {#if item.dot}<span class="item-dot" aria-hidden="true"></span>{/if}
              </button>
            {/if}
          {/each}
        </div>
      </div>
    {/each}
  </nav>
</aside>

<style>
  [data-component='section-nav'] {
    display: flex;
    width: var(--section-nav-expanded, 208px);
    height: 100%;
    min-height: 0;
    flex-direction: column;
    border-right: 1px solid var(--color-border-subtle, var(--hairline));
    background: var(--color-surface-1, var(--elevation-1-bg));
  }
  nav {
    display: flex;
    height: 100%;
    min-height: 0;
    padding: var(--space-3, 12px) var(--space-2, 8px);
    flex-direction: column;
    gap: var(--space-3, 12px);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .nav-search {
    flex: none;
    padding: var(--space-2, 8px) var(--space-2, 8px) 0;
  }
  .nav-search label,
  .nav-search input {
    width: 100%;
  }
  .nav-search input {
    min-height: var(--control-height-md, 32px);
    padding-inline: var(--space-2, 8px);
    border: 1px solid var(--color-border-default, var(--color-border));
    border-radius: var(--radius-md);
    color: var(--color-text-primary, var(--color-foreground));
    background: var(--color-surface-2, var(--color-bg2));
    font: inherit;
  }
  .nav-search input:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .nav-group,
  .group-items {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5, 2px);
  }
  .group-label {
    padding: var(--space-2, 8px) var(--space-2, 8px) var(--space-1, 4px);
    color: var(--color-text-tertiary, var(--color-muted-foreground));
    font-size: var(--font-size-label, 12px);
    line-height: var(--line-height-compact, 16px);
    font-weight: var(--font-weight-semibold, 600);
    letter-spacing: var(--letter-spacing-label, 0.04em);
    text-transform: uppercase;
  }
  .nav-item {
    display: flex;
    width: 100%;
    min-height: var(--control-height-md, 32px);
    padding: var(--space-2, 8px);
    align-items: center;
    gap: var(--space-control-gap, 8px);
    border: 0;
    border-radius: var(--radius-md);
    color: var(--color-text-secondary, var(--color-muted));
    background: transparent;
    font-size: var(--font-size-body, 14px);
    line-height: var(--line-height-body, 20px);
    font-weight: var(--font-weight-medium, 500);
    text-align: left;
    text-decoration: none;
    white-space: nowrap;
    transition:
      color var(--duration-fast, 150ms) var(--ease-standard),
      background-color var(--duration-fast, 150ms) var(--ease-standard);
  }
  .nav-item:hover:not([aria-disabled='true']):not(:disabled) {
    color: var(--color-text-primary, var(--color-foreground));
    background: color-mix(
      in srgb,
      var(--color-text-primary, var(--color-foreground)) 6%,
      transparent
    );
  }
  .nav-item.active {
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    font-weight: var(--font-weight-semibold, 600);
  }
  .nav-item:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .nav-item:disabled,
  .nav-item[aria-disabled='true'] {
    opacity: 0.45;
  }
  .item-label {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .nav-icon {
    display: inline-flex;
    flex: none;
  }
  .item-badge {
    min-width: 1.25rem;
    padding-inline: var(--space-1, 4px);
    border-radius: var(--radius-full, 9999px);
    color: var(--color-text-tertiary, var(--color-muted-foreground));
    background: var(--color-surface-2, var(--elevation-2-bg));
    font-size: var(--font-size-caption, 12px);
    line-height: var(--line-height-compact, 16px);
    text-align: center;
  }
  .item-dot {
    width: var(--space-1, 4px);
    height: var(--space-1, 4px);
    flex: none;
    border-radius: var(--radius-full, 9999px);
    background: var(--color-accent);
  }

  @media (max-width: 1279.98px) {
    [data-component='section-nav'] {
      width: 100%;
      height: auto;
      border-right: 0;
      border-bottom: 1px solid var(--color-border-subtle, var(--hairline));
    }
    nav {
      flex-direction: row;
      gap: var(--space-4, 16px);
      padding: var(--space-2, 8px) var(--space-page-gutter, 24px);
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: thin;
    }
    .nav-search {
      padding: var(--space-2, 8px) var(--space-page-gutter, 24px) 0;
    }
    .nav-group {
      flex: none;
      flex-direction: row;
      align-items: center;
      gap: var(--space-2, 8px);
    }
    .group-items {
      flex-direction: row;
    }
    .group-label {
      padding: 0;
      writing-mode: horizontal-tb;
    }
    .nav-item {
      width: auto;
      min-height: var(--control-height-touch, 44px);
      padding-inline: var(--space-3, 12px);
    }
    .item-label {
      overflow: visible;
    }
  }
  @media (max-width: 767.98px) {
    nav {
      padding-inline: var(--space-page-gutter, 16px);
    }
    .nav-search {
      padding-inline: var(--space-page-gutter, 16px);
    }
    .group-label {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
    }
  }
</style>
