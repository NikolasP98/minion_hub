<script lang="ts">
    import { Brain, Bot, Radio, Shield, Server, Palette, HardDrive, DatabaseBackup, Puzzle, Users, KeyRound, Phone, User } from "lucide-svelte";
    import { page } from "$app/state";
    import { goto } from "$app/navigation";
    import { isAdmin } from "$lib/state/features/user.svelte";
    import { TABS } from "$lib/utils/config-schema";
    import * as m from "$lib/paraglide/messages";

    interface Props {
        dirtyTabIds?: Set<string>;
        onselect?: (id: string) => void;
    }

    let { dirtyTabIds = new Set<string>(), onselect }: Props = $props();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ICON_MAP: Record<string, any> = {
        Brain, Bot, Radio, Shield, Server, Palette, HardDrive, DatabaseBackup, Puzzle, Users, KeyRound, Phone, User,
    };

    // Hub tabs: own routes under /settings/<id>. Render as <a href>.
    type HubTab = { id: string; label: string; icon: string; href: string; adminOnly: boolean };
    const HUB_TABS: HubTab[] = [
        { id: 'account', label: 'Account', icon: 'User', href: '/settings/account', adminOnly: false },
        { id: 'appearance', label: 'Appearance', icon: 'Palette', href: '/settings/appearance', adminOnly: false },
        { id: 'plugins', label: 'Plugins', icon: 'Puzzle', href: '/settings/plugins', adminOnly: false },
        { id: 'team', label: 'Team', icon: 'Users', href: '/settings/team', adminOnly: true },
        { id: 'roles', label: 'Roles', icon: 'KeyRound', href: '/settings/roles', adminOnly: true },
        { id: 'backups', label: 'Backups', icon: 'DatabaseBackup', href: '/settings/backups', adminOnly: true },
        { id: 'gateways', label: 'Gateways', icon: 'Server', href: '/settings/gateways', adminOnly: true },
    ];

    // Gateway tabs: live on /settings?s=<id>. Render as <button>.
    // Filter out the hub-managed ones that previously had ?s= identity (appearance, backups).
    // Also filter out 'hosts' (kept on the legacy ?s= page for now per scope).
    const HUB_LEGACY_IDS = new Set(['appearance', 'backups']);
    const gatewayTabs = $derived(TABS.filter((t) => !HUB_LEGACY_IDS.has(t.id)));

    // Active-tab detection
    const pathname = $derived(page.url.pathname);
    const queryS = $derived(page.url.searchParams.get('s'));

    function isHubActive(tab: HubTab): boolean {
        return pathname === tab.href || pathname.startsWith(tab.href + '/');
    }

    function isGatewayActive(id: string): boolean {
        // The legacy gateway tabs only count as active when on /settings (no sub-path)
        if (pathname !== '/settings') return false;
        if (queryS) return queryS === id;
        // default selection on /settings with no ?s= → hosts
        return id === 'hosts';
    }

    // Visibility filter
    const visibleHubTabs = $derived(
        isAdmin.value ? HUB_TABS : HUB_TABS.filter((t) => !t.adminOnly)
    );
    const visibleGatewayTabs = $derived(isAdmin.value ? gatewayTabs : []);

    function handleGatewayClick(id: string) {
        // Consolidation: "hosts" now lives at /settings/gateways
        if (id === 'hosts') {
            goto('/settings/gateways');
            return;
        }
        onselect?.(id);
    }

    // Translate display labels via paraglide where available, fall back to label
    function hubLabel(id: string, fallback: string): string {
        if (id === 'plugins') return m.settings_plugins();
        return fallback;
    }
</script>

<div class="shrink-0 border-b border-border bg-bg/80 backdrop-blur-sm" role="tablist">
    <div class="flex items-center gap-0.5 px-4 overflow-x-auto">
        <!-- Gateway tabs (button → ?s=) -->
        {#each visibleGatewayTabs as tab (tab.id)}
            {@const Icon = ICON_MAP[tab.icon]}
            {@const isActive = isGatewayActive(tab.id)}
            <button
                type="button"
                role="tab"
                aria-selected={isActive}
                class="relative flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors bg-transparent border-none cursor-pointer font-[inherit] whitespace-nowrap
                    {isActive
                    ? 'text-accent'
                    : 'text-muted-foreground hover:text-foreground'}"
                onclick={() => handleGatewayClick(tab.id)}
            >
                {#if Icon}
                    <Icon size={14} />
                {/if}
                <span class="hidden lg:inline">{tab.label}</span>

                {#if dirtyTabIds.has(tab.id) && !isActive}
                    <span
                        class="absolute top-1.5 right-1 w-1.5 h-1.5 rounded-full bg-accent"
                        aria-hidden="true"
                    ></span>
                {/if}

                {#if isActive}
                    <div class="absolute bottom-0 left-2 right-2 h-[2px] bg-accent rounded-t-full"></div>
                {/if}
            </button>
        {/each}

        <!-- Hub tabs (anchor → /settings/<id>) -->
        {#each visibleHubTabs as tab (tab.id)}
            {@const Icon = ICON_MAP[tab.icon]}
            {@const isActive = isHubActive(tab)}
            <a
                href={tab.href}
                role="tab"
                aria-selected={isActive}
                class="relative flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors bg-transparent border-none cursor-pointer font-[inherit] whitespace-nowrap no-underline
                    {isActive
                    ? 'text-accent'
                    : 'text-muted-foreground hover:text-foreground'}"
            >
                {#if Icon}
                    <Icon size={14} />
                {/if}
                <span class="hidden lg:inline">{hubLabel(tab.id, tab.label)}</span>

                {#if isActive}
                    <div class="absolute bottom-0 left-2 right-2 h-[2px] bg-accent rounded-t-full"></div>
                {/if}
            </a>
        {/each}
    </div>
</div>
