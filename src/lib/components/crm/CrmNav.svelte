<script lang="ts">
  import { canonicalPath } from '$lib/canonical-path';
  import { LayoutDashboard, Users, Sparkles, Settings, Network } from 'lucide-svelte';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import { SectionNav, type SectionNavItem } from '$lib/components/ui/foundations';
  import { canViewPath } from '$lib/access/can.svelte';

  const pathname = $derived(canonicalPath(page.url.pathname));

  function isActive(id: string): boolean {
    if (id === 'dashboard') return pathname === '/crm';
    if (id === 'settings')
      return pathname.startsWith('/crm/settings') || pathname.startsWith('/crm/cleanup');
    if (id === 'insights') return pathname.startsWith('/crm/insights');
    if (id === 'graph') return pathname.startsWith('/crm/graph');
    // Customers owns the ranked list and every contact-detail drill-down (/crm/<id>).
    return (
      pathname.startsWith('/crm/customers') ||
      (pathname.startsWith('/crm/') &&
        pathname !== '/crm' &&
        !pathname.startsWith('/crm/settings') &&
        !pathname.startsWith('/crm/cleanup') &&
        !pathname.startsWith('/crm/insights') &&
        !pathname.startsWith('/crm/graph'))
    );
  }

  // Insights is a subsection of the Dashboard → nested (indented) directly under it.
  // Subpage links hide when the role lacks their sub-resource view cap.
  const items = $derived<SectionNavItem[]>(
    [
      { id: 'dashboard', label: m.crm_nav_dashboard(), icon: LayoutDashboard, href: '/crm' },
      {
        id: 'insights',
        label: m.crm_nav_insights(),
        icon: Sparkles,
        href: '/crm/insights',
        indent: 1,
      },
      { id: 'customers', label: m.crm_nav_customers(), icon: Users, href: '/crm/customers' },
      { id: 'graph', label: m.crm_nav_graph(), icon: Network, href: '/crm/graph' },
      { id: 'settings', label: m.crm_nav_settings(), icon: Settings, href: '/crm/settings' },
    ].filter((i) => canViewPath(i.href)),
  );

  const activeId = $derived(items.find((i) => isActive(i.id))?.id);
</script>

<SectionNav {items} {activeId} ariaLabel={m.crm_title()} />
