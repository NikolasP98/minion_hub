<script lang="ts">
    import { page } from "$app/stores";
    import {
        marketplaceState,
        loadAgents,
    } from "$lib/state/features/marketplace.svelte";
    import AgentCreatorWizard from "$lib/components/marketplace/AgentCreatorWizard.svelte";
    import * as m from "$lib/paraglide/messages";
    import { Store, Bot, Terminal, Puzzle, Anchor, Server, Plus } from "lucide-svelte";
    import Splitter from "$lib/components/layout/Splitter.svelte";

    import { type Snippet } from "svelte";

    let { children }: { children: Snippet } = $props();

    const sections = [
        {
            href: "/marketplace/plugins",
            label: "Plugins",
            icon: Puzzle,
            active: true,
            soon: false,
        },
        {
            href: "/marketplace/tools",
            label: "Commands / Tools",
            icon: Terminal,
            active: false,
            soon: true,
        },
        {
            href: "/marketplace/agents",
            label: "Agents",
            icon: Bot,
            active: true,
            soon: false,
        },
        {
            href: "/marketplace/hooks",
            label: "Hooks",
            icon: Anchor,
            active: false,
            soon: true,
        },
        {
            href: "/marketplace/mcp-servers",
            label: "MCP Servers",
            icon: Server,
            active: false,
            soon: true,
        },
    ];

    const currentPath = $derived($page.url.pathname);

    let showCreatorWizard = $state(false);
</script>

<div class="marketplace-splitter-wrapper">
    <Splitter
        storageKey="sidebar-marketplace"
        defaultSize={16}
        minibarSize={5}
        maxSize={22}
    >
        {#snippet panel({ collapseLevel })}
            <aside class="marketplace-sidebar" class:mini={collapseLevel !== 'expanded'}>
                <!-- Brand -->
                <div class="sidebar-brand">
                    <div class="brand-icon">
                        <Store size={20} />
                    </div>
                    <div class="brand-text">
                        <span class="brand-name">{m.marketplace_title()}</span>
                        <span class="brand-tagline">{m.marketplace_hireTagline()}</span>
                    </div>
                </div>

                <!-- Main Nav -->
                <nav class="sidebar-nav">
                    <div class="nav-section">
                        <span class="nav-label">{m.marketplace_browse()}</span>
                        <ul class="nav-list">
                            {#each sections as section (section.href)}
                                <li>
                                    <a
                                        href={section.href}
                                        class="nav-item"
                                        class:active={currentPath.startsWith(
                                            section.href,
                                        )}
                                        class:disabled={section.soon}
                                    >
                                        <section.icon size={16} />
                                        <span class="nav-text">{section.label}</span
                                        >
                                        {#if section.soon}
                                            <span class="soon-badge">{m.marketplace_comingSoon()}</span>
                                        {:else if currentPath.startsWith(section.href)}
                                            <span class="active-indicator"></span>
                                        {/if}
                                    </a>
                                </li>
                            {/each}
                        </ul>
                    </div>
                </nav>

                <!-- Create Button -->
                <div class="sidebar-actions">
                    <button
                        type="button"
                        onclick={() => {
                            showCreatorWizard = true;
                        }}
                        class="create-btn"
                    >
                        <Plus size={14} />
                        <span>{m.marketplace_createAgentBtn()}</span>
                    </button>
                </div>
            </aside>
        {/snippet}
        <main class="marketplace-main">
            {@render children()}
        </main>
    </Splitter>
    </div>

{#if showCreatorWizard}
    <AgentCreatorWizard
        onClose={() => {
            showCreatorWizard = false;
        }}
    />
{/if}

<style>
    /* Sidebar */
    .marketplace-sidebar {
        width: 100%;
        height: 100%;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        background: var(--color-bg);
        border-right: 1px solid var(--color-border);
        padding: 16px 0;
    }

    /* Mini (icon-only) mode */
    .marketplace-sidebar.mini {
        padding: 8px 0;
    }

    .marketplace-sidebar.mini .brand-text,
    .marketplace-sidebar.mini .nav-label,
    .marketplace-sidebar.mini .nav-text,
    .marketplace-sidebar.mini .soon-badge,
    .marketplace-sidebar.mini .sidebar-actions {
        display: none;
    }

    .marketplace-sidebar.mini .sidebar-brand {
        justify-content: center;
        padding: 4px 0 8px;
    }

    .marketplace-sidebar.mini .sidebar-nav {
        padding: 4px 6px;
    }

    .marketplace-sidebar.mini .nav-item {
        padding: 8px;
        justify-content: center;
        gap: 0;
    }

    /* Brand */
    .sidebar-brand {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 0 16px 12px;
        margin-bottom: 4px;
    }

    .brand-icon {
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: color-mix(
            in srgb,
            var(--color-brand-pink) 15%,
            transparent
        );
        border: 1px solid
            color-mix(in srgb, var(--color-brand-pink) 25%, transparent);
        border-radius: 8px;
        color: var(--color-brand-pink);
    }

    .brand-text {
        display: flex;
        flex-direction: column;
        gap: 1px;
    }

    .brand-name {
        font-size: 14px;
        font-weight: 700;
        color: var(--color-foreground);
        letter-spacing: -0.01em;
    }

    .brand-tagline {
        font-size: 11px;
        color: var(--color-muted);
        font-weight: 500;
    }

    /* Navigation */
    .sidebar-nav {
        flex: 1;
        padding: 8px 12px;
        overflow-y: auto;
    }

    .nav-section {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .nav-label {
        font-size: 10px;
        font-weight: 600;
        color: var(--color-muted);
        text-transform: uppercase;
        letter-spacing: 0.1em;
        padding: 0 8px;
    }

    .nav-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .nav-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 12px;
        border-radius: 6px;
        color: var(--color-muted);
        text-decoration: none;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.15s ease;
        position: relative;
    }

    .nav-item:hover:not(.disabled) {
        color: var(--color-foreground);
        background: var(--color-bg3);
    }

    .nav-item.active {
        background: color-mix(
            in srgb,
            var(--color-brand-pink) 12%,
            transparent
        );
        color: var(--color-brand-pink);
    }

    .nav-item.disabled {
        opacity: 0.5;
        cursor: not-allowed;
        pointer-events: none;
    }

    .nav-text {
        flex: 1;
    }

    .soon-badge {
        font-size: 9px;
        padding: 2px 6px;
        background: var(--color-bg3);
        border-radius: 4px;
        color: var(--color-muted);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        white-space: nowrap;
        margin-left: auto;
    }

    .active-indicator {
        width: 5px;
        height: 5px;
        background: var(--color-brand-pink);
        border-radius: 50%;
        box-shadow: 0 0 6px var(--color-brand-pink);
    }

    /* Actions */
    .sidebar-actions {
        padding: 16px;
        border-top: 1px solid var(--color-border);
    }

    .create-btn {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 10px 16px;
        background: var(--color-brand-pink);
        border: none;
        border-radius: 8px;
        color: white;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .create-btn:hover {
        opacity: 0.9;
        transform: translateY(-1px);
    }

    /* Splitter wrapper — flex fills remaining height below topbar */
    .marketplace-splitter-wrapper {
        flex: 1;
        min-height: 0;
        display: flex;
        overflow: hidden;
    }

    /* Main Content */
    .marketplace-main {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        background: var(--color-bg);
    }

    /* Scrollbar */
    .marketplace-main::-webkit-scrollbar {
        width: 6px;
    }

    .marketplace-main::-webkit-scrollbar-track {
        background: transparent;
    }

    .marketplace-main::-webkit-scrollbar-thumb {
        background: var(--color-border);
        border-radius: 3px;
    }

    .marketplace-main::-webkit-scrollbar-thumb:hover {
        background: color-mix(in srgb, var(--color-border) 80%, white);
    }

    /* Responsive */
    @media (max-width: 768px) {
        /*
         * Force the Zag splitter panel to a narrow fixed width on mobile.
         * The Zag machine stores its panel size as a percentage in localStorage.
         * A large stored percentage (e.g. 45%) can render as 169px on a 375px
         * viewport. max-width overrides flex-basis so this always wins.
         */
        :global(.marketplace-splitter-wrapper [data-part="panel"][data-index="0"]) {
            max-width: 44px !important;
            flex-basis: 44px !important;
            flex-shrink: 0;
        }

        /* Hide resize handle on mobile — panel is fixed width */
        :global(.marketplace-splitter-wrapper [data-part="resize-trigger"]) {
            display: none;
        }

        .marketplace-sidebar {
            width: 44px;
            min-width: 44px;
        }

        .sidebar-brand {
            display: none;
        }

        .brand-text,
        .nav-label,
        .soon-badge,
        .sidebar-actions {
            display: none;
        }

        .sidebar-nav {
            flex: 1;
            padding: 4px 0;
            overflow-x: hidden;
            overflow-y: auto;
        }

        .nav-section {
            flex-direction: column;
        }

        .nav-list {
            flex-direction: column;
            gap: 2px;
            flex-wrap: nowrap;
        }

        .nav-item {
            padding: 8px;
            justify-content: center;
            gap: 0;
            flex-shrink: 0;
        }

        .nav-text {
            display: none;
        }

        .active-indicator {
            position: absolute;
            bottom: 2px;
            left: 50%;
            transform: translateX(-50%);
        }
    }
</style>
