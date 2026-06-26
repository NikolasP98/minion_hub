<script lang="ts">
  import { LayoutDashboard, Users, Sparkles, Settings } from 'lucide-svelte';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import { SideNav, type SideNavItem } from '$lib/components/ui';
  import { canViewPath } from '$lib/access/can.svelte';

  const pathname = $derived(page.url.pathname);

  function isActive(id: string): boolean {
    if (id === 'dashboard') return pathname === '/crm';
    if (id === 'settings') return pathname.startsWith('/crm/settings') || pathname.startsWith('/crm/cleanup');
    if (id === 'insights') return pathname.startsWith('/crm/insights');
    // Customers owns the ranked list and every contact-detail drill-down (/crm/<id>).
    return pathname.startsWith('/crm/customers') || (pathname.startsWith('/crm/') && pathname !== '/crm' && !pathname.startsWith('/crm/settings') && !pathname.startsWith('/crm/cleanup') && !pathname.startsWith('/crm/insights'));
  }

  // Insights is a subsection of the Dashboard → nested (indented) directly under it.
  // Subpage links hide when the role lacks their sub-resource view cap.
  const items = $derived<SideNavItem[]>(
    [
      { id: 'dashboard', label: m.crm_nav_dashboard(), icon: LayoutDashboard, href: '/crm' },
      { id: 'insights', label: m.crm_nav_insights(), icon: Sparkles, href: '/crm/insights', indent: 1 },
      { id: 'customers', label: m.crm_nav_customers(), icon: Users, href: '/crm/customers' },
      { id: 'settings', label: m.crm_nav_settings(), icon: Settings, href: '/crm/settings' },
    ].filter((i) => canViewPath(i.href)),
  );

  const activeId = $derived(items.find((i) => isActive(i.id))?.id);
</script>

<SideNav {items} {activeId} ariaLabel="CRM" header={m.crm_title()} />
