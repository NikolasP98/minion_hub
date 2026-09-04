<script lang="ts">
  // /team secondary side menu — same SectionNav every module uses. Subpages are
  // `?tab=` views of one route, so links carry the query and the active item
  // follows it.
  import { Users, CalendarOff, DoorOpen, Settings } from 'lucide-svelte';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import { SectionNav, type SectionNavItem } from '$lib/components/ui/foundations';
  import { canAct, canClient } from '$lib/access/can.svelte';
  import { resolveTeamTab } from './tabs';

  const canConfigure = $derived(canAct('scheduling', 'edit') || canClient('users.manage'));
  const items = $derived<SectionNavItem[]>([
    { id: 'people', label: m.team_tab_people(), icon: Users, href: '/team?tab=people' },
    { id: 'timeoff', label: m.team_tab_timeoff(), icon: CalendarOff, href: '/team?tab=timeoff' },
    {
      id: 'resources',
      label: m.team_tab_resources(),
      icon: DoorOpen,
      href: '/team?tab=resources',
    },
    ...(canConfigure
      ? [
          {
            id: 'settings',
            label: m.team_tab_settings(),
            icon: Settings,
            href: '/team?tab=settings',
          },
        ]
      : []),
  ]);
  const activeId = $derived(resolveTeamTab(page.url.searchParams.get('tab'), canConfigure));
</script>

<SectionNav {items} {activeId} ariaLabel={m.team_title()} />
