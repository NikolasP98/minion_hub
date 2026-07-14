<script lang="ts">
  import { Button } from '$lib/components/ui';
import { BookOpen, Bot, Wrench, Loader2 } from "lucide-svelte";
    import { goto } from "$app/navigation";
    import { onMount } from "svelte";
    import { builderState, loadBuiltSkills, loadBuiltAgents, loadBuiltTools } from "$lib/state/builder";
    import posthog from "posthog-js";
    import { isAdmin as hubIsAdmin } from "$lib/state/features/user.svelte";
    import { conn } from "$lib/state/gateway/connection.svelte";
    import { sendRequest } from "$lib/services/gateway.svelte";
    import type { ToolStatusEntry, ToolsStatusReport } from "$lib/types/tools";
    import { toolCatalog } from "$lib/state/agents/tool-catalog.svelte";
    import SkillCreateWizard from "$lib/components/builder/SkillCreateWizard.svelte";
    import AgentCreateWizard from "$lib/components/builder/AgentCreateWizard.svelte";
    import AgentRegistry from "$lib/components/builder/AgentRegistry.svelte";
    import * as m from '$lib/paraglide/messages';
    import { type RegistryAgent } from "$lib/state/builder";
    import TabBar from "./_builder-hub/TabBar.svelte";
    import ToolsGrid from "./_builder-hub/ToolsGrid.svelte";
    import SkillsGrid from "./_builder-hub/SkillsGrid.svelte";
    import AgentsGrid from "./_builder-hub/AgentsGrid.svelte";
    import EmptyCard from "./_builder-hub/EmptyCard.svelte";
    import RegistryAgentSheet from "./_builder-hub/RegistryAgentSheet.svelte";
    import DeleteConfirmModal from "./_builder-hub/DeleteConfirmModal.svelte";
    import { toolDescription, type UnifiedTool } from "./_builder-hub/utils";
    import { fetchJson } from '$lib/api/fetch-json';
    import { toastError } from '$lib/state/ui/toast.svelte';

    type TabId = "skills" | "agents" | "tools";

    interface Props {
        /** Restrict the hub to a single section, hiding the tab bar + page header. */
        only?: TabId;
    }

    let { only }: Props = $props();

    // ── Registry detail sheet ───────────────────────────────────────
    let selectedRegistryAgent = $state<RegistryAgent | null>(null);

    // Bounded scrolling ancestor for AgentRegistry's virtualizer (this div, not window).
    let scrollEl: HTMLDivElement | undefined = $state();

    const isAdmin = $derived(hubIsAdmin.value);

    // ── Creation wizards ────────────────────────────────────────────
    let showSkillWizard = $state(false);
    let showAgentWizard = $state(false);

    // ── Gateway tools ───────────────────────────────────────────────
    let gatewayTools = $state<ToolStatusEntry[]>([]);
    let gatewayToolsLoading = $state(false);
    let gatewayToolsError = $state<string | null>(null);
    let groupDescriptions = $state<Record<string, string>>({});

    async function loadGatewayTools() {
        if (!conn.connected) return;
        gatewayToolsLoading = true;
        gatewayToolsError = null;
        try {
            const report = (await sendRequest('tools.status', {})) as ToolsStatusReport;
            gatewayTools = report.tools;
            groupDescriptions = report.groupDescriptions ?? {};
            // Prime the chat-facing tool catalog cache so ChatBlocks' permission
            // badges don't need a second tools.status round-trip.
            const byId: Record<string, ToolStatusEntry> = {};
            for (const t of report.tools) byId[t.id] = t;
            toolCatalog.byId = byId;
            toolCatalog.groupDescriptions = groupDescriptions;
            toolCatalog.loaded = true;
        } catch (e) {
            gatewayToolsError = e instanceof Error ? e.message : 'Failed to load tools';
        } finally {
            gatewayToolsLoading = false;
        }
    }

    // Reload gateway tools when connection state changes (only relevant for the tools section)
    $effect(() => {
        if (only && only !== 'tools') return;
        if (conn.connected) {
            loadGatewayTools();
        } else {
            gatewayTools = [];
        }
    });

    // ── Delete confirmation ─────────────────────────────────────────
    let deleteTarget = $state<{ type: 'skill' | 'agent' | 'tool'; id: string; name: string } | null>(null);

    async function executeDelete() {
        if (!deleteTarget) return;
        const { type, id, name } = deleteTarget;
        const path = type === 'skill' ? 'skills' : type === 'agent' ? 'agents' : 'tools';
        try {
            await fetchJson<{ ok: boolean }>(`/api/builder/${path}/${id}`, { method: 'DELETE' });
        } catch (error) {
            toastError(m.common_error(), error instanceof Error ? error.message : m.common_retry());
            return;
        }
        posthog.capture('builder_item_deleted', { item_type: type, item_id: id, item_name: name });
        // Splice locally instead of re-fetching the entire list — only the
        // deleted card leaves the DOM; sibling cards keep their identity.
        if (type === 'skill') builderState.skills = builderState.skills.filter(s => s.id !== id);
        else if (type === 'agent') builderState.agents = builderState.agents.filter(a => a.id !== id);
        else builderState.tools = builderState.tools.filter(t => t.id !== id);
        deleteTarget = null;
    }

    interface TabDef {
        id: TabId;
        label: string;
        icon: typeof BookOpen;
        locked: boolean;
        newLabel: string;
        emptyTitle: string;
        emptyDescription: string;
    }

    const tabs = $derived<TabDef[]>([
        {
            id: "tools",
            label: m.builder_tabTools(),
            icon: Wrench,
            locked: false,
            newLabel: m.builder_newTool(),
            emptyTitle: conn.connected ? m.builder_noToolsYet() : m.builder_noCustomToolsYet(),
            emptyDescription: conn.connected
                ? m.builder_gatewayToolsDesc()
                : m.builder_noGatewayToolsDesc(),
        },
        {
            id: "skills",
            label: m.builder_tabSkills(),
            icon: BookOpen,
            locked: false,
            newLabel: m.builder_newSkill(),
            emptyTitle: m.builder_noSkillsYet(),
            emptyDescription: m.builder_noSkillsDesc(),
        },
        {
            id: "agents",
            label: m.builder_tabAgents(),
            icon: Bot,
            locked: false,
            newLabel: m.builder_newAgent(),
            emptyTitle: m.builder_noAgentsYet(),
            emptyDescription: m.builder_noAgentsDesc(),
        },
    ]);

    const STORAGE_KEY = 'builder:activeTab';

    function getInitialTab(): TabId {
        if (only) return only;
        if (typeof window !== 'undefined') {
            const stored = sessionStorage.getItem(STORAGE_KEY) as TabId | null;
            if (stored && ['skills', 'agents', 'tools'].includes(stored)) return stored;
        }
        return 'skills'; // safe default — always accessible
    }

    let activeTab: TabId = $state(getInitialTab());

    // Keep activeTab pinned when locked to a single section.
    $effect(() => {
        if (only) activeTab = only;
    });

    // Persist tab selection to sessionStorage (only in the full multi-tab hub)
    $effect(() => {
        if (!only && typeof window !== 'undefined') {
            sessionStorage.setItem(STORAGE_KEY, activeTab);
        }
    });

    const currentTab = $derived(tabs.find((t) => t.id === activeTab)!);

    // ── Unified tool list ────────────────────────────────────────────
    let customToolsLoading = $state(false);

    // Custom tools lead (they're the user's own work); gateway tools follow.
    const customUnified = $derived<UnifiedTool[]>(
        builderState.tools.map(t => ({
            id: t.id,
            name: t.name,
            description: t.description,
            source: 'custom' as const,
            status: t.status,
            scriptLang: t.scriptLang,
            updatedAt: t.updatedAt,
        })),
    );

    const gatewayUnified = $derived<UnifiedTool[]>(
        gatewayTools.map(t => ({
            id: t.id,
            name: t.id,
            description: toolDescription(t),
            source: 'gateway' as const,
            enabled: t.enabled,
            mcpExport: t.mcpExport,
            multi: t.multi,
            optional: t.optional,
            groups: t.groups,
            permission: t.permission,
            displayTitle: t.display?.title,
            emoji: t.display?.emoji,
        })),
    );

    const unifiedTools = $derived<UnifiedTool[]>([...customUnified, ...gatewayUnified]);

    onMount(async () => {
        if (!only || only === 'skills') loadBuiltSkills();
        if (!only || only === 'agents') loadBuiltAgents();
        if (!only || only === 'tools') {
            customToolsLoading = true;
            await loadBuiltTools();
            customToolsLoading = false;
        }
    });

    async function handleNewClick() {
        if (activeTab === 'skills') {
            showSkillWizard = true;
        } else if (activeTab === 'agents') {
            showAgentWizard = true;
        } else if (activeTab === 'tools') {
            // Create a tool directly and navigate to the IDE
            const res = await fetch('/api/builder/tools', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'Untitled Tool' }),
            });
            if (res.ok) {
                const { id } = await res.json();
                goto(`/tools/${id}`);
            }
        }
    }
</script>

<div class="flex-1 min-h-0 overflow-y-auto" bind:this={scrollEl}>
    <div class="max-w-4xl mx-auto px-6 py-8">
        {#if !only}
            <!-- Page Header -->
            <div class="mb-8">
                <h1 class="text-xl font-bold text-foreground tracking-tight">
                    {m.builder_pageTitle()}
                </h1>
                <p class="text-sm text-muted mt-1">
                    {m.builder_pageSubtitle()}
                </p>
            </div>

            <TabBar {tabs} {activeTab} onSelect={(id) => { activeTab = id; }} />
        {/if}

        <!-- Tab Content -->
        <div class={only ? '' : 'mt-6'}>
            <!-- Action Row -->
            <div class="flex items-center justify-between mb-6">
                <h2 class="text-sm font-semibold text-foreground">
                    {currentTab.label}
                </h2>
                {#if activeTab === 'tools' ? isAdmin : !currentTab.locked}
                    <Button variant="ghost" type="button" class="new-button" onclick={handleNewClick}>
                        <span>+ {currentTab.newLabel}</span>
                    </Button>
                {/if}
            </div>

            <!-- Loading State -->
            {#if (activeTab === 'tools' && (gatewayToolsLoading || customToolsLoading)) || ((activeTab === 'skills' || activeTab === 'agents') && builderState.loading)}
                <div class="loading-container">
                    <Loader2 size={24} class="loading-spinner" />
                    <span class="loading-text">{m.common_loading()}</span>
                </div>
            {:else if activeTab === 'tools' && unifiedTools.length > 0}
                {#if customUnified.length > 0}
                    <div class="tools-section-head">
                        <span class="tools-section-title">{m.builder_customToolsSection()}</span>
                        <span class="tools-section-count">{customUnified.length}</span>
                    </div>
                    <ToolsGrid
                        tools={customUnified}
                        {isAdmin}
                        {groupDescriptions}
                        onDeleteCustom={(id, name) => { deleteTarget = { type: 'tool', id, name }; }}
                    />
                {/if}
                {#if gatewayUnified.length > 0}
                    <div class="tools-section-head" class:mt={customUnified.length > 0}>
                        <span class="tools-section-title">{m.builder_gatewayToolsSection()}</span>
                        <span class="tools-section-count">{gatewayUnified.length}</span>
                    </div>
                    <ToolsGrid
                        tools={gatewayUnified}
                        {isAdmin}
                        {groupDescriptions}
                        onDeleteCustom={(id, name) => { deleteTarget = { type: 'tool', id, name }; }}
                    />
                {/if}
            {:else if activeTab === 'tools' && gatewayToolsError}
                <div class="error-banner">
                    {gatewayToolsError}
                </div>
            {:else if activeTab === 'skills' && builderState.skills.length > 0}
                <SkillsGrid onDelete={(id, name) => { deleteTarget = { type: 'skill', id, name }; }} />
            {:else if activeTab === 'agents' && builderState.agents.length > 0}
                <AgentsGrid onDelete={(id, name) => { deleteTarget = { type: 'agent', id, name }; }} />
            {:else}
                <EmptyCard
                    icon={currentTab.icon}
                    title={currentTab.emptyTitle}
                    description={currentTab.emptyDescription}
                    locked={currentTab.locked}
                    onClick={handleNewClick}
                />
            {/if}

            <!-- Agent Registry (catalog of 1,300+ agents) -->
            {#if activeTab === 'agents'}
                <AgentRegistry
                    onSelectAgent={(agent) => { selectedRegistryAgent = agent; }}
                    scrollContainer={scrollEl}
                />
            {/if}
        </div>
    </div>
</div>

{#if selectedRegistryAgent}
    <RegistryAgentSheet
        agent={selectedRegistryAgent}
        onClose={() => { selectedRegistryAgent = null; }}
    />
{/if}

{#if showSkillWizard}
    <SkillCreateWizard
        onComplete={(id) => { showSkillWizard = false; posthog.capture('skill_created', { skill_id: id }); goto(`/flow-editor/skills/${id}`); }}
        onClose={() => { showSkillWizard = false; }}
    />
{/if}

{#if showAgentWizard}
    <AgentCreateWizard
        onComplete={(id) => { showAgentWizard = false; posthog.capture('agent_created', { agent_id: id }); goto(`/agents/builder/${id}`); }}
        onClose={() => { showAgentWizard = false; }}
    />
{/if}

{#if deleteTarget}
    <DeleteConfirmModal
        type={deleteTarget.type}
        name={deleteTarget.name}
        onCancel={() => { deleteTarget = null; }}
        onConfirm={executeDelete}
    />
{/if}

<style>
    /* ── Tools section headers ───────────────────────────────────────── */
    .tools-section-head {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        margin-bottom: var(--space-3);
    }

    .tools-section-head.mt {
        margin-top: var(--space-8);
    }

    .tools-section-title {
        font-size: var(--font-size-caption);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--color-muted);
    }

    .tools-section-count {
        font-size: var(--font-size-telemetry);
        font-weight: 600;
        color: var(--color-muted);
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-full);
        padding: var(--space-0-5) var(--space-2);
    }

    /* ── New Button ──────────────────────────────────────────────────── */
    :global(.new-button) {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-md);
        font-size: var(--font-size-caption);
        font-weight: 600;
        color: white;
        background: var(--color-accent);
        border: none;
        cursor: pointer;
        transition: all var(--duration-fast) var(--ease-standard);
        font-family: inherit;
    }

    :global(.new-button:hover) {
        filter: brightness(1.1);
    }

    /* ── Loading State ──────────────────────────────────────────────── */
    .loading-container {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
        padding: var(--space-12) 0;
    }

    :global(.loading-spinner) {
        color: var(--color-muted);
        animation: spin 1s linear infinite;
    }

    .loading-text {
        font-size: var(--font-size-body);
        color: var(--color-muted);
    }

    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    /* ── Error Banner ──────────────────────────────────────────────── */
    .error-banner {
        padding: var(--space-3) var(--space-4);
        border-radius: var(--radius-md);
        font-size: var(--font-size-caption);
        color: var(--color-danger-fg);
        background: var(--color-danger-surface);
        border: 1px solid var(--color-danger-border);
    }
</style>
