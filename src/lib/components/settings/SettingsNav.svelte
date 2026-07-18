<script lang="ts">
  import { canonicalPath } from '$lib/canonical-path';
  import { Brain, Bot, Radio, Shield, Server, Palette, DatabaseBackup, Puzzle, Users, KeyRound, Phone, Blocks, Bell, Workflow, Building2, Activity } from "lucide-svelte";
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
    Brain, Bot, Radio, Shield, Server, Palette, DatabaseBackup, Puzzle, Users, KeyRound, Phone, Blocks, Bell, Workflow, Building2, Activity,
  };

  type HubTab = { id: string; label: string; icon: string; href: string; adminOnly: boolean };
  // "General" group — own routes under /settings/<id>, available to all users.
  const GENERAL_TABS: HubTab[] = [
    { id: 'appearance', label: m.settings_nav_appearance(), icon: 'Palette', href: '/settings/appearance', adminOnly: false },
    { id: 'plugins', label: m.settings_plugins(), icon: 'Puzzle', href: '/settings/plugins', adminOnly: false },
    // ponytail: literal label — i18n key is a follow-up (shared worktree, messages/*.json off-limits this task)
    { id: 'pulse', label: 'Pulse', icon: 'Activity', href: '/settings/pulse', adminOnly: false },
  ];
  // "Hub" group — admin route tabs.
  const HUB_TABS: HubTab[] = [
    { id: 'organizations', label: m.settings_nav_organizations(), icon: 'Building2', href: '/settings/organizations', adminOnly: true },
    { id: 'gateways', label: m.settings_nav_gateways(), icon: 'Server', href: '/settings/gateways', adminOnly: true },
    { id: 'backups', label: m.settings_nav_backups(), icon: 'DatabaseBackup', href: '/settings/backups', adminOnly: true },
    { id: 'modules', label: m.settings_modules(), icon: 'Blocks', href: '/settings/modules', adminOnly: true },
    { id: 'notifications', label: m.settings_nav_notifications(), icon: 'Bell', href: '/settings/notifications', adminOnly: true },
    { id: 'workflows', label: m.settings_nav_workflows(), icon: 'Workflow', href: '/settings/workflows', adminOnly: true },
  ];
  // "Team" group — admin route tabs.
  const TEAM_TABS: HubTab[] = [
    { id: 'team', label: m.settings_nav_team(), icon: 'Users', href: '/settings/team', adminOnly: true },
    { id: 'roles', label: m.settings_nav_roles(), icon: 'KeyRound', href: '/settings/roles', adminOnly: true },
  ];

  // Gateway config tabs live on /settings?s=<id> (rendered by the config page scrollspy).
  const HUB_LEGACY_IDS = new Set(['appearance', 'backups']);
  const gatewayTabs = $derived(TABS.filter((t) => !HUB_LEGACY_IDS.has(t.id)));

  const pathname = $derived(canonicalPath(page.url.pathname));
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

  function hubItem(t: HubTab): SectionNavItem {
    return { id: t.id, label: t.label, icon: ICON_MAP[t.icon], href: t.href };
  }

  // Build grouped sections; SideNav handles search filtering + empty-group culling.
  const groups = $derived.by<SectionNavGroup[]>(() => {
    const out: SectionNavGroup[] = [];
    out.push({ id: 'general', label: m.settings_nav_group_general(), items: GENERAL_TABS.map(hubItem) });
    if (visibleGatewayTabs.length) {
      out.push({
        id: 'server',
        label: m.settings_nav_group_server(),
        items: visibleGatewayTabs.map((t) => ({
          id: t.id,
          label: t.label(),
          icon: ICON_MAP[t.icon],
          dot: dirtyTabIds.has(t.id),
        })),
      });
    }
    if (visibleHubTabs.length) out.push({ id: 'hub', label: m.settings_nav_group_hub(), items: visibleHubTabs.map(hubItem) });
    if (visibleTeamTabs.length) out.push({ id: 'team', label: m.settings_nav_group_team(), items: visibleTeamTabs.map(hubItem) });
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
  ariaLabel={m.settings_title()}
  search={{ enabled: true, placeholder: m.settings_nav_search() }}
  onSelect={onselect}
/>
