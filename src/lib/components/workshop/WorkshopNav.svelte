<script lang="ts">
  import { canonicalPath } from '$lib/canonical-path';
  import { GitCompare, LayoutGrid, MessagesSquare } from 'lucide-svelte';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import { SideNav, type SideNavItem } from '$lib/components/ui';

  // Leaderboard is reached from inside the Compare tab (a details page), not a
  // top-level nav item.
  const items: SideNavItem[] = [
    { id: 'canvases', label: m.nav_workshop(), icon: LayoutGrid, href: '/agents/workshop' },
    { id: 'compare', label: m.workshop_exp_compare(), icon: GitCompare, href: '/agents/workshop/compare' },
    { id: 'groupchat', label: m.workshop_exp_group_chat(), icon: MessagesSquare, href: '/agents/workshop/groupchat' },
  ];

  const pathname = $derived(canonicalPath(page.url.pathname));
  const activeId = $derived(
    pathname === '/agents/workshop'
      ? 'canvases'
      : pathname.startsWith('/agents/workshop/leaderboard')
        ? 'compare'
        : items.find((i) => i.id !== 'canvases' && pathname.startsWith(i.href ?? ''))?.id,
  );
</script>

<SideNav {items} {activeId} ariaLabel="Workshop" header={m.nav_workshop()} />
