<script lang="ts">
  import { ShoppingCart, CalendarDays, LayoutGrid, PackagePlus } from 'lucide-svelte';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import { SideNav, type SideNavItem } from '$lib/components/ui';
  import { canViewPath } from '$lib/access/can.svelte';
  import ShiftBanner from '$lib/components/pos/ShiftBanner.svelte';

  const pathname = $derived(page.url.pathname);

  function isActive(id: string): boolean {
    return pathname === `/pos/${id}` || pathname.startsWith(`/pos/${id}/`);
  }

  const items = $derived<SideNavItem[]>(
    [
      { id: 'sell', label: m.pos_nav_sell(), icon: ShoppingCart, href: '/pos/sell' },
      ...(page.data.schedulingEnabled
        ? [{ id: 'appointments', label: m.pos_nav_appointments(), icon: CalendarDays, href: '/pos/appointments' }]
        : []),
      { id: 'catalog', label: m.pos_nav_catalog(), icon: LayoutGrid, href: '/pos/catalog' },
      ...(page.data.stockEnabled
        ? [{ id: 'refills', label: m.pos_nav_refills(), icon: PackagePlus, href: '/pos/refills' }]
        : []),
    ].filter((i) => canViewPath(i.href)),
  );

  const activeId = $derived(items.find((i) => isActive(i.id))?.id);
</script>

<SideNav {items} {activeId} ariaLabel="POS" header={m.nav_pos()}>
  {#snippet footer()}
    <ShiftBanner />
  {/snippet}
</SideNav>
