<script lang="ts">
  import { LayoutDashboard, Users, Settings } from 'lucide-svelte';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';

  type CrmTab = { id: string; label: () => string; icon: typeof Users; href: string };
  const TABS: CrmTab[] = [
    { id: 'dashboard', label: () => m.crm_nav_dashboard(), icon: LayoutDashboard, href: '/crm' },
    { id: 'customers', label: () => m.crm_nav_customers(), icon: Users, href: '/crm/customers' },
    { id: 'settings', label: () => m.crm_nav_settings(), icon: Settings, href: '/crm/settings' },
  ];

  const pathname = $derived(page.url.pathname);

  function isActive(id: string): boolean {
    if (id === 'dashboard') return pathname === '/crm';
    if (id === 'settings') return pathname.startsWith('/crm/settings') || pathname.startsWith('/crm/cleanup');
    // Customers owns the ranked list and every contact-detail drill-down (/crm/<id>).
    return pathname.startsWith('/crm/customers') || (pathname.startsWith('/crm/') && pathname !== '/crm' && !pathname.startsWith('/crm/settings') && !pathname.startsWith('/crm/cleanup'));
  }
</script>

<aside
  class="surface-1 shrink-0 w-14 lg:w-[208px] h-full border-r border-[var(--hairline)] flex flex-col overflow-hidden"
  aria-label="CRM"
>
  <nav class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2 py-3 flex flex-col gap-0.5">
    <div class="set-head t-label hidden lg:block">{m.crm_title()}</div>
    {#each TABS as tab (tab.id)}
      {@const Icon = tab.icon}
      {@const active = isActive(tab.id)}
      <a href={tab.href} class="set-row {active ? 'set-active' : ''}" aria-current={active ? 'page' : undefined} title={tab.label()}>
        <Icon size={16} class="set-icon shrink-0" />
        <span class="hidden lg:inline">{tab.label()}</span>
      </a>
    {/each}
  </nav>
</aside>

<style>
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
  .set-active {
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    font-weight: 600;
  }
  .set-active :global(.set-icon) {
    opacity: 1;
    color: var(--color-accent);
  }
  .set-head {
    padding: 0.5rem 0.625rem 0.25rem;
  }
</style>
