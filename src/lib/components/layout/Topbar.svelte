<script lang="ts">
    import HostPill from "../hosts/HostPill.svelte";
    import ProfileMenu from "./ProfileMenu.svelte";
    import MinionLogo from "./MinionLogo.svelte";
    import Tooltip from "./Tooltip.svelte";
    import ScanLine from "$lib/components/decorations/ScanLine.svelte";
    import CompanySwitcher from "./CompanySwitcher.svelte";
    import SectionSwitcher from "./SectionSwitcher.svelte";
    import { getSections, findActiveSection } from "./sections";
    import { canClient } from "$lib/access/can.svelte";
    import { theme } from "$lib/state/ui/theme.svelte";
    import { page } from "$app/state";
    import * as m from "$lib/paraglide/messages";
    import { Activity, Settings, Menu, X, Bug } from "lucide-svelte";
    import { captureSnapshot, bugReporter } from "$lib/state/ui/bug-reporter.svelte";

    const sections = getSections();
    const activeSection = $derived(findActiveSection(sections, page.url.pathname));
    const isReliability = $derived(page.url.pathname.startsWith("/reliability"));
    const isSettings = $derived(page.url.pathname.startsWith("/settings"));
    // Company picker is scoped to the Workforce area only.
    const isWorkforce = $derived(page.url.pathname.startsWith("/workforce"));

    let mobileMenuOpen = $state(false);
    function toggleMobileMenu() { mobileMenuOpen = !mobileMenuOpen; }
    function closeMobileMenu() { mobileMenuOpen = false; }
</script>

<header class="shrink-0 relative z-50 bg-bg/95 backdrop-blur-md border-b border-border h-14">
    <!-- Subtle scan line effect -->
    <div class="absolute inset-0 overflow-hidden pointer-events-none">
        <ScanLine speed={16} opacity={0.015} dual={theme.preset.id === 'voxelized'} />
    </div>

    <div class="relative flex items-center h-full px-3 gap-2">
        <!-- Brand Logo -->
        <a
            href="/"
            class="flex items-center gap-2 no-underline group shrink-0"
            aria-label="Minion Hub"
        >
            <MinionLogo size="sm" />
            <div class="hidden 2xl:flex items-center leading-none">
                <span class="font-black text-sm tracking-wide uppercase text-brand-pink group-hover:text-brand-pink/90 transition-colors">MINION</span>
                <span class="font-semibold text-sm text-foreground/80 ml-1 group-hover:text-foreground transition-colors">hub</span>
            </div>
        </a>

        <div class="h-5 w-px bg-border/60 mx-1 shrink-0"></div>

        <!-- Host Pill -->
        <div class="shrink-0">
            <HostPill />
        </div>

        <!-- Reliability quick-link (icon only) — admin-only plugin view -->
        {#if canClient('reliability.monitor')}
        <Tooltip label={m.nav_reliability()} id="nav-reliability">
            {#snippet children(triggerProps)}
                <a
                    href="/reliability"
                    class="hidden min-[470px]:flex items-center justify-center w-8 h-8 rounded-lg text-muted hover:text-foreground hover:bg-bg3 transition-all duration-150 {isReliability ? 'text-accent bg-accent/12' : ''}"
                    {...triggerProps}
                >
                    <Activity size={16} />
                </a>
            {/snippet}
        </Tooltip>
        {/if}

        <div class="h-5 w-px bg-border/60 mx-1 shrink-0 hidden min-[470px]:block"></div>

        <!-- Section Switcher (always visible from 470px up) -->
        <div class="hidden min-[470px]:block">
            <SectionSwitcher />
        </div>

        <!-- Contextual sub-nav for the active section -->
        {#if activeSection}
            <nav
                class="hidden md:flex items-center gap-0.5 min-w-0 overflow-hidden pl-1"
                aria-label="{activeSection.label} navigation"
            >
                {#each activeSection.items.filter((i) => !i.requires || canClient(i.requires)) as item (item.href)}
                    {@const isActive = item.matcher(page.url.pathname)}
                    <Tooltip label={item.label} id="ctx-{item.href}">
                        {#snippet children(triggerProps)}
                            <a
                                href={item.href}
                                class="ctx-link {isActive ? 'ctx-active' : ''} {activeSection.tone === 'brand' ? 'ctx-brand' : 'ctx-accent'}"
                                {...triggerProps}
                            >
                                <!-- icon on small, text on lg+ -->
                                <item.icon size={14} class="ctx-icon" />
                                <span class="hidden lg:inline">{item.label}</span>
                            </a>
                        {/snippet}
                    </Tooltip>
                {/each}
            </nav>
        {/if}

        <!-- Spacer: pushes right cluster to the right -->
        <div class="flex-1 min-w-0"></div>

        <!-- Right Actions -->
        <div class="flex items-center gap-1.5 shrink-0">
            {#if isWorkforce}
                <div class="hidden sm:block">
                    <CompanySwitcher />
                </div>
            {/if}

            <button
                onclick={() => captureSnapshot()}
                disabled={bugReporter.phase === 'capturing'}
                class="flex items-center justify-center w-9 h-9 rounded-lg text-muted hover:text-foreground hover:bg-bg3 transition-all duration-150 disabled:opacity-50 disabled:cursor-wait"
                aria-label={m.bug_reportButton()}
                title={m.bug_reportButton()}
            >
                <Bug size={18} />
            </button>

            <a
                href="/settings"
                class="flex items-center justify-center w-9 h-9 rounded-lg text-muted hover:text-foreground hover:bg-bg3 transition-all duration-150 {isSettings ? 'text-foreground bg-bg3' : ''}"
                title={m.nav_settings()}
            >
                <Settings size={18} />
            </a>

            <div class="h-5 w-px bg-border/60 mx-0.5 hidden sm:block"></div>

            <div class="hidden sm:block">
                <ProfileMenu />
            </div>

            <button
                type="button"
                onclick={toggleMobileMenu}
                class="flex min-[470px]:hidden items-center justify-center w-9 h-9 rounded-lg text-muted hover:text-foreground hover:bg-bg3 transition-all duration-150"
                aria-label={m.topbar_toggleMenu()}
                aria-expanded={mobileMenuOpen}
            >
                {#if mobileMenuOpen}<X size={20} />{:else}<Menu size={20} />{/if}
            </button>
        </div>
    </div>

    <!-- Mobile Navigation Menu (Dropdown) -->
    {#if mobileMenuOpen}
        <div
            class="absolute top-full left-0 right-0 bg-bg2/95 backdrop-blur-md border-b border-border shadow-lg min-[470px]:hidden"
            style="animation: slide-up 150ms ease-out"
        >
            <nav class="flex flex-col p-2 gap-1">
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
    .ctx-link {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.375rem 0.5rem;
        border-radius: 0.4375rem;
        font-size: 0.75rem;
        font-weight: 500;
        color: var(--color-muted);
        text-decoration: none;
        white-space: nowrap;
        transition:
            color 120ms ease,
            background 120ms ease;
        position: relative;
    }
    .ctx-link :global(.ctx-icon) {
        opacity: 0.7;
        transition: opacity 120ms ease;
    }
    .ctx-link:hover {
        color: var(--color-foreground);
        background: var(--color-bg2);
    }
    .ctx-link:hover :global(.ctx-icon) {
        opacity: 1;
    }
    .ctx-active.ctx-accent {
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 12%, transparent);
        font-weight: 600;
    }
    .ctx-active.ctx-accent :global(.ctx-icon) {
        opacity: 1;
        color: var(--color-accent);
    }
    .ctx-active.ctx-accent::after {
        content: "";
        position: absolute;
        left: 25%;
        right: 25%;
        bottom: -1px;
        height: 2px;
        background: var(--color-accent);
        border-radius: 1px;
        animation: indicator-in 220ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    .ctx-active.ctx-brand {
        color: var(--color-brand-pink);
        background: color-mix(
            in srgb,
            var(--color-brand-pink) 12%,
            transparent
        );
        font-weight: 600;
    }
    .ctx-active.ctx-brand :global(.ctx-icon) {
        opacity: 1;
        color: var(--color-brand-pink);
    }
    .ctx-active.ctx-brand::after {
        content: "";
        position: absolute;
        left: 25%;
        right: 25%;
        bottom: -1px;
        height: 2px;
        background: var(--color-brand-pink);
        border-radius: 1px;
        animation: indicator-in 220ms cubic-bezier(0.22, 1, 0.36, 1);
    }

    @keyframes indicator-in {
        from {
            transform: scaleX(0.4);
            opacity: 0;
        }
        to {
            transform: scaleX(1);
            opacity: 1;
        }
    }
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
