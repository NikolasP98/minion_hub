<script lang="ts">
  import { canonicalPath } from '$lib/canonical-path';
  import { LayoutDashboard, Target, Image, Settings } from 'lucide-svelte';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import { SectionNav, type SectionNavItem } from '$lib/components/ui/foundations';
  import { canViewPath } from '$lib/access/can.svelte';

  // Hide subpage links the role can't view (sub-resource view caps) — same
  // behaviour as the main sidebar hiding module links.
  const items = $derived<SectionNavItem[]>(
    [
      { id: 'dashboard', label: m.nav_ads(), icon: LayoutDashboard, href: '/socials' },
      { id: 'campaigns', label: m.ads_nav_campaigns(), icon: Target, href: '/socials/campaigns' },
      { id: 'posts', label: m.ads_nav_posts(), icon: Image, href: '/socials/posts' },
      { id: 'settings', label: m.nav_settings(), icon: Settings, href: '/socials/settings' },
    ].filter((i) => canViewPath(i.href)),
  );

  const pathname = $derived(canonicalPath(page.url.pathname));

  function isActive(id: string, href: string): boolean {
    if (id === 'dashboard') return pathname === '/socials';
    if (id === 'settings') return pathname.startsWith('/socials/settings');
    return pathname.startsWith(href);
  }

  const activeId = $derived(items.find((i) => isActive(i.id, i.href ?? ''))?.id);
</script>

<SectionNav {items} {activeId} ariaLabel={m.nav_ads()} />
