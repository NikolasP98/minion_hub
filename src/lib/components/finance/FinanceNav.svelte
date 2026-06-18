<script lang="ts">
  import { LayoutDashboard, FileText, CreditCard, Package, Settings } from 'lucide-svelte';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import { SideNav, type SideNavItem } from '$lib/components/ui';

  const items = $derived<SideNavItem[]>([
    { id: 'dashboard', label: m.nav_finance(), icon: LayoutDashboard, href: '/finances' },
    { id: 'invoices', label: m.fin_nav_invoices(), icon: FileText, href: '/finances/invoices' },
    { id: 'payments', label: m.fin_nav_payments(), icon: CreditCard, href: '/finances/payments' },
    { id: 'products', label: m.fin_nav_products(), icon: Package, href: '/finances/products' },
    { id: 'settings', label: m.nav_settings(), icon: Settings, href: '/finances/settings' },
  ]);

  const pathname = $derived(page.url.pathname);

  function isActive(id: string, href: string): boolean {
    if (id === 'dashboard') return pathname === '/finances';
    if (id === 'settings') return pathname.startsWith('/finances/settings');
    return pathname.startsWith(href);
  }

  const activeId = $derived(items.find((i) => isActive(i.id, i.href ?? ''))?.id);
</script>

<SideNav {items} {activeId} ariaLabel="Finances" header={m.nav_finance()} />
