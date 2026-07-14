<script lang="ts">
  import { LayoutDashboard, FileText, Package, Settings } from 'lucide-svelte';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import { SectionNav, type SectionNavItem } from '$lib/components/ui/foundations';
  import { canViewPath } from '$lib/access/can.svelte';

  // Hide subpage links the role can't view (sub-resource view caps) — same
  // behaviour as the main sidebar hiding module links.
  const items = $derived<SectionNavItem[]>(
    [
      { id: 'dashboard', label: m.nav_finance(), icon: LayoutDashboard, href: '/finances' },
      { id: 'invoices', label: m.fin_nav_invoices(), icon: FileText, href: '/finances/invoices' },
      { id: 'products', label: m.fin_nav_products(), icon: Package, href: '/finances/products' },
      { id: 'settings', label: m.nav_settings(), icon: Settings, href: '/finances/settings' },
    ].filter((i) => canViewPath(i.href)),
  );

  const pathname = $derived(page.url.pathname);

  function isActive(id: string, href: string): boolean {
    if (id === 'dashboard') return pathname === '/finances';
    if (id === 'settings') return pathname.startsWith('/finances/settings');
    return pathname.startsWith(href);
  }

  const activeId = $derived(items.find((i) => isActive(i.id, i.href ?? ''))?.id);
</script>

<SectionNav {items} {activeId} ariaLabel={m.nav_finance()} />
