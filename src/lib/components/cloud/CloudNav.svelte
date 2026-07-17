<script lang="ts">
  import { canonicalPath } from '$lib/canonical-path';
  import { page } from '$app/state';
  import { Gauge, Monitor, Settings, SquareTerminal } from 'lucide-svelte';
  import { SideNav, type SideNavItem } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';

  let {
    canConnect,
    canManage,
    mode = 'desktop',
  }: {
    canConnect: boolean;
    canManage: boolean;
    mode?: 'desktop' | 'compact';
  } = $props();

  const selected = $derived(page.url.searchParams.get('server'));
  const suffix = $derived(selected ? `?server=${encodeURIComponent(selected)}` : '');
  const pathname = $derived(canonicalPath(page.url.pathname));
  const items = $derived<SideNavItem[]>([
    { id: 'overview', label: m.cloud_nav_overview(), icon: Gauge, href: `/cloud${suffix}` },
    ...(canConnect
      ? [
          { id: 'gui', label: m.cloud_nav_gui(), icon: Monitor, href: `/cloud/gui${suffix}` },
          {
            id: 'terminal',
            label: m.cloud_nav_terminal(),
            icon: SquareTerminal,
            href: `/cloud/terminal${suffix}`,
          },
        ]
      : []),
    ...(canManage
      ? [
          {
            id: 'settings',
            label: m.cloud_nav_settings(),
            icon: Settings,
            href: `/cloud/settings${suffix}`,
          },
        ]
      : []),
  ]);
  const activeId = $derived(
    pathname.startsWith('/cloud/gui')
      ? 'gui'
      : pathname.startsWith('/cloud/terminal')
        ? 'terminal'
        : pathname.startsWith('/cloud/settings')
          ? 'settings'
          : 'overview',
  );
</script>

{#if mode === 'desktop'}
  <SideNav {items} {activeId} ariaLabel={m.cloud_title()} header={m.cloud_title()} />
{:else}
  <nav class="compact-nav" aria-label={m.cloud_title()}>
    {#each items as item (item.id)}
      {@const Icon = item.icon}
      <a
        href={item.href}
        class:active={activeId === item.id}
        aria-current={activeId === item.id ? 'page' : undefined}
      >
        {#if Icon}<Icon size={15} aria-hidden="true" />{/if}
        <span>{item.label}</span>
      </a>
    {/each}
  </nav>
{/if}

<style>
  .compact-nav {
    display: flex;
    min-width: 0;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-page-gutter);
    overflow-x: auto;
    border-bottom: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    scrollbar-width: none;
  }

  .compact-nav a {
    display: inline-flex;
    min-width: max-content;
    min-height: var(--control-height-touch);
    flex: 1;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding-inline: var(--space-3);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-medium);
    text-decoration: none;
    transition:
      color var(--duration-fast) var(--ease-standard),
      background-color var(--duration-fast) var(--ease-standard);
  }

  .compact-nav a:hover,
  .compact-nav a.active {
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }
</style>
