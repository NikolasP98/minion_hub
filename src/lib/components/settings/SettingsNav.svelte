<script lang="ts">
  import { Brain, Bot, Radio, Shield, Server, Palette, DatabaseBackup, Puzzle, Users, KeyRound, Phone, Blocks, Bell, Workflow } from "lucide-svelte";
  import { page } from "$app/state";
  import { isAdmin } from "$lib/state/features/user.svelte";
  import { TABS } from "$lib/utils/config-schema";
  import * as m from "$lib/paraglide/messages";
  import {
    SectionNav,
    type SectionNavGroup,
    type SectionNavItem,
  } from '$lib/components/ui/foundations';

  interface Props {
    dirtyTabIds?: Set<string>;
    onselect?: (id: string) => void;
  }

  let { dirtyTabIds = new Set<string>(), onselect }: Props = $props();

  const ICON_MAP: Record<string, typeof Brain> = {
    Brain, Bot, Radio, Shield, Server, Palette, DatabaseBackup, Puzzle, Users, KeyRound, Phone, Blocks, Bell, Workflow,
  };

  type HubTab = { id: string; label: string; icon: string; href: string; adminOnly: boolean };
  // "General" group — own routes under /settings/<id>, available to all users.
  const GENERAL_TABS: HubTab[] = [
    { id: 'appearance', label: 'Appearance', icon: 'Palette', href: '/settings/appearance', adminOnly: false },
    { id: 'plugins', label: 'Plugins', icon: 'Puzzle', href: '/settings/plugins', adminOnly: false },
  ];
  // "Hub" group — admin route tabs.
  const HUB_TABS: HubTab[] = [
    { id: 'gateways', label: 'Gateways', icon: 'Server', href: '/settings/gateways', adminOnly: true },
    { id: 'backups', label: 'Backups', icon: 'DatabaseBackup', href: '/settings/backups', adminOnly: true },
    { id: 'modules', label: 'Modules', icon: 'Blocks', href: '/settings/modules', adminOnly: true },
    { id: 'notifications', label: 'Notifications', icon: 'Bell', href: '/settings/notifications', adminOnly: true },
    { id: 'workflows', label: 'Workflows', icon: 'Workflow', href: '/settings/workflows', adminOnly: true },
  ];
  // "Team" group — admin route tabs.
  const TEAM_TABS: HubTab[] = [
    { id: 'team', label: 'Team', icon: 'Users', href: '/settings/team', adminOnly: true },
    { id: 'roles', label: 'Roles', icon: 'KeyRound', href: '/settings/roles', adminOnly: true },
  ];

  // Gateway config tabs live on /settings?s=<id> (rendered by the config page scrollspy).
  const HUB_LEGACY_IDS = new Set(['appearance', 'backups']);
  const gatewayTabs = $derived(TABS.filter((t) => !HUB_LEGACY_IDS.has(t.id)));

  const pathname = $derived(page.url.pathname);
  const queryS = $derived(page.url.searchParams.get('s'));

  function isHubActive(tab: HubTab): boolean {
    if (pathname.startsWith('/settings/provision')) return tab.id === 'gateways';
    return pathname === tab.href || pathname.startsWith(tab.href + '/');
  }
  function isGatewayActive(id: string): boolean {
    if (pathname !== '/settings') return false;
    if (queryS) return queryS === id;
    return id === 'ai';
  }

  const visibleGatewayTabs = $derived(isAdmin.value ? gatewayTabs : []);
  const visibleHubTabs = $derived(isAdmin.value ? HUB_TABS : HUB_TABS.filter((t) => !t.adminOnly));
  const visibleTeamTabs = $derived(isAdmin.value ? TEAM_TABS : []);

  function hubLabel(id: string, fallback: string): string {
    if (id === 'plugins') return m.settings_plugins();
    return fallback;
  }

  function hubItem(t: HubTab): SectionNavItem {
    return { id: t.id, label: hubLabel(t.id, t.label), icon: ICON_MAP[t.icon], href: t.href };
  }

  // Build grouped sections; SideNav handles search filtering + empty-group culling.
  const groups = $derived.by<SectionNavGroup[]>(() => {
    const out: SectionNavGroup[] = [];
    out.push({ id: 'general', label: 'General', items: GENERAL_TABS.map(hubItem) });
    if (visibleGatewayTabs.length) {
      out.push({
        id: 'server',
        label: 'Server',
        items: visibleGatewayTabs.map((t) => ({
          id: t.id,
          label: t.label,
          icon: ICON_MAP[t.icon],
          dot: dirtyTabIds.has(t.id),
        })),
      });
    }
    if (visibleHubTabs.length) out.push({ id: 'hub', label: 'Hub', items: visibleHubTabs.map(hubItem) });
    if (visibleTeamTabs.length) out.push({ id: 'team', label: 'Team', items: visibleTeamTabs.map(hubItem) });
    return out;
  });

  // A single active id across all sections (href-based for routes, ?s= for gateway).
  const activeId = $derived.by(() => {
    const gw = visibleGatewayTabs.find((t) => isGatewayActive(t.id));
    if (gw) return gw.id;
    const hubActive = [...GENERAL_TABS, ...HUB_TABS, ...TEAM_TABS].find(isHubActive);
    return hubActive?.id;
  });
</script>

<SectionNav
  items={groups}
  {activeId}
  ariaLabel="Settings"
  search={{ enabled: true, placeholder: 'Search settings' }}
  onSelect={onselect}
/>
