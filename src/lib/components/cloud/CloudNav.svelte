<script lang="ts">
  import { page } from '$app/state';
  import { Gauge, Monitor, Settings, SquareTerminal } from 'lucide-svelte';
  import { SideNav, type SideNavItem } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';

  let { canConnect, canManage }: { canConnect: boolean; canManage: boolean } = $props();

  const selected = $derived(page.url.searchParams.get('server'));
  const suffix = $derived(selected ? `?server=${encodeURIComponent(selected)}` : '');
  const pathname = $derived(page.url.pathname);
  const items = $derived<SideNavItem[]>([
    { id: 'overview', label: m.cloud_nav_overview(), icon: Gauge, href: `/cloud${suffix}` },
    ...(canConnect
      ? [
          { id: 'gui', label: m.cloud_nav_gui(), icon: Monitor, href: `/cloud/gui${suffix}` },
          {
            id: 'terminal',
            label: m.cloud_nav_terminal(),
            icon: SquareTerminal,
            href: `/cloud/terminal${suffix}`,
          },
        ]
      : []),
    ...(canManage
      ? [
          {
            id: 'settings',
            label: m.cloud_nav_settings(),
            icon: Settings,
            href: `/cloud/settings${suffix}`,
          },
        ]
      : []),
  ]);
  const activeId = $derived(
    pathname.startsWith('/cloud/gui')
      ? 'gui'
      : pathname.startsWith('/cloud/terminal')
        ? 'terminal'
        : pathname.startsWith('/cloud/settings')
          ? 'settings'
          : 'overview',
  );
</script>

<SideNav {items} {activeId} ariaLabel={m.cloud_title()} header={m.cloud_title()} />
