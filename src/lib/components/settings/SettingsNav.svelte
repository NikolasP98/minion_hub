<script lang="ts">
  import { Brain, Bot, Radio, Shield, Server, Palette, DatabaseBackup, Puzzle, Users, KeyRound, Phone, Search } from "lucide-svelte";
  import { page } from "$app/state";
  import { isAdmin } from "$lib/state/features/user.svelte";
  import { TABS } from "$lib/utils/config-schema";
  import * as m from "$lib/paraglide/messages";

  interface Props {
    dirtyTabIds?: Set<string>;
    onselect?: (id: string) => void;
  }

  let { dirtyTabIds = new Set<string>(), onselect }: Props = $props();

  const ICON_MAP: Record<string, typeof Brain> = {
    Brain, Bot, Radio, Shield, Server, Palette, DatabaseBackup, Puzzle, Users, KeyRound, Phone,
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

  // Live filter across all items.
  let q = $state('');
  const ql = $derived(q.trim().toLowerCase());
  function match(label: string): boolean {
    return !ql || label.toLowerCase().includes(ql);
  }

  const generalItems = $derived(GENERAL_TABS.filter((t) => match(hubLabel(t.id, t.label))));
  const gwItems = $derived(visibleGatewayTabs.filter((t) => match(t.label)));
  const hubItems = $derived(visibleHubTabs.filter((t) => match(t.label)));
  const teamItems = $derived(visibleTeamTabs.filter((t) => match(t.label)));
</script>

<aside
  class="surface-1 shrink-0 w-14 lg:w-[208px] h-full border-r border-[var(--hairline)] flex flex-col overflow-hidden"
  aria-label="Settings"
>
  <!-- Search -->
  <div class="shrink-0 p-2 hidden lg:block">
    <div class="relative">
      <Search size={13} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      <input
        type="text"
        bind:value={q}
        placeholder="Search settings"
        class="focus-ring-none w-full h-8 pl-7 pr-2 text-xs rounded-[var(--radius-md)] bg-bg2 border border-[var(--hairline)] text-foreground placeholder:text-muted-foreground focus:border-accent/60 transition-colors duration-[150ms]"
        aria-label="Search settings"
      />
    </div>
  </div>

  <nav class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2 pb-3 flex flex-col gap-0.5">
    <!-- GENERAL -->
    {#if generalItems.length}
      <div class="set-head t-label hidden lg:block">General</div>
      {#each generalItems as tab (tab.id)}
        {@const Icon = ICON_MAP[tab.icon]}
        {@const active = isHubActive(tab)}
        <a href={tab.href} class="set-row {active ? 'set-active' : ''}" aria-current={active ? 'page' : undefined} title={hubLabel(tab.id, tab.label)}>
          <Icon size={16} class="set-icon shrink-0" />
          <span class="hidden lg:inline">{hubLabel(tab.id, tab.label)}</span>
        </a>
      {/each}
    {/if}

    <!-- GATEWAY (admin): config sections via ?s= -->
    {#if gwItems.length}
      <div class="set-divider"></div>
      <div class="set-head t-label hidden lg:flex items-center gap-1.5">Server<span class="admin-badge">admin</span></div>
      {#each gwItems as tab (tab.id)}
        {@const Icon = ICON_MAP[tab.icon]}
        {@const active = isGatewayActive(tab.id)}
        <button type="button" class="set-row text-left {active ? 'set-active' : ''}" aria-current={active ? 'page' : undefined} title={tab.label} onclick={() => onselect?.(tab.id)}>
          {#if Icon}<Icon size={16} class="set-icon shrink-0" />{/if}
          <span class="hidden lg:inline flex-1">{tab.label}</span>
          {#if dirtyTabIds.has(tab.id) && !active}
            <span class="w-1.5 h-1.5 rounded-full bg-accent shrink-0" aria-label="unsaved changes"></span>
          {/if}
        </button>
      {/each}
    {/if}

    <!-- HUB (admin) -->
    {#if hubItems.length}
      <div class="set-divider"></div>
      <div class="set-head t-label hidden lg:block">Hub</div>
      {#each hubItems as tab (tab.id)}
        {@const Icon = ICON_MAP[tab.icon]}
        {@const active = isHubActive(tab)}
        <a href={tab.href} class="set-row {active ? 'set-active' : ''}" aria-current={active ? 'page' : undefined} title={tab.label}>
          <Icon size={16} class="set-icon shrink-0" />
          <span class="hidden lg:inline">{tab.label}</span>
        </a>
      {/each}
    {/if}

    <!-- TEAM (admin) -->
    {#if teamItems.length}
      <div class="set-divider"></div>
      <div class="set-head t-label hidden lg:flex items-center gap-1.5">Team<span class="admin-badge">admin</span></div>
      {#each teamItems as tab (tab.id)}
        {@const Icon = ICON_MAP[tab.icon]}
        {@const active = isHubActive(tab)}
        <a href={tab.href} class="set-row {active ? 'set-active' : ''}" aria-current={active ? 'page' : undefined} title={tab.label}>
          <Icon size={16} class="set-icon shrink-0" />
          <span class="hidden lg:inline">{tab.label}</span>
        </a>
      {/each}
    {/if}
  </nav>
</aside>

<style>
  .set-row {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    min-height: 2rem;
    padding: 0.375rem 0.625rem;
    border-radius: var(--radius-md);
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-muted);
    text-decoration: none;
    white-space: nowrap;
    background: transparent;
    border: none;
    cursor: pointer;
    width: 100%;
    transition:
      color var(--duration-fast) var(--ease-standard),
      background-color var(--duration-fast) var(--ease-standard);
  }
  .set-row :global(.set-icon) {
    opacity: 0.7;
    transition: opacity var(--duration-fast) var(--ease-standard);
  }
  .set-row:hover {
    color: var(--color-foreground);
    background: rgba(255, 255, 255, 0.05);
  }
  .set-row:hover :global(.set-icon) {
    opacity: 1;
  }
  .set-active {
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    font-weight: 600;
  }
  .set-active :global(.set-icon) {
    opacity: 1;
    color: var(--color-accent);
  }
  .set-head {
    padding: 0.5rem 0.625rem 0.25rem;
  }
  .set-divider {
    height: 1px;
    background: var(--hairline);
    margin: 0.375rem 0.375rem;
  }
  .admin-badge {
    font-size: 0.5rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 0.0625rem 0.25rem;
    border-radius: var(--radius-xs);
    color: var(--color-warning);
    background: color-mix(in srgb, var(--color-warning) 14%, transparent);
  }
</style>
