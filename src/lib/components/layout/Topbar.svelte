<script lang="ts">
    // Mobile-only header (< md). At md+ the sidebar carries brand + host + nav,
    // and the floating DynamicIsland carries the global actions.
    import HostPill from "../hosts/HostPill.svelte";
    import ProfileMenu from "./ProfileMenu.svelte";
    import NotificationsPopup from "./NotificationsPopup.svelte";
    import MinionLogo from "./MinionLogo.svelte";
    import CompanySwitcher from "./CompanySwitcher.svelte";
    import { getSections, gateSections } from "./sections";
    import { pluginNavState } from "$lib/state/plugin-nav.svelte";
    import { canClient } from "$lib/access/can.svelte";
    import { togglePalette } from "$lib/state/ui/command-palette.svelte";
    import { page } from "$app/state";
    import * as m from "$lib/paraglide/messages";
    import { Activity, Settings, Menu, X, Search, Bell, LogOut, User } from "lucide-svelte";
    import NavIcon from "./NavIcon.svelte";
    import { notifications, refreshNotifications } from "$lib/state/features/notifications.svelte";
    import { onMount } from "svelte";
    import { userState, logout } from "$lib/state/features/user.svelte";
    import { DOMAIN_LABEL, type NavDomain } from "./sections";

    const sections = $derived(gateSections(getSections(), pluginNavState.enabledByPluginId));
    const isReliability = $derived(page.url.pathname.startsWith("/reliability"));
    const isSettings = $derived(page.url.pathname.startsWith("/settings"));
    const isWorkforce = $derived(page.url.pathname.startsWith("/workforce"));

    let mobileMenuOpen = $state(false);
    function toggleMobileMenu() { mobileMenuOpen = !mobileMenuOpen; }
    function closeMobileMenu() { mobileMenuOpen = false; }

    let notificationsOpen = $state(false);

    // Group sections by domain for the mobile nav
    const domainGroups = $derived.by(() => {
        const map = new Map<NavDomain, typeof sections>();
        for (const s of sections) {
            const list = map.get(s.domain) ?? [];
            list.push(s);
            map.set(s.domain, list);
        }
        return [...map.entries()];
    });

    const displayName = $derived(userState.user?.displayName ?? userState.user?.email ?? '');
    const email = $derived(userState.user?.email ?? '');

    onMount(() => {
        refreshNotifications();
        const interval = setInterval(refreshNotifications, 60_000);
        return () => clearInterval(interval);
    });
</script>

<header class="md:hidden shrink-0 relative z-50 bg-bg/95 backdrop-blur-md border-b border-[var(--hairline)] h-14">
    <div class="relative flex items-center h-full px-3 gap-2">
        <button
            type="button"
            onclick={toggleMobileMenu}
            class="flex items-center justify-center w-9 h-9 rounded-lg text-muted hover:text-foreground hover:bg-bg3 transition-all duration-150"
            aria-label={m.topbar_toggleMenu()}
            aria-expanded={mobileMenuOpen}
        >
            {#if mobileMenuOpen}<X size={20} />{:else}<Menu size={20} />{/if}
        </button>

        <a href="/" class="flex items-center gap-2 no-underline group shrink-0" aria-label="Minion Hub">
            <MinionLogo size="sm" />
            <span class="flex items-center leading-none">
                <span class="font-black text-sm tracking-wide uppercase text-brand-pink">MINION</span>
                <span class="font-semibold text-sm text-foreground/80 ml-1">hub</span>
            </span>
        </a>

        <div class="h-5 w-px bg-[var(--hairline)] mx-1 shrink-0"></div>
        <div class="shrink-0 min-w-0"><HostPill /></div>

        <div class="flex-1 min-w-0"></div>

        <button
            type="button"
            onclick={() => togglePalette()}
            class="flex items-center justify-center w-9 h-9 rounded-lg text-muted hover:text-foreground hover:bg-bg3 transition-all duration-150"
            aria-label="Open command palette"
            title="Command palette"
        >
            <Search size={18} />
        </button>

        <!-- Notification bell -->
        <div class="relative">
            <button
                type="button"
                onclick={() => (notificationsOpen = !notificationsOpen)}
                class="flex items-center justify-center w-9 h-9 rounded-lg text-muted hover:text-foreground hover:bg-bg3 transition-all duration-150 relative"
                aria-label="{notifications.pendingCount} pending access requests"
                title="Notifications"
                aria-expanded={notificationsOpen}
            >
                <Bell size={18} />
                {#if notifications.hasPending}
                    <span
                        class="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full bg-red-500 text-[9px] font-bold text-white leading-none"
                    >
                        {notifications.pendingCount > 99 ? '99+' : notifications.pendingCount}
                    </span>
                {/if}
            </button>
            <NotificationsPopup bind:open={notificationsOpen} />
        </div>

        <div class="shrink-0"><ProfileMenu /></div>
    </div>

    {#if mobileMenuOpen}
        <!-- Backdrop (below the header bar) -->
        <button
            class="fixed inset-0 top-14 z-40 bg-black/40 cursor-default"
            onclick={closeMobileMenu}
            aria-label="Close menu"
            tabindex="-1"
        ></button>

        <!-- Menu panel -->
        <div class="mobile-menu-panel absolute top-full left-0 right-0 z-50 bg-bg2/98 backdrop-blur-xl border-b border-border shadow-xl">
            <!-- Scroll body: domains + sections -->
            <nav class="flex flex-col sm:flex-row sm:gap-4 max-h-[calc(70vh-3.5rem)] sm:max-h-[calc(75vh-3.5rem)] overflow-y-auto px-2 pt-2 pb-1">
                {#each domainGroups as [domain, domainSections] (domain)}
                    <div class="flex-1 min-w-0">
                        <!-- Domain super-header -->
                        <div class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-foreground/50">
                            {DOMAIN_LABEL[domain]}
                        </div>

                        {#each domainSections as section (section.id)}
                            {@const items = section.items.filter((i) => !i.requires || canClient(i.requires))}
                            {#if items.length}
                                <div class="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-strong mt-1">
                                    {section.label}
                                </div>
                                {#each items as item (item.href)}
                                    {@const isActive = item.matcher(page.url.pathname)}
                                    <a
                                        href={item.href}
                                        class="mobile-nav-link {section.tone === 'brand' ? 'brand' : ''} {isActive ? (section.tone === 'brand' ? 'active-brand' : 'active') : ''}"
                                        onclick={closeMobileMenu}
                                    >
                                        <NavIcon icon={item.icon} size={16} />
                                        <span>{item.label}</span>
                                    </a>
                                {/each}
                            {/if}
                        {/each}
                    </div>
                {/each}

                <!-- Standalone items (reliability, notifications) -->
                <div class="sm:hidden mt-1 pt-1 border-t border-[var(--hairline)]">
                    {#if canClient('reliability.monitor')}
                        <a href="/reliability" class="mobile-nav-link {isReliability ? 'active' : ''}" onclick={closeMobileMenu}>
                            <Activity size={16} />
                            <span>{m.nav_reliability()}</span>
                        </a>
                    {/if}
                </div>
            </nav>

            <!-- Pinned footer -->
            <div class="mobile-menu-footer shrink-0 border-t border-[var(--hairline)] px-2 py-2 flex flex-col gap-1 bg-bg2">
                <!-- Reliability (sm+) -->
                {#if canClient('reliability.monitor')}
                    <a
                        href="/reliability"
                        class="mobile-nav-link text-xs hidden sm:flex {isReliability ? 'active' : ''}"
                        onclick={closeMobileMenu}
                    >
                        <Activity size={15} />
                        <span>{m.nav_reliability()}</span>
                    </a>
                {/if}

                <!-- Settings -->
                <a
                    href="/settings"
                    class="mobile-nav-link text-xs {isSettings ? 'active' : ''}"
                    onclick={closeMobileMenu}
                >
                    <Settings size={15} />
                    <span>{m.nav_settings()}</span>
                </a>

                <!-- Notifications link -->
                <a
                    href="/notifications"
                    class="mobile-nav-link text-xs"
                    onclick={closeMobileMenu}
                >
                    <Bell size={15} />
                    <span>Notifications</span>
                    {#if notifications.hasPending}
                        <span class="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500 text-white leading-none">
                            {notifications.pendingCount > 99 ? '99+' : notifications.pendingCount}
                        </span>
                    {/if}
                </a>

                <!-- User row -->
                <a
                    href="/account"
                    class="mobile-nav-link text-xs mt-1"
                    onclick={closeMobileMenu}
                >
                    <User size={15} />
                    <span class="truncate">{displayName || email}</span>
                </a>

                <!-- Logout -->
                <button
                    type="button"
                    onclick={logout}
                    class="mobile-nav-link text-xs text-muted hover:text-red-400"
                >
                    <LogOut size={15} />
                    <span>Log out</span>
                </button>

                {#if isWorkforce}
                    <div class="px-3 py-2"><CompanySwitcher /></div>
                {/if}
            </div>
        </div>
    {/if}
</header>

<style>
    .mobile-menu-panel {
        animation: menu-slide-in 200ms cubic-bezier(0.2, 0, 0, 1);
    }
    @keyframes menu-slide-in {
        from { opacity: 0; transform: translateY(-8px); }
        to { opacity: 1; transform: translateY(0); }
    }

    .mobile-nav-link {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        padding: 0.5rem 0.75rem;
        border-radius: 0.5rem;
        font-size: 0.8125rem;
        font-weight: 500;
        color: var(--color-muted);
        text-decoration: none;
        position: relative;
        transition: all var(--duration-fast) var(--ease-standard);
    }
    .mobile-nav-link:hover { color: var(--color-foreground); background: var(--color-bg3); }
    .mobile-nav-link.active {
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 12%, transparent);
        font-weight: 600;
    }
    .mobile-nav-link.brand { color: var(--color-brand-pink); }
    .mobile-nav-link.active-brand {
        color: var(--color-brand-pink);
        background: color-mix(in srgb, var(--color-brand-pink) 15%, transparent);
        font-weight: 600;
    }
    /* Active left indicator bar — matches desktop sidebar */
    .mobile-nav-link.active::before,
    .mobile-nav-link.active-brand::before {
        content: '';
        position: absolute;
        left: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 2.5px;
        height: 1rem;
        border-radius: 0 2px 2px 0;
        background: currentColor;
        animation: indicator-in 220ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    @keyframes indicator-in {
        from { transform: translateY(-50%) scaleY(0.3); opacity: 0; }
        to { transform: translateY(-50%) scaleY(1); opacity: 1; }
    }

    /* Pinned footer: slightly different hover bg for contrast */
    .mobile-menu-footer .mobile-nav-link:hover {
        background: var(--color-bg3);
    }
</style>
