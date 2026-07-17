<script lang="ts">
  import { canonicalPath } from '$lib/canonical-path';
  import { UserRound, Link2, ShieldCheck } from 'lucide-svelte';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import { SideNav, type SideNavItem } from '$lib/components/ui';

  // /account is ungated self-serve (not in ROUTE_VIEW_PERMS) — no canViewPath
  // filtering, unlike FinanceNav/CrmNav.
  const items = $derived<SideNavItem[]>([
    { id: 'profile', label: m.account_nav_profile(), icon: UserRound, href: '/account' },
    {
      id: 'connections',
      label: m.account_nav_connections(),
      icon: Link2,
      href: '/account/connections',
    },
    {
      id: 'security',
      label: m.account_nav_security(),
      icon: ShieldCheck,
      href: '/account/security',
    },
  ]);

  const pathname = $derived(canonicalPath(page.url.pathname));

  function isActive(id: string, href: string): boolean {
    if (id === 'profile') return pathname === '/account';
    return pathname.startsWith(href);
  }

  const activeId = $derived(items.find((i) => isActive(i.id, i.href ?? ''))?.id);
</script>

<SideNav {items} {activeId} ariaLabel="Account" header={m.account_nav_header()} />
