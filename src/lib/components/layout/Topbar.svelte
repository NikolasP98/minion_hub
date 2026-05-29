<script lang="ts">
    import HostPill from "../hosts/HostPill.svelte";
    import ProfileMenu from "./ProfileMenu.svelte";
    import MinionLogo from "./MinionLogo.svelte";
    import ScanLine from "$lib/components/decorations/ScanLine.svelte";
    import CompanySwitcher from "./CompanySwitcher.svelte";
    import { getSections, gateSections } from "./sections";
    import { pluginNavState } from "$lib/state/plugin-nav.svelte";
    import { canClient } from "$lib/access/can.svelte";
    import { theme } from "$lib/state/ui/theme.svelte";
    import { togglePalette } from "$lib/state/ui/command-palette.svelte";
    import { page } from "$app/state";
    import * as m from "$lib/paraglide/messages";
    import { Activity, Settings, Menu, X, Bug, Search } from "lucide-svelte";
    import { captureSnapshot, bugReporter } from "$lib/state/ui/bug-reporter.svelte";

    const sections = $derived(gateSections(getSections(), pluginNavState.enabledByPluginId));
    const isReliability = $derived(page.url.pathname.startsWith("/reliability"));
    const isSettings = $derived(page.url.pathname.startsWith("/settings"));
    // Company picker is scoped to the Workforce area only.
    const isWorkforce = $derived(page.url.pathname.startsWith("/workforce"));

    let mobileMenuOpen = $state(false);
    function toggleMobileMenu() { mobileMenuOpen = !mobileMenuOpen; }
    function closeMobileMenu() { mobileMenuOpen = false; }
</script>

<header class="shrink-0 relative z-50 bg-bg/95 backdrop-blur-md border-b border-[var(--hairline)] h-14">
    <!-- Subtle scan line effect -->
    <div class="absolute inset-0 overflow-hidden pointer-events-none">
        <ScanLine speed={16} opacity={0.015} dual={theme.preset.id === 'voxelized'} />
    </div>

    <div class="relative flex items-center h-full px-3 gap-2">
        <!-- Mobile nav toggle (sidebar is hidden below md) -->
        <button
            type="button"
            onclick={toggleMobileMenu}
            class="flex md:hidden items-center justify-center w-9 h-9 rounded-lg text-muted hover:text-foreground hover:bg-bg3 transition-all duration-150"
            aria-label={m.topbar_toggleMenu()}
            aria-expanded={mobileMenuOpen}
        >
            {#if mobileMenuOpen}<X size={20} />{:else}<Menu size={20} />{/if}
        </button>

        <!-- Brand Logo -->
        <a
            href="/"
            class="flex items-center gap-2 no-underline group shrink-0"
            aria-label="Minion Hub"
        >
            <MinionLogo size="sm" />
            <div class="hidden md:flex items-center leading-none">
                <span class="font-black text-sm tracking-wide uppercase text-brand-pink group-hover:text-brand-pink/90 transition-colors">MINION</span>
                <span class="font-semibold text-sm text-foreground/80 ml-1 group-hover:text-foreground transition-colors">hub</span>
            </div>
        </a>

        <div class="h-5 w-px bg-[var(--hairline)] mx-1 shrink-0"></div>

        <!-- Host Pill -->
        <div class="shrink-0">
            <HostPill />
        </div>

        <!-- Spacer: pushes right cluster to the right -->
        <div class="flex-1 min-w-0"></div>

        <!-- Right Actions -->
        <div class="flex items-center gap-1.5 shrink-0">
            {#if isWorkforce}
                <div class="hidden sm:block">
                    <CompanySwitcher />
                </div>
            {/if}

            <!-- Command palette trigger (discoverability for Cmd+K) -->
            <button
                type="button"
                onclick={() => togglePalette()}
                class="hidden md:inline-flex items-center gap-2 h-8 pl-2.5 pr-2 rounded-[var(--radius-md)] text-muted-foreground border border-[var(--hairline)] bg-white/[0.02] hover:text-foreground hover:bg-white/[0.05] transition-colors duration-150"
                aria-label="Open command palette"
                title="Command palette"
            >
                <Search size={14} />
                <span class="text-xs">Search</span>
                <kbd class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg3 border border-[var(--hairline)] leading-none">⌘K</kbd>
            </button>

            <button
                onclick={() => captureSnapshot()}
                disabled={bugReporter.phase === 'capturing'}
                class="flex items-center justify-center w-9 h-9 rounded-lg text-muted hover:text-foreground hover:bg-bg3 transition-all duration-150 disabled:opacity-50 disabled:cursor-wait"
                aria-label={m.bug_reportButton()}
                title={m.bug_reportButton()}
            >
                <Bug size={18} />
            </button>

            <div class="h-5 w-px bg-[var(--hairline)] mx-0.5 hidden sm:block"></div>

            <div class="hidden sm:block">
                <ProfileMenu />
            </div>
        </div>
    </div>

    <!-- Mobile Navigation Menu (below md — sidebar replaces this at md+) -->
    {#if mobileMenuOpen}
        <div
            class="absolute top-full left-0 right-0 bg-bg2/95 backdrop-blur-md border-b border-border shadow-lg md:hidden"
            style="animation: slide-up 150ms ease-out"
        >
            <nav class="flex flex-col p-2 gap-1 max-h-[70vh] overflow-y-auto">
                {#if canClient('reliability.monitor')}
                <a
                    href="/reliability"
                    class="mobile-nav-link {isReliability ? 'active' : ''}"
                    onclick={closeMobileMenu}
                >
                    <Activity size={18} />
                    <span>{m.nav_reliability()}</span>
                </a>
                {/if}
                {#each sections as section (section.id)}
                    <div class="h-px bg-border/60 my-1"></div>
                    <div class="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted/60">
                        {section.label}
                    </div>
                    {#each section.items.filter((i) => !i.requires || canClient(i.requires)) as item (item.href)}
                        {@const isActive = item.matcher(page.url.pathname)}
                        <a
                            href={item.href}
                            class="mobile-nav-link {section.tone === 'brand' ? 'brand' : ''} {isActive ? (section.tone === 'brand' ? 'active-brand' : 'active') : ''}"
                            onclick={closeMobileMenu}
                        >
                            <item.icon size={18} />
                            <span>{item.label}</span>
                        </a>
                    {/each}
                {/each}
                <div class="h-px bg-border/60 my-1"></div>
                <a
                    href="/settings"
                    class="mobile-nav-link {isSettings ? 'active' : ''}"
                    onclick={closeMobileMenu}
                >
                    <Settings size={18} />
                    <span>{m.nav_settings()}</span>
                </a>
                {#if isWorkforce}
                    <div class="h-px bg-border/60 my-1"></div>
                    <div class="px-3 py-2">
                        <CompanySwitcher />
                    </div>
                {/if}
            </nav>
        </div>
    {/if}
</header>

<style>
    @keyframes slide-up {
        from {
            opacity: 0;
            transform: translateY(-6px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

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
