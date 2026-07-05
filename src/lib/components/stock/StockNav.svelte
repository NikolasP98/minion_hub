<script lang="ts">
  import { LayoutDashboard, Package, Warehouse, ArrowLeftRight, Boxes, Stethoscope } from 'lucide-svelte';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import { SideNav, type SideNavItem } from '$lib/components/ui';
  import { canViewPath } from '$lib/access/can.svelte';

  // Hide subpage links the role can't view — same behaviour as FinanceNav/CrmNav
  // (all of /stock/* share the single stock:view gate, so this is mostly a no-op
  // today, but keeps the pattern consistent if a sub-resource gate is added later).
  const items = $derived<SideNavItem[]>(
    [
      { id: 'overview', label: m.stock_nav_overview(), icon: LayoutDashboard, href: '/stock' },
      { id: 'items', label: m.stock_nav_items(), icon: Package, href: '/stock/items' },
      { id: 'warehouses', label: m.stock_nav_warehouses(), icon: Warehouse, href: '/stock/warehouses' },
      { id: 'entries', label: m.stock_nav_entries(), icon: ArrowLeftRight, href: '/stock/entries' },
      { id: 'consumption', label: m.stock_nav_consumption(), icon: Boxes, href: '/stock/consumption' },
      // NOTE: keep 'consume' after 'consumption' — isActive uses startsWith and
      // '/stock/consumption' is a prefix-sibling of '/stock/consume'; first match wins.
      { id: 'consume', label: m.stock_nav_consume(), icon: Stethoscope, href: '/stock/consume' },
    ].filter((i) => canViewPath(i.href)),
  );

  const pathname = $derived(page.url.pathname);

  function isActive(id: string, href: string): boolean {
    if (id === 'overview') return pathname === '/stock';
    return pathname.startsWith(href);
  }

  const activeId = $derived(items.find((i) => isActive(i.id, i.href ?? ''))?.id);
</script>

<SideNav {items} {activeId} ariaLabel="Stock" header={m.nav_stock()} />
