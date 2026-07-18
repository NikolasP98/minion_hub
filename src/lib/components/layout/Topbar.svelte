<script lang="ts">
  import { canonicalPath } from '$lib/canonical-path';
    // Mobile-only header (< md). At md+ the sidebar carries brand + host + nav,
    // and the floating DynamicIsland carries the global actions.
    import HostPill from "../hosts/HostPill.svelte";
    import ProfileMenu from "./ProfileMenu.svelte";
    import NotificationsPopup from "./NotificationsPopup.svelte";
    import MinionLogo from "./MinionLogo.svelte";
    import CompanySwitcher from "./CompanySwitcher.svelte";
    import { getSections, getDynamicPluginsSections, type Section, type SectionItem } from "./sections";
    import { pluginNavState } from "$lib/state/plugin-nav.svelte";
    import { canViewPath } from "$lib/access/can.svelte";
    import { togglePalette } from "$lib/state/ui/command-palette.svelte";
    import { page } from "$app/state";
    import * as m from "$lib/paraglide/messages";
    import { Activity, Cloud, Settings, Menu, X, Search, Bell, LogOut, User } from "lucide-svelte";
    import NavIcon from "./NavIcon.svelte";
    import { notifications, refreshNotifications } from "$lib/state/features/notifications.svelte";
    import { onMount } from "svelte";
    import { userState, logout } from "$lib/state/features/user.svelte";
    import { Button } from '$lib/components/ui';

    const allSections = $derived<Section[]>([
        ...getSections(),
        ...getDynamicPluginsSections(
            pluginNavState.controlCenters,
            pluginNavState.enabledByPluginId,
            page.data.activeOrgKind,
        ),
    ]);
    function isActive(item: SectionItem): boolean {
        return item.activeWhen ? item.activeWhen(page.url) : item.matcher(canonicalPath(page.url.pathname));
    }
    const isReliability = $derived(canonicalPath(page.url.pathname).startsWith("/reliability"));
    const isCloud = $derived(canonicalPath(page.url.pathname).startsWith("/cloud"));
    const isSettings = $derived(canonicalPath(page.url.pathname).startsWith("/settings"));
    const isWorkforce = $derived(canonicalPath(page.url.pathname).startsWith("/workforce"));

    let mobileMenuOpen = $state(false);
    function toggleMobileMenu() {
        mobileMenuOpen = !mobileMenuOpen;
    }
    function closeMobileMenu() {
        mobileMenuOpen = false;
    }

    let notificationsOpen = $state(false);

    const displayName = $derived(userState.user?.displayName ?? userState.user?.email ?? "");
    const email = $derived(userState.user?.email ?? "");

    onMount(() => {
        refreshNotifications();
        const interval = setInterval(refreshNotifications, 60_000);
        return () => clearInterval(interval);
    });
</script>

<header
    class="md:hidden shrink-0 relative z-[var(--layer-navigation,20)] bg-bg/95 backdrop-blur-md border-b border-[var(--hairline)] h-14"
>
    <div class="relative flex items-center h-full px-3 gap-2">
        <Button variant="ghost" size="xs"
            type="button"
            onclick={toggleMobileMenu}
            class="flex items-center justify-center w-9 h-9 rounded-lg text-muted hover:text-foreground hover:bg-bg3 transition-all duration-[var(--duration-fast)]"
            aria-label={m.topbar_toggleMenu()}
            aria-expanded={mobileMenuOpen}
        >
            {#if mobileMenuOpen}<X size={20} />{:else}<Menu size={20} />{/if}
        </Button>

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

        <Button variant="ghost" size="xs"
            type="button"
            onclick={() => togglePalette()}
            class="flex items-center justify-center w-9 h-9 rounded-lg text-muted hover:text-foreground hover:bg-bg3 transition-all duration-[var(--duration-fast)]"
            aria-label="Open command palette"
            title="Command palette"
        >
            <Search size={18} />
        </Button>

        <!-- Notification bell -->
        <div class="relative">
            <Button variant="ghost" size="xs"
                type="button"
                onclick={() => (notificationsOpen = !notificationsOpen)}
                class="flex items-center justify-center w-9 h-9 rounded-lg text-muted hover:text-foreground hover:bg-bg3 transition-all duration-[var(--duration-fast)] relative"
                aria-label="{notifications.badgeCount} notifications"
                title="Notifications"
                aria-expanded={notificationsOpen}
            >
                <Bell size={18} />
                {#if notifications.hasPending}
                    <span
                        class="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full bg-destructive text-[length:var(--font-size-telemetry)] font-bold text-accent-foreground leading-none"
                    >
                        {notifications.badgeCount > 99 ? "99+" : notifications.badgeCount}
                    </span>
                {/if}
            </Button>
            <NotificationsPopup bind:open={notificationsOpen} />
        </div>

        <div class="shrink-0"><ProfileMenu /></div>
    </div>

    {#if mobileMenuOpen}
        <!-- Backdrop (below the header bar) -->
        <Button variant="ghost" size="xs"
            class="fixed inset-0 !h-auto top-[calc(3.5rem+env(safe-area-inset-top,0px))] z-[var(--layer-base,0)] bg-[color-mix(in_srgb,var(--color-canvas,var(--color-bg))_40%,transparent)] cursor-default"
            onclick={closeMobileMenu}
            aria-label="Close menu"
            tabindex="-1"
        ></Button>

        <!-- Menu panel -->
        <div
            class="mobile-menu-panel absolute top-full left-0 right-0 z-[var(--layer-navigation,20)] bg-bg2/98 backdrop-blur-xl border-b border-border shadow-[var(--shadow-overlay,var(--shadow-xl,var(--shadow-lg)))]"
        >
            <!-- Scroll body: domains + sections -->
            <nav class="mobile-menu-nav flex flex-col sm:flex-row sm:gap-4 overflow-y-auto px-2 pt-2 pb-1">
                <div class="flex-1 min-w-0">
                    {#each allSections as section (section.id)}
                        {@const items = section.items.filter((i) => canViewPath(i.href))}
                        {@const hasSubs = (section.subsections?.length ?? 0) > 0}
                        {#if items.length || hasSubs}
                            <div
                                class="px-3 py-1 text-[length:var(--font-size-telemetry)] font-semibold uppercase tracking-wider text-muted-strong mt-1"
                            >
                                {section.label}
                            </div>
                            {#each items as item (item.href)}
                                <a
                                    href={item.href}
                                    class="mobile-nav-link {section.tone === 'brand' ? 'brand' : ''} {isActive(item)
                                        ? section.tone === 'brand'
                                            ? 'active-brand'
                                            : 'active'
                                        : ''}"
                                    onclick={closeMobileMenu}
                                >
                                    <NavIcon icon={item.icon} size={16} />
                                    <span>{item.label}</span>
                                </a>
                            {/each}
                            {#each section.subsections ?? [] as sub (sub.id)}
                                {@const subItems = sub.items.filter((i) => canViewPath(i.href))}
                                {#if subItems.length}
                                    <div
                                        class="px-5 py-1 text-[length:var(--font-size-telemetry)] font-medium uppercase tracking-wider text-muted mt-0.5"
                                    >
                                        {sub.label}
                                    </div>
                                    {#each subItems as item (item.href)}
                                        <a
                                            href={item.href}
                                            class="mobile-nav-link {isActive(item) ? 'active' : ''}"
                                            onclick={closeMobileMenu}
                                        >
                                            <NavIcon icon={item.icon} size={16} />
                                            <span>{item.label}</span>
                                        </a>
                                    {/each}
                                {/if}
                            {/each}
                        {/if}
                    {/each}
                </div>

                <!-- Standalone items (reliability, notifications) -->
                <div class="sm:hidden mt-1 pt-1 border-t border-[var(--hairline)]">
                    {#if canViewPath("/cloud")}
                        <a href="/cloud" class="mobile-nav-link {isCloud ? 'active' : ''}" onclick={closeMobileMenu}>
                            <Cloud size={16} />
                            <span>{m.nav_cloud()}</span>
                        </a>
                    {/if}
                    {#if canViewPath("/reliability")}
                        <a
                            href="/reliability"
                            class="mobile-nav-link {isReliability ? 'active' : ''}"
                            onclick={closeMobileMenu}
                        >
                            <Activity size={16} />
                            <span>{m.nav_reliability()}</span>
                        </a>
                    {/if}
                </div>
            </nav>

            <!-- Pinned footer -->
            <div
                class="mobile-menu-footer shrink-0 border-t border-[var(--hairline)] px-2 py-2 flex flex-col gap-1 bg-bg2"
            >
                {#if canViewPath("/cloud")}
                    <a
                        href="/cloud"
                        class="mobile-nav-link text-xs hidden sm:flex {isCloud ? 'active' : ''}"
                        onclick={closeMobileMenu}
                    >
                        <Cloud size={15} />
                        <span>{m.nav_cloud()}</span>
                    </a>
                {/if}
                <!-- Reliability (sm+) -->
                {#if canViewPath("/reliability")}
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
                {#if canViewPath("/notifications")}
                    <a href="/notifications" class="mobile-nav-link text-xs" onclick={closeMobileMenu}>
                        <Bell size={15} />
                        <span>Notifications</span>
                        {#if notifications.hasPending}
                            <span
                                class="ml-auto text-[length:var(--font-size-telemetry)] font-bold px-1.5 py-0.5 rounded-full bg-destructive text-accent-foreground leading-none"
                            >
                                {notifications.badgeCount > 99 ? "99+" : notifications.badgeCount}
                            </span>
                        {/if}
                    </a>
                {/if}

                <!-- User row -->
                <a href="/account" class="mobile-nav-link text-xs mt-1" onclick={closeMobileMenu}>
                    <User size={15} />
                    <span class="truncate">{displayName || email}</span>
                </a>

                <!-- Logout -->
                <Button variant="ghost" size="xs" type="button" onclick={logout} class="mobile-nav-link text-xs text-muted hover:text-destructive">
                    <LogOut size={15} />
                    <span>Log out</span>
                </Button>

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
    .mobile-menu-nav {
        max-height: calc(70dvh - 3.5rem - env(safe-area-inset-bottom, 0px));
        overscroll-behavior: contain;
    }
    @media (min-width: 640px) {
        .mobile-menu-nav {
            max-height: calc(75dvh - 3.5rem - env(safe-area-inset-bottom, 0px));
        }
    }
    @keyframes menu-slide-in {
        from {
            opacity: 0;
            transform: translateY(-8px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .mobile-nav-link {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-lg);
        font-size: var(--font-size-body);
        font-weight: 500;
        color: var(--color-muted);
        text-decoration: none;
        position: relative;
        transition: all var(--duration-fast) var(--ease-standard);
    }
    .mobile-nav-link:hover {
        color: var(--color-foreground);
        background: var(--color-bg3);
    }
    .mobile-nav-link.active {
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 12%, transparent);
        font-weight: 600;
    }
    .mobile-nav-link.brand {
        color: var(--color-brand-pink);
    }
    .mobile-nav-link.active-brand {
        color: var(--color-brand-pink);
        background: color-mix(in srgb, var(--color-brand-pink) 15%, transparent);
        font-weight: 600;
    }
    /* Active left indicator bar — matches desktop sidebar */
    .mobile-nav-link.active::before,
    .mobile-nav-link.active-brand::before {
        content: "";
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
        from {
            transform: translateY(-50%) scaleY(0.3);
            opacity: 0;
        }
        to {
            transform: translateY(-50%) scaleY(1);
            opacity: 1;
        }
    }

    /* Pinned footer: slightly different hover bg for contrast */
    .mobile-menu-footer .mobile-nav-link:hover {
        background: var(--color-bg3);
    }
</style>
