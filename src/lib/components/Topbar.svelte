<script lang="ts">
    import HostPill from "./HostPill.svelte";
    import ProfileMenu from "./ProfileMenu.svelte";
    import MinionLogo from "./MinionLogo.svelte";
    import Tooltip from "./Tooltip.svelte";
    import ScanLine from "$lib/components/decorations/ScanLine.svelte";
    import { page } from "$app/state";
    import * as m from "$lib/paraglide/messages";
    import {
        Wrench,
        Activity,
        Store,
        Settings,
        Menu,
        X,
        GitBranch,
    } from "lucide-svelte";
    import { ui } from "$lib/state/ui.svelte";

    const isHome = $derived(page.url.pathname === "/");
    const isMarketplace = $derived(
        page.url.pathname.startsWith("/marketplace"),
    );
    const isWorkshop = $derived(page.url.pathname.startsWith("/workshop"));
    const isReliability = $derived(
        page.url.pathname.startsWith("/reliability"),
    );
    const isSettings = $derived(page.url.pathname.startsWith("/settings"));
    const isFlowEditor = $derived(page.url.pathname.startsWith("/flow-editor"));

    // Mobile menu state
    let mobileMenuOpen = $state(false);

    function toggleMobileMenu() {
        mobileMenuOpen = !mobileMenuOpen;
    }

    function closeMobileMenu() {
        mobileMenuOpen = false;
    }
</script>

<header
    class="shrink-0 relative z-100 bg-bg/95 backdrop-blur-md border-b border-border h-14"
>
    <!-- Subtle scan line effect -->
    <div class="absolute inset-0 overflow-hidden pointer-events-none">
        <ScanLine speed={16} opacity={0.015} />
    </div>

    <!-- Single Row Navigation -->
    <div class="relative flex items-center h-full px-3 gap-2">
        <!-- Brand Logo (icon always, text on xl+) -->
        <a
            href="/"
            class="flex items-center gap-2 no-underline group shrink-0"
            aria-label="Minion Hub"
        >
            <MinionLogo size="sm" />
            <div class="hidden xl:flex items-center leading-none">
                <span
                    class="font-black text-sm tracking-wide uppercase text-brand-pink group-hover:text-brand-pink/90 transition-colors"
                    >MINION</span
                >
                <span
                    class="font-semibold text-sm text-foreground/80 ml-1 group-hover:text-foreground transition-colors"
                    >hub</span
                >
            </div>
        </a>

        <div class="h-5 w-px bg-border/60 mx-1 shrink-0"></div>

        <!-- Host Pill (always visible) -->
        <div class="shrink-0">
            <HostPill />
        </div>

        <div class="h-5 w-px bg-border/60 mx-1 shrink-0"></div>

        <!-- Desktop Navigation - Full text (xl+) -->
        <nav class="hidden xl:flex items-center gap-1 flex-1 min-w-0">
            <div
                class="flex items-center gap-0.5 px-1.5 py-1 rounded-lg bg-bg2/50 border border-border/50"
            >
                <a
                    href="/workshop"
                    class="nav-pill {isWorkshop ? 'active' : ''}"
                    title="Workshop"
                >
                    <Wrench size={14} />
                    <span>{m.nav_workshop()}</span>
                </a>
                <a
                    href="/flow-editor"
                    class="nav-pill {isFlowEditor ? 'active' : ''}"
                    title="Flow Editor"
                >
                    <GitBranch size={14} />
                    <span>Flows</span>
                </a>
                <a
                    href="/reliability"
                    class="nav-pill {isReliability ? 'active' : ''}"
                    title="Reliability"
                >
                    <Activity size={14} />
                    <span>{m.nav_reliability()}</span>
                </a>
            </div>

            <div class="w-px h-4 bg-border/60 mx-1"></div>

            <a
                href="/marketplace"
                class="nav-pill brand {isMarketplace ? 'active-brand' : ''}"
                title="Marketplace"
            >
                <Store size={14} />
                <span>{m.nav_marketplace()}</span>
            </a>
        </nav>

        <!-- Tablet Navigation - Icons only (lg to xl) -->
        <nav class="hidden lg:flex xl:hidden items-center gap-1 flex-1">
            <div
                class="flex items-center gap-0.5 px-1.5 py-1 rounded-lg bg-bg2/50 border border-border/50"
            >
                <Tooltip label={m.nav_workshop()} id="nav-lg-workshop">
                    {#snippet children(triggerProps)}
                        <a href="/workshop" class="nav-pill {isWorkshop ? 'active' : ''}" {...triggerProps}>
                            <Wrench size={16} />
                        </a>
                    {/snippet}
                </Tooltip>
                <Tooltip label="Flow Editor" id="nav-lg-flow-editor">
                    {#snippet children(triggerProps)}
                        <a href="/flow-editor" class="nav-pill {isFlowEditor ? 'active' : ''}" {...triggerProps}>
                            <GitBranch size={16} />
                        </a>
                    {/snippet}
                </Tooltip>
                <Tooltip label={m.nav_reliability()} id="nav-lg-reliability">
                    {#snippet children(triggerProps)}
                        <a href="/reliability" class="nav-pill {isReliability ? 'active' : ''}" {...triggerProps}>
                            <Activity size={16} />
                        </a>
                    {/snippet}
                </Tooltip>
            </div>

            <div class="w-px h-4 bg-border/60 mx-1"></div>

            <Tooltip label={m.nav_marketplace()} id="nav-lg-marketplace">
                {#snippet children(triggerProps)}
                    <a href="/marketplace" class="nav-pill brand {isMarketplace ? 'active-brand' : ''}" {...triggerProps}>
                        <Store size={16} />
                    </a>
                {/snippet}
            </Tooltip>
        </nav>

        <!-- Small Tablet Navigation - Icons only, no bg (md to lg) -->
        <nav class="hidden md:flex lg:hidden items-center gap-0.5 flex-1">
            <Tooltip label={m.nav_workshop()} id="nav-md-workshop">
                {#snippet children(triggerProps)}
                    <a href="/workshop" class="nav-pill-sm {isWorkshop ? 'active' : ''}" {...triggerProps}>
                        <Wrench size={18} />
                    </a>
                {/snippet}
            </Tooltip>
            <Tooltip label="Flow Editor" id="nav-md-flow-editor">
                {#snippet children(triggerProps)}
                    <a href="/flow-editor" class="nav-pill-sm {isFlowEditor ? 'active' : ''}" {...triggerProps}>
                        <GitBranch size={18} />
                    </a>
                {/snippet}
            </Tooltip>
            <Tooltip label={m.nav_reliability()} id="nav-md-reliability">
                {#snippet children(triggerProps)}
                    <a href="/reliability" class="nav-pill-sm {isReliability ? 'active' : ''}" {...triggerProps}>
                        <Activity size={18} />
                    </a>
                {/snippet}
            </Tooltip>

            <div class="w-px h-4 bg-border/60 mx-1"></div>

            <Tooltip label={m.nav_marketplace()} id="nav-md-marketplace">
                {#snippet children(triggerProps)}
                    <a href="/marketplace" class="nav-pill-sm brand {isMarketplace ? 'active-brand' : ''}" {...triggerProps}>
                        <Store size={18} />
                    </a>
                {/snippet}
            </Tooltip>
        </nav>

        <!-- Spacer for mobile -->
        <div class="flex-1 md:hidden"></div>

        <!-- Right Actions -->
        <div class="flex items-center gap-1.5 shrink-0">
            <!-- Settings -->
            <a
                href="/settings"
                class="flex items-center justify-center w-9 h-9 rounded-lg text-muted hover:text-foreground hover:bg-bg3 transition-all duration-150 {isSettings
                    ? 'text-foreground bg-bg3'
                    : ''}"
                title={m.nav_settings()}
            >
                <Settings size={18} />
            </a>

            <div class="h-5 w-px bg-border/60 mx-0.5 hidden sm:block"></div>

            <!-- Profile (hidden on xs) -->
            <div class="hidden sm:block">
                <ProfileMenu />
            </div>

            <!-- Mobile Menu Toggle (sm and below) -->
            <button
                type="button"
                onclick={toggleMobileMenu}
                class="flex sm:hidden items-center justify-center w-9 h-9 rounded-lg text-muted hover:text-foreground hover:bg-bg3 transition-all duration-150"
                aria-label={m.topbar_toggleMenu()}
                aria-expanded={mobileMenuOpen}
            >
                {#if mobileMenuOpen}
                    <X size={20} />
                {:else}
                    <Menu size={20} />
                {/if}
            </button>
        </div>
    </div>

    <!-- Mobile Navigation Menu (Dropdown) -->
    {#if mobileMenuOpen}
        <div
            class="absolute top-full left-0 right-0 bg-bg2/95 backdrop-blur-md border-b border-border shadow-lg sm:hidden"
        >
            <nav class="flex flex-col p-2 gap-1">
                <a
                    href="/workshop"
                    class="mobile-nav-link {isWorkshop ? 'active' : ''}"
                    onclick={closeMobileMenu}
                >
                    <Wrench size={18} />
                    <span>{m.nav_workshop()}</span>
                </a>
                <a
                    href="/flow-editor"
                    class="mobile-nav-link {isFlowEditor ? 'active' : ''}"
                    onclick={closeMobileMenu}
                >
                    <GitBranch size={18} />
                    <span>Flows</span>
                </a>
                <a
                    href="/reliability"
                    class="mobile-nav-link {isReliability ? 'active' : ''}"
                    onclick={closeMobileMenu}
                >
                    <Activity size={18} />
                    <span>{m.nav_reliability()}</span>
                </a>
                <div class="h-px bg-border/60 my-1"></div>
                <a
                    href="/marketplace"
                    class="mobile-nav-link brand {isMarketplace
                        ? 'active-brand'
                        : ''}"
                    onclick={closeMobileMenu}
                >
                    <Store size={18} />
                    <span>{m.nav_marketplace()}</span>
                </a>
                <a
                    href="/settings"
                    class="mobile-nav-link {isSettings ? 'active' : ''}"
                    onclick={closeMobileMenu}
                >
                    <Settings size={18} />
                    <span>{m.nav_settings()}</span>
                </a>
            </nav>
        </div>
    {/if}
</header>

<style>
    /* Desktop nav pills with text */
    .nav-pill {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.375rem 0.625rem;
        border-radius: 0.5rem;
        font-size: 0.75rem;
        font-weight: 500;
        color: var(--color-muted);
        text-decoration: none;
        transition: all 0.15s ease;
        white-space: nowrap;
    }

    .nav-pill:hover {
        color: var(--color-foreground);
        background: var(--color-bg3);
    }

    .nav-pill.active {
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 12%, transparent);
        box-shadow: inset 0 0 0 1px
            color-mix(in srgb, var(--color-accent) 25%, transparent);
    }

    .nav-pill.brand {
        color: var(--color-brand-pink);
    }

    .nav-pill.brand:hover {
        background: color-mix(
            in srgb,
            var(--color-brand-pink) 10%,
            transparent
        );
    }

    .nav-pill.active-brand {
        background: color-mix(
            in srgb,
            var(--color-brand-pink) 15%,
            transparent
        );
        box-shadow: inset 0 0 0 1px
            color-mix(in srgb, var(--color-brand-pink) 30%, transparent);
    }

    /* Small nav pills (icon only) */
    .nav-pill-sm {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        border-radius: 0.5rem;
        color: var(--color-muted);
        transition: all 0.15s ease;
    }

    .nav-pill-sm:hover {
        color: var(--color-foreground);
        background: var(--color-bg3);
    }

    .nav-pill-sm.active {
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    }

    .nav-pill-sm.brand {
        color: var(--color-brand-pink);
    }

    .nav-pill-sm.active-brand {
        color: var(--color-brand-pink);
        background: color-mix(
            in srgb,
            var(--color-brand-pink) 15%,
            transparent
        );
    }

    /* Mobile nav links */
    .mobile-nav-link {
        display: flex;
        align-items: center;
        gap: 0.875rem;
        padding: 0.75rem 1rem;
        border-radius: 0.5rem;
        font-size: 0.9375rem;
        font-weight: 500;
        color: var(--color-muted);
        text-decoration: none;
        transition: all 0.15s ease;
    }

    .mobile-nav-link:hover {
        color: var(--color-foreground);
        background: var(--color-bg3);
    }

    .mobile-nav-link.active {
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    }

    .mobile-nav-link.brand {
        color: var(--color-brand-pink);
    }

    .mobile-nav-link.active-brand {
        background: color-mix(
            in srgb,
            var(--color-brand-pink) 15%,
            transparent
        );
    }
</style>
