<script lang="ts">
  import { canonicalPath } from '$lib/canonical-path';
  import { ShoppingCart, CalendarDays, LayoutGrid } from 'lucide-svelte';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import { SectionNav, type SectionNavItem } from '$lib/components/ui/foundations';
  import { canViewPath } from '$lib/access/can.svelte';
  import ShiftBanner from '$lib/components/pos/ShiftBanner.svelte';

  const pathname = $derived(canonicalPath(page.url.pathname));

  function isActive(id: string): boolean {
    return pathname === `/pos/${id}` || pathname.startsWith(`/pos/${id}/`);
  }

  const items = $derived<SectionNavItem[]>(
    [
      { id: 'sell', label: m.pos_nav_sell(), icon: ShoppingCart, href: '/pos/sell' },
      ...(page.data.schedulingEnabled
        ? [
            {
              id: 'appointments',
              label: m.pos_nav_appointments(),
              icon: CalendarDays,
              href: '/pos/appointments',
            },
          ]
        : []),
      { id: 'catalog', label: m.pos_nav_catalog(), icon: LayoutGrid, href: '/pos/catalog' },
      // No refills tab: stock operations live ONLY in the stock module
      // (/stock/entries, /stock/consume). POS owns recipes + commerce.
    ].filter((i) => canViewPath(i.href)),
  );

  const activeId = $derived(items.find((i) => isActive(i.id))?.id);
</script>

<SectionNav {items} {activeId} ariaLabel={m.nav_pos()}>
  {#snippet footer()}
    <ShiftBanner />
  {/snippet}
</SectionNav>
