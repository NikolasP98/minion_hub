<script lang="ts">
    // Mobile-only header (< md). At md+ the sidebar carries brand + host + nav,
    // and the floating DynamicIsland carries the global actions.
    import HostPill from "../hosts/HostPill.svelte";
    import ProfileMenu from "./ProfileMenu.svelte";
    import MinionLogo from "./MinionLogo.svelte";
    import CompanySwitcher from "./CompanySwitcher.svelte";
    import { getSections, gateSections } from "./sections";
    import { pluginNavState } from "$lib/state/plugin-nav.svelte";
    import { canClient } from "$lib/access/can.svelte";
    import { togglePalette } from "$lib/state/ui/command-palette.svelte";
    import { page } from "$app/state";
    import * as m from "$lib/paraglide/messages";
    import { Activity, Settings, Menu, X, Search } from "lucide-svelte";

    const sections = $derived(gateSections(getSections(), pluginNavState.enabledByPluginId));
    const isReliability = $derived(page.url.pathname.startsWith("/reliability"));
    const isSettings = $derived(page.url.pathname.startsWith("/settings"));
    const isWorkforce = $derived(page.url.pathname.startsWith("/workforce"));

    let mobileMenuOpen = $state(false);
    function toggleMobileMenu() { mobileMenuOpen = !mobileMenuOpen; }
    function closeMobileMenu() { mobileMenuOpen = false; }
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
        <div class="shrink-0"><ProfileMenu /></div>
    </div>

    {#if mobileMenuOpen}
        <div
            class="absolute top-full left-0 right-0 bg-bg2/95 backdrop-blur-md border-b border-border shadow-lg"
            style="animation: slide-up 150ms ease-out"
        >
            <nav class="flex flex-col p-2 gap-1 max-h-[70vh] overflow-y-auto">
                {#if canClient('reliability.monitor')}
                <a href="/reliability" class="mobile-nav-link {isReliability ? 'active' : ''}" onclick={closeMobileMenu}>
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
                <a href="/settings" class="mobile-nav-link {isSettings ? 'active' : ''}" onclick={closeMobileMenu}>
                    <Settings size={18} />
                    <span>{m.nav_settings()}</span>
                </a>
                {#if isWorkforce}
                    <div class="h-px bg-border/60 my-1"></div>
                    <div class="px-3 py-2"><CompanySwitcher /></div>
                {/if}
            </nav>
        </div>
    {/if}
</header>

<style>
    @keyframes slide-up {
        from { opacity: 0; transform: translateY(-6px); }
        to { opacity: 1; transform: translateY(0); }
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
    .mobile-nav-link:hover { color: var(--color-foreground); background: var(--color-bg3); }
    .mobile-nav-link.active { color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 12%, transparent); }
    .mobile-nav-link.brand { color: var(--color-brand-pink); }
    .mobile-nav-link.active-brand { background: color-mix(in srgb, var(--color-brand-pink) 15%, transparent); }
</style>
