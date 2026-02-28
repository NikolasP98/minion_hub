<script lang="ts">
    import Topbar from "$lib/components/Topbar.svelte";
    import { page } from "$app/stores";
    import {
        marketplaceState,
        loadAgents,
    } from "$lib/state/marketplace.svelte";
    import AgentCreatorWizard from "$lib/components/marketplace/AgentCreatorWizard.svelte";
    import * as m from "$lib/paraglide/messages";
    import { Store, Wrench, Link2, Puzzle, Settings, Plus } from "lucide-svelte";

    import { type Snippet } from "svelte";

    let { children }: { children: Snippet } = $props();

    const sections = [
        {
            href: "/marketplace/agents",
            label: "Agents",
            icon: Store,
            active: true,
            soon: false,
        },
        {
            href: "/marketplace/skills",
            label: "Skills",
            icon: Wrench,
            active: false,
            soon: true,
        },
        {
            href: "/marketplace/tools",
            label: "Tools",
            icon: Settings,
            active: false,
            soon: true,
        },
        {
            href: "/marketplace/integrations",
            label: "Integrations",
            icon: Link2,
            active: false,
            soon: true,
        },
        {
            href: "/marketplace/plugins",
            label: "Plugins",
            icon: Puzzle,
            active: true,
            soon: false,
        },
    ];

    const currentPath = $derived($page.url.pathname);

    let showCreatorWizard = $state(false);
</script>

<div class="relative z-10 flex flex-col h-screen overflow-hidden">
    <Topbar />
    <div class="flex flex-1 overflow-hidden">
        <!-- Sidebar -->
        <aside class="marketplace-sidebar">
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

        <!-- Main Content -->
        <main class="marketplace-main">
            {@render children()}
        </main>
    </div>
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
        width: 220px;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        background: var(--color-bg);
        border-right: 1px solid var(--color-border);
        padding: 16px 0;
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
    @media (max-width: 1024px) {
        .marketplace-sidebar {
            width: 200px;
        }
    }

    @media (max-width: 768px) {
        .marketplace-sidebar {
            width: 100%;
            height: auto;
            max-height: 60px;
            flex-direction: row;
            align-items: center;
            padding: 0 12px;
            border-right: none;
            border-bottom: 1px solid var(--color-border);
        }

        .sidebar-brand {
            padding: 0;
            margin-bottom: 0;
            border-bottom: none;
        }

        .brand-text,
        .nav-label,
        .soon-badge,
        .sidebar-actions {
            display: none;
        }

        .sidebar-nav {
            flex: 1;
            padding: 0;
            overflow: visible;
        }

        .nav-section {
            flex-direction: row;
        }

        .nav-list {
            flex-direction: row;
            gap: 4px;
        }

        .nav-item {
            padding: 8px;
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
