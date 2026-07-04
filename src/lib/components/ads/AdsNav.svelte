<script lang="ts">
  import { LayoutDashboard, Target, Image, Settings } from 'lucide-svelte';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import { SideNav, type SideNavItem } from '$lib/components/ui';
  import { canViewPath } from '$lib/access/can.svelte';

  // Hide subpage links the role can't view (sub-resource view caps) — same
  // behaviour as the main sidebar hiding module links.
  const items = $derived<SideNavItem[]>(
    [
      { id: 'dashboard', label: m.nav_ads(), icon: LayoutDashboard, href: '/ads' },
      { id: 'campaigns', label: m.ads_nav_campaigns(), icon: Target, href: '/ads/campaigns' },
      { id: 'posts', label: m.ads_nav_posts(), icon: Image, href: '/ads/posts' },
      { id: 'settings', label: m.nav_settings(), icon: Settings, href: '/ads/settings' },
    ].filter((i) => canViewPath(i.href)),
  );

  const pathname = $derived(page.url.pathname);

  function isActive(id: string, href: string): boolean {
    if (id === 'dashboard') return pathname === '/ads';
    if (id === 'settings') return pathname.startsWith('/ads/settings');
    return pathname.startsWith(href);
  }

  const activeId = $derived(items.find((i) => isActive(i.id, i.href ?? ''))?.id);
</script>

<SideNav {items} {activeId} ariaLabel="Ads" header={m.nav_ads()} />
