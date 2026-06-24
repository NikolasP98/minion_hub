<script lang="ts">
    import { onMount } from "svelte";
    import { page } from "$app/stores";
    import { createBackNav } from "$lib/nav/back-nav.svelte";
    import { hostsState } from "$lib/state/features/hosts.svelte";
    import {
        loadAgent,
        type MarketplaceAgent,
    } from "$lib/state/features/marketplace.svelte";
    import * as m from "$lib/paraglide/messages";
    import { Search, FileText, Info, ArrowLeft } from "lucide-svelte";
    import { PageHeader } from "$lib/components/ui";
    import posthog from "posthog-js";
    import IdBadgeCard from "./_components/IdBadgeCard.svelte";
    import HiringPanel from "./_components/HiringPanel.svelte";
    import OverviewTab from "./_components/OverviewTab.svelte";
    import DocumentsTab from "./_components/DocumentsTab.svelte";

    const slug = $derived($page.params.slug);
    const initialTab = $derived(
        ($page.url.searchParams.get("tab") === "documents"
            ? "documents"
            : "overview") as Tab,
    );

    type Tab = "overview" | "documents";

    let agent = $state<MarketplaceAgent | null>(null);
    let loading = $state(true);
    let activeTab = $state<Tab>("overview");

    onMount(async () => {
        activeTab = initialTab;
        // Touch hostsState early so HiringPanel can pick a default once it's
        // mounted with an agent.
        void hostsState.hosts.length;

        const data = await loadAgent(slug as string);
        agent = data;
        loading = false;
        if (data) {
            posthog.capture('marketplace_agent_viewed', {
                agent_id: data.id,
                agent_name: data.name,
                agent_category: data.category,
            });
        }
    });

    const back = createBackNav("/marketplace/agents", m.marketplace_agentDetailBack);
</script>

<div class="flex flex-col min-h-0 flex-1">
    <PageHeader title={agent?.name ?? "Agent"}>
        {#snippet leading()}
            <button
                type="button"
                onclick={back.go}
                aria-label={m.marketplace_agentDetailBack()}
                class="flex items-center text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
            >
                <ArrowLeft size={16} class="text-accent shrink-0" />
            </button>
        {/snippet}
    </PageHeader>

    <main class="flex-1 min-h-0 overflow-y-auto">
    <div class="agent-detail-page">
    {#if loading}
        <!-- Loading State -->
        <div class="loading-state">
            <div class="w-6 h-6 border-2 border-[var(--color-brand-pink)] border-t-transparent rounded-full animate-spin"></div>
            <p class="loading-text">{m.marketplace_agentDetailLoading()}</p>
        </div>
    {:else if !agent}
        <!-- Not Found -->
        <div class="not-found">
            <Search size={40} class="text-muted-strong mb-2" />
            <h2>{m.marketplace_agentDetailNotFound()}</h2>
            <p>{m.marketplace_agentDetailNotFoundHint()}</p>
            <button type="button" onclick={back.go} class="back-btn">
                {m.marketplace_agentDetailBack()}
            </button>
        </div>
    {:else}

        <!-- Hero Section - Corporate ID Style -->
        <div class="agent-hero">
            <IdBadgeCard {agent} />
            <div class="hiring-panel-wrap">
                <HiringPanel {agent} />
            </div>
        </div>

        <!-- Tab Navigation -->
        <div class="tab-bar">
            {#each ["overview", "documents"] as const as tab (tab)}
                <button
                    type="button"
                    onclick={() => {
                        activeTab = tab;
                    }}
                    class="tab-btn"
                    class:active={activeTab === tab}
                >
                    {#if tab === "documents"}
                        <FileText size={13} />
                        <span>{m.marketplace_agentDetailTabDocuments()}</span>
                    {:else}
                        <Info size={13} />
                        <span>{m.marketplace_agentDetailTabOverview()}</span>
                    {/if}
                </button>
            {/each}
        </div>

        <!-- Tab Content -->
        <div class="tab-content">
            {#if activeTab === "overview"}
                <OverviewTab {agent} />
            {:else if activeTab === "documents"}
                <DocumentsTab {agent} />
            {/if}
        </div>
    {/if}
    </div>
    </main>
</div>

<style>
    .agent-detail-page {
        max-width: 1000px;
        margin: 0 auto;
        padding: 24px 32px 48px;
        min-height: 100%;
    }

    /* Loading State */
    .loading-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 100px 20px;
        gap: 12px;
    }

    .loading-text {
        font-size: 13px;
        color: #71717a;
    }

    /* Not Found */
    .not-found {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 100px 20px;
        text-align: center;
        gap: 8px;
    }

    .not-found h2 {
        font-size: 24px;
        font-weight: 700;
        color: #fafafa;
        margin: 0 0 8px;
    }

    .not-found p {
        font-size: 14px;
        color: #71717a;
        margin: 0 0 24px;
    }

    .back-btn {
        padding: 10px 20px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        color: #a1a1aa;
        font-size: 13px;
        cursor: pointer;
        transition: all var(--duration-normal) var(--ease-standard);
    }

    .back-btn:hover {
        background: rgba(255, 255, 255, 0.08);
        color: #fafafa;
    }

    /* Hero Section */
    .agent-hero {
        display: grid;
        grid-template-columns: 320px 1fr;
        gap: 32px;
        margin-bottom: 32px;
    }

    /* Tab Bar */
    .tab-bar {
        display: flex;
        gap: 4px;
        padding: 4px;
        background: rgba(24, 24, 27, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 12px;
        margin-bottom: 24px;
        width: fit-content;
    }

    .tab-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 20px;
        background: transparent;
        border: none;
        border-radius: 8px;
        color: #71717a;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all var(--duration-normal) var(--ease-standard);
    }

    .tab-btn:hover {
        color: #fafafa;
        background: rgba(255, 255, 255, 0.05);
    }

    .tab-btn.active {
        background: rgba(232, 84, 122, 0.15);
        color: #e8547a;
    }

    /* Tab Content */
    .tab-content {
        min-height: 300px;
    }

    /* Responsive */
    @media (max-width: 900px) {
        .agent-hero {
            grid-template-columns: 1fr;
            max-width: 400px;
            margin: 0 auto 32px;
        }

        .hiring-panel-wrap {
            order: -1;
        }
    }

    @media (max-width: 640px) {
        .agent-detail-page {
            padding: 16px;
        }

        .tab-btn {
            padding: 10px 14px;
            font-size: 12px;
        }
    }
</style>
