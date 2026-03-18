<script lang="ts">
    import { BookOpen, Bot, Wrench, Lock, Loader2, Trash2, Wifi, WifiOff } from "lucide-svelte";
    import { goto } from "$app/navigation";
    import { onMount } from "svelte";
    import { builderState, loadBuiltSkills, loadBuiltAgents, loadBuiltTools, createSkill, createAgent } from "$lib/state/builder";
    import posthog from "posthog-js";
    import { isAdmin as hubIsAdmin } from "$lib/state/features/user.svelte";
    import { conn } from "$lib/state/gateway/connection.svelte";
    import { sendRequest } from "$lib/services/gateway.svelte";
    import type { ToolStatusEntry, ToolsStatusReport } from "$lib/types/tools";
    import SkillCreateWizard from "$lib/components/builder/SkillCreateWizard.svelte";
    import AgentCreateWizard from "$lib/components/builder/AgentCreateWizard.svelte";

    const isAdmin = $derived(hubIsAdmin.value);

    // ── Creation wizards ────────────────────────────────────────────
    let showSkillWizard = $state(false);
    let showAgentWizard = $state(false);

    // ── Gateway tools ───────────────────────────────────────────────
    let gatewayTools = $state<ToolStatusEntry[]>([]);
    let gatewayToolsLoading = $state(false);
    let gatewayToolsError = $state<string | null>(null);

    async function loadGatewayTools() {
        if (!conn.connected) return;
        gatewayToolsLoading = true;
        gatewayToolsError = null;
        try {
            const report = (await sendRequest('tools.status', {})) as ToolsStatusReport;
            gatewayTools = report.tools;
        } catch (e) {
            gatewayToolsError = e instanceof Error ? e.message : 'Failed to load tools';
        } finally {
            gatewayToolsLoading = false;
        }
    }

    // Reload gateway tools when connection state changes
    $effect(() => {
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
        await fetch(`/api/builder/${path}/${id}`, { method: 'DELETE' });
        posthog.capture('builder_item_deleted', { item_type: type, item_id: id, item_name: name });
        if (type === 'skill') await loadBuiltSkills();
        else if (type === 'agent') await loadBuiltAgents();
        else await loadBuiltTools();
        deleteTarget = null;
    }

    type TabId = "skills" | "agents" | "tools";

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
            label: "Tools",
            icon: Wrench,
            locked: false,
            newLabel: "New Tool",
            emptyTitle: conn.connected ? "No tools yet" : "No custom tools yet",
            emptyDescription: conn.connected
                ? "Gateway tools and custom tool scripts appear here"
                : "Connect to a gateway to see gateway tools, or create custom tool scripts",
        },
        {
            id: "skills",
            label: "Skills",
            icon: BookOpen,
            locked: false,
            newLabel: "New Skill",
            emptyTitle: "No skills yet",
            emptyDescription: "Create your first skill to extend agent capabilities",
        },
        {
            id: "agents",
            label: "Agents",
            icon: Bot,
            locked: false,
            newLabel: "New Agent",
            emptyTitle: "No agents yet",
            emptyDescription: "Build a custom agent with its own personality and tools",
        },
    ]);

    const STORAGE_KEY = 'builder:activeTab';

    function getInitialTab(): TabId {
        if (typeof window !== 'undefined') {
            const stored = sessionStorage.getItem(STORAGE_KEY) as TabId | null;
            if (stored && ['skills', 'agents', 'tools'].includes(stored)) return stored;
        }
        return 'skills'; // safe default — always accessible
    }

    let activeTab: TabId = $state(getInitialTab());

    // Persist tab selection to sessionStorage
    $effect(() => {
        if (typeof window !== 'undefined') {
            sessionStorage.setItem(STORAGE_KEY, activeTab);
        }
    });

    const currentTab = $derived(tabs.find((t) => t.id === activeTab)!);

    // ── Unified tool list ────────────────────────────────────────────
    let customToolsLoading = $state(false);

    interface UnifiedTool {
        id: string;
        name: string;
        description: string;
        source: 'gateway' | 'custom';
        enabled?: boolean;
        status?: string;
        scriptLang?: string;
        updatedAt?: number;
        // Gateway-specific
        mcpExport?: boolean;
        multi?: boolean;
        optional?: boolean;
        groups?: string[];
    }

    const unifiedTools = $derived<UnifiedTool[]>([
        ...gatewayTools.map(t => ({
            id: t.id,
            name: t.id,
            description: toolDescription(t),
            source: 'gateway' as const,
            enabled: t.enabled,
            mcpExport: t.mcpExport,
            multi: t.multi,
            optional: t.optional,
            groups: t.groups,
        })),
        ...builderState.tools.map(t => ({
            id: t.id,
            name: t.name,
            description: t.description,
            source: 'custom' as const,
            status: t.status,
            scriptLang: t.scriptLang,
            updatedAt: t.updatedAt,
        })),
    ]);

    onMount(async () => {
        loadBuiltSkills();
        loadBuiltAgents();
        customToolsLoading = true;
        await loadBuiltTools();
        customToolsLoading = false;
    });

    function formatRelativeTime(timestamp: number): string {
        const now = Date.now();
        const diff = now - timestamp;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `edited ${days}d ago`;
        if (hours > 0) return `edited ${hours}h ago`;
        if (minutes > 0) return `edited ${minutes}m ago`;
        return 'edited just now';
    }

    function toolEmoji(tool: { id: string; mcpExport?: boolean }): string {
        if (tool.mcpExport) return '🔌';
        const id = tool.id;
        if (id.includes('browser')) return '🌐';
        if (id.includes('web-search')) return '🔍';
        if (id.includes('web-fetch')) return '📡';
        if (id.includes('memory')) return '🧠';
        if (id.includes('image')) return '🖼️';
        if (id.includes('file') || id.includes('fs')) return '📁';
        if (id.includes('code') || id.includes('exec')) return '💻';
        if (id.includes('shell') || id.includes('bash')) return '🐚';
        if (id.includes('db') || id.includes('sql')) return '🗄️';
        if (id.includes('email') || id.includes('mail')) return '📧';
        if (id.includes('calendar')) return '📅';
        return '🔧';
    }

    function toolDescription(tool: { groups: string[]; requires?: { env?: string[] } }): string {
        const parts: string[] = [];
        if (tool.groups.length > 0) {
            parts.push(tool.groups.map(g => g.replace('group:', '')).join(', '));
        }
        if (tool.requires?.env?.length) {
            parts.push(`needs: ${tool.requires.env.join(', ')}`);
        }
        return parts.join(' · ') || 'Gateway tool';
    }

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
                goto(`/builder/tools/${id}`);
            }
        }
    }
</script>

<div class="flex-1 min-h-0 overflow-y-auto">
        <div class="max-w-4xl mx-auto px-6 py-8">
            <!-- Page Header -->
            <div class="mb-8">
                <h1 class="text-xl font-bold text-foreground tracking-tight">
                    Builder
                </h1>
                <p class="text-sm text-muted mt-1">
                    Create skills, agents, and tools
                </p>
            </div>

            <!-- Tab Bar -->
            <div class="tab-bar">
                {#each tabs as tab (tab.id)}
                    <button
                        type="button"
                        class="tab-pill {activeTab === tab.id ? 'active' : ''} {tab.locked ? 'locked' : ''}"
                        onclick={() => { if (!tab.locked) activeTab = tab.id; }}
                        disabled={tab.locked}
                    >
                        <tab.icon size={14} />
                        <span>{tab.label}</span>
                        {#if tab.locked}
                            <Lock size={11} class="lock-icon" />
                        {/if}
                    </button>
                {/each}
            </div>

            <!-- Tab Content -->
            <div class="mt-6">
                <!-- Action Row -->
                <div class="flex items-center justify-between mb-6">
                    <h2 class="text-sm font-semibold text-foreground">
                        {currentTab.label}
                    </h2>
                    {#if activeTab === 'tools' ? isAdmin : !currentTab.locked}
                        <button type="button" class="new-button" onclick={handleNewClick}>
                            <span>+ {currentTab.newLabel}</span>
                        </button>
                    {/if}
                </div>

                <!-- Loading State -->
                {#if (activeTab === 'tools' && (gatewayToolsLoading || customToolsLoading)) || ((activeTab === 'skills' || activeTab === 'agents') && builderState.loading)}
                    <div class="loading-container">
                        <Loader2 size={24} class="loading-spinner" />
                        <span class="loading-text">Loading...</span>
                    </div>
                {:else if activeTab === 'tools' && unifiedTools.length > 0}
                    <!-- Unified Tools Cards -->
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {#each unifiedTools as tool (tool.source + ':' + tool.id)}
                            <div class="item-card" role="button" tabindex="0" onclick={() => goto(`/builder/tools/${tool.id}`)} onkeydown={(e) => { if (e.key === 'Enter') goto(`/builder/tools/${tool.id}`); }}>
                                <div class="item-card-inner">
                                    <div class="item-card-header">
                                        {#if tool.source === 'gateway'}
                                            <span class="item-emoji">{toolEmoji(tool)}</span>
                                            <span class="item-name font-mono">{tool.id}</span>
                                        {:else}
                                            <span class="item-emoji">🔧</span>
                                            <span class="item-name">{tool.name}</span>
                                            {#if isAdmin}
                                                <button type="button" class="item-delete" onclick={(e) => { e.stopPropagation(); deleteTarget = { type: 'tool', id: tool.id, name: tool.name }; }} title="Delete tool">
                                                    <Trash2 size={12} />
                                                </button>
                                            {/if}
                                        {/if}
                                    </div>
                                    {#if tool.description}
                                        <span class="item-desc">{tool.description}</span>
                                    {/if}
                                    <div class="item-footer">
                                        {#if tool.source === 'gateway'}
                                            <span class="status-badge {tool.enabled ? 'published' : 'draft'}">
                                                {tool.enabled ? 'enabled' : 'disabled'}
                                            </span>
                                            {#if tool.mcpExport}
                                                <span class="tool-flag accent">MCP</span>
                                            {/if}
                                            {#if tool.multi}
                                                <span class="tool-flag">multi</span>
                                            {/if}
                                            {#if tool.optional}
                                                <span class="tool-flag">opt</span>
                                            {/if}
                                        {:else}
                                            <span class="status-badge {tool.status}">{tool.status}</span>
                                            {#if tool.scriptLang}
                                                <span class="tool-flag">{tool.scriptLang}</span>
                                            {/if}
                                            {#if tool.updatedAt}
                                                <span class="item-time">{formatRelativeTime(tool.updatedAt)}</span>
                                            {/if}
                                        {/if}
                                        <span class="source-chip {tool.source}">{tool.source}</span>
                                    </div>
                                </div>
                            </div>
                        {/each}
                    </div>
                {:else if activeTab === 'tools' && gatewayToolsError}
                    <div class="error-banner">
                        {gatewayToolsError}
                    </div>
                {:else if activeTab === 'skills' && builderState.skills.length > 0}
                    <!-- Skills Cards -->
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {#each builderState.skills as skill (skill.id)}
                            <div class="item-card" role="button" tabindex="0" onclick={() => goto(`/builder/skills/${skill.id}`)} onkeydown={(e) => { if (e.key === 'Enter') goto(`/builder/skills/${skill.id}`); }}>
                                <div class="item-card-inner">
                                    <div class="item-card-header">
                                        <span class="item-emoji">{skill.emoji || '📖'}</span>
                                        <span class="item-name">{skill.name}</span>
                                        <button type="button" class="item-delete" onclick={(e) => { e.stopPropagation(); deleteTarget = { type: 'skill', id: skill.id, name: skill.name }; }} title="Delete skill">
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                    {#if skill.description}
                                        <span class="item-desc">{skill.description}</span>
                                    {/if}
                                    <div class="item-footer">
                                        <span class="status-badge {skill.status}">{skill.status}</span>
                                        <span class="item-time">{formatRelativeTime(skill.updatedAt)}</span>
                                    </div>
                                </div>
                            </div>
                        {/each}
                    </div>
                {:else if activeTab === 'agents' && builderState.agents.length > 0}
                    <!-- Agent Cards -->
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {#each builderState.agents as agent (agent.id)}
                            <div class="item-card" role="button" tabindex="0" onclick={() => goto(`/builder/agents/${agent.id}`)} onkeydown={(e) => { if (e.key === 'Enter') goto(`/builder/agents/${agent.id}`); }}>
                                <div class="item-card-inner">
                                    <div class="item-card-header">
                                        <span class="item-emoji">{agent.emoji || '🤖'}</span>
                                        <span class="item-name">{agent.name}</span>
                                        <button type="button" class="item-delete" onclick={(e) => { e.stopPropagation(); deleteTarget = { type: 'agent', id: agent.id, name: agent.name }; }} title="Delete agent">
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                    {#if agent.description}
                                        <span class="item-desc">{agent.description}</span>
                                    {/if}
                                    <div class="item-footer">
                                        <span class="status-badge {agent.status}">{agent.status}</span>
                                        {#if agent.model}
                                            <span class="item-model">{agent.model}</span>
                                        {/if}
                                        <span class="item-time">{formatRelativeTime(agent.updatedAt)}</span>
                                    </div>
                                </div>
                            </div>
                        {/each}
                    </div>
                {:else}
                    <!-- Empty State Card Grid -->
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        <button
                            type="button"
                            class="empty-card"
                            disabled={currentTab.locked}
                            onclick={currentTab.locked ? undefined : handleNewClick}
                        >
                            <div class="empty-card-inner">
                                <currentTab.icon size={28} class="empty-icon" />
                                <p class="empty-title">{currentTab.emptyTitle}</p>
                                <p class="empty-desc">{currentTab.emptyDescription}</p>
                                {#if !currentTab.locked}
                                    <span class="empty-cta">+ Create</span>
                                {/if}
                            </div>
                        </button>
                    </div>
                {/if}
            </div>
        </div>
    </div>

{#if showSkillWizard}
    <SkillCreateWizard
        onComplete={(id) => { showSkillWizard = false; posthog.capture('skill_created', { skill_id: id }); goto(`/builder/skills/${id}`); }}
        onClose={() => { showSkillWizard = false; }}
    />
{/if}

{#if showAgentWizard}
    <AgentCreateWizard
        onComplete={(id) => { showAgentWizard = false; posthog.capture('agent_created', { agent_id: id }); goto(`/builder/agents/${id}`); }}
        onClose={() => { showAgentWizard = false; }}
    />
{/if}

{#if deleteTarget}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="confirm-overlay" role="dialog" aria-modal="true" onclick={(e) => { if (e.target === e.currentTarget) deleteTarget = null; }} onkeydown={(e) => { if (e.key === 'Escape') deleteTarget = null; }}>
        <div class="confirm-modal">
            <p class="confirm-title">Delete "{deleteTarget.name}"?</p>
            <p class="confirm-desc">This {deleteTarget.type} will be permanently removed.</p>
            <div class="confirm-actions">
                <button type="button" class="confirm-btn cancel" onclick={() => { deleteTarget = null; }}>Cancel</button>
                <button type="button" class="confirm-btn delete" onclick={executeDelete}>Delete</button>
            </div>
        </div>
    </div>
{/if}

<style>
    /* ── Tab Bar ──────────────────────────────────────────────────────── */
    .tab-bar {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.25rem;
        border-radius: 0.625rem;
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        width: fit-content;
    }

    .tab-pill {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.375rem 0.75rem;
        border-radius: 0.5rem;
        font-size: 0.8125rem;
        font-weight: 500;
        color: var(--color-muted);
        background: transparent;
        border: none;
        cursor: pointer;
        transition: all 0.15s ease;
        position: relative;
        font-family: inherit;
    }

    .tab-pill:hover:not(:disabled) {
        color: var(--color-foreground);
        background: var(--color-bg3);
    }

    .tab-pill.active {
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 12%, transparent);
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 25%, transparent);
    }

    .tab-pill.active::after {
        content: '';
        position: absolute;
        bottom: -1px;
        left: 25%;
        right: 25%;
        height: 2px;
        background: var(--color-accent);
        border-radius: 1px;
    }

    .tab-pill.locked {
        opacity: 0.5;
        cursor: not-allowed;
    }

    :global(.lock-icon) {
        opacity: 0.6;
    }

    /* ── New Button ──────────────────────────────────────────────────── */
    .new-button {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.375rem 0.75rem;
        border-radius: 0.5rem;
        font-size: 0.75rem;
        font-weight: 600;
        color: white;
        background: var(--color-accent);
        border: none;
        cursor: pointer;
        transition: all 0.15s ease;
        font-family: inherit;
    }

    .new-button:hover {
        filter: brightness(1.1);
    }

    /* ── Empty State Card ────────────────────────────────────────────── */
    .empty-card {
        display: flex;
        align-items: stretch;
        min-height: 10rem;
        border: 2px dashed var(--color-border);
        border-radius: 0.75rem;
        background: transparent;
        cursor: pointer;
        transition: all 0.2s ease;
        padding: 0;
        font-family: inherit;
        width: 100%;
        color: inherit;
    }

    .empty-card:hover:not(:disabled) {
        border-color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 4%, transparent);
    }

    .empty-card:disabled {
        cursor: not-allowed;
        opacity: 0.6;
    }

    .empty-card-inner {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        padding: 1.5rem;
        gap: 0.5rem;
    }

    :global(.empty-icon) {
        color: var(--color-muted);
        opacity: 0.5;
        margin-bottom: 0.25rem;
    }

    .empty-title {
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--color-foreground);
        margin: 0;
    }

    .empty-desc {
        font-size: 0.6875rem;
        color: var(--color-muted);
        text-align: center;
        line-height: 1.4;
        max-width: 18rem;
        margin: 0;
    }

    .empty-cta {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        margin-top: 0.5rem;
        font-size: 0.6875rem;
        font-weight: 600;
        color: var(--color-accent);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    /* ── Loading State ──────────────────────────────────────────────── */
    .loading-container {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        padding: 3rem 0;
    }

    :global(.loading-spinner) {
        color: var(--color-muted);
        animation: spin 1s linear infinite;
    }

    .loading-text {
        font-size: 0.8125rem;
        color: var(--color-muted);
    }

    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    /* ── Item Cards ─────────────────────────────────────────────────── */
    .item-card {
        display: flex;
        align-items: stretch;
        min-height: 7rem;
        border: 1px solid var(--color-border);
        border-radius: 0.75rem;
        background: var(--color-bg2);
        cursor: pointer;
        transition: all 0.15s ease;
        padding: 0;
        font-family: inherit;
        width: 100%;
        color: inherit;
        text-align: left;
    }

    .item-card:hover {
        background: var(--color-bg3);
        border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
    }

    .item-card-inner {
        display: flex;
        flex-direction: column;
        width: 100%;
        padding: 1rem 1.25rem;
        gap: 0.5rem;
    }

    .item-card-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .item-emoji {
        font-size: 1.125rem;
        line-height: 1;
    }

    .item-name {
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--color-foreground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .status-badge {
        display: inline-flex;
        align-items: center;
        width: fit-content;
        padding: 0.125rem 0.5rem;
        border-radius: 9999px;
        font-size: 0.625rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .status-badge.draft {
        background: color-mix(in srgb, var(--color-muted) 15%, transparent);
        color: var(--color-muted);
    }

    .status-badge.published {
        background: color-mix(in srgb, var(--color-accent) 15%, transparent);
        color: var(--color-accent);
    }

    .item-desc {
        font-size: 0.6875rem;
        color: var(--color-muted);
        line-height: 1.4;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
    }

    .item-footer {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-top: auto;
    }

    .item-time {
        font-size: 0.6875rem;
        color: var(--color-muted);
    }

    .item-model {
        font-size: 0.5625rem;
        font-family: var(--font-mono, monospace);
        color: var(--color-muted);
        background: var(--color-bg3);
        padding: 0.0625rem 0.375rem;
        border-radius: 0.25rem;
    }

    /* ── Tool Flags ────────────────────────────────────────────────── */
    .tool-flag {
        font-size: 0.5625rem;
        font-family: var(--font-mono, monospace);
        color: var(--color-muted);
        background: var(--color-bg3);
        padding: 0.0625rem 0.375rem;
        border-radius: 0.25rem;
        border: 1px solid var(--color-border);
    }

    .tool-flag.accent {
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 10%, transparent);
        border-color: color-mix(in srgb, var(--color-accent) 25%, transparent);
    }

    .font-mono {
        font-family: var(--font-mono, monospace);
    }

    /* ── Source Chip ──────────────────────────────────────────────── */
    .source-chip {
        font-size: 0.5625rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        padding: 0.0625rem 0.375rem;
        border-radius: 0.25rem;
        font-family: var(--font-mono, monospace);
        margin-left: auto;
    }

    .source-chip.gateway {
        color: var(--color-muted);
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
    }

    .source-chip.custom {
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 10%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-accent) 25%, transparent);
    }

    /* ── Error Banner ──────────────────────────────────────────────── */
    .error-banner {
        padding: 0.75rem 1rem;
        border-radius: 0.5rem;
        font-size: 0.75rem;
        color: var(--color-error, #ef4444);
        background: color-mix(in srgb, var(--color-error, #ef4444) 8%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-error, #ef4444) 25%, transparent);
    }

    .item-delete {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 1.25rem;
        height: 1.25rem;
        border-radius: 0.25rem;
        color: var(--color-muted);
        background: none;
        border: none;
        cursor: pointer;
        opacity: 0;
        transition: all 0.1s ease;
        margin-left: auto;
        flex-shrink: 0;
        font-family: inherit;
    }

    .item-card:hover .item-delete {
        opacity: 1;
    }

    .item-delete:hover {
        color: var(--color-error, #ef4444);
        background: color-mix(in srgb, var(--color-error, #ef4444) 12%, transparent);
    }

    /* ── Delete Confirmation Modal ─────────────────────────────────── */
    .confirm-overlay {
        position: fixed;
        inset: 0;
        z-index: 1100;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(2px);
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .confirm-modal {
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 0.75rem;
        padding: 1.25rem 1.5rem;
        max-width: 340px;
        width: 100%;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
    }

    .confirm-title {
        font-size: 0.875rem;
        font-weight: 700;
        color: var(--color-foreground);
        margin: 0 0 0.375rem;
    }

    .confirm-desc {
        font-size: 0.75rem;
        color: var(--color-muted);
        margin: 0 0 1rem;
        line-height: 1.4;
    }

    .confirm-actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
    }

    .confirm-btn {
        font-family: inherit;
        font-size: 0.75rem;
        font-weight: 600;
        padding: 0.375rem 0.875rem;
        border-radius: 0.375rem;
        cursor: pointer;
        transition: all 0.15s ease;
        border: none;
    }

    .confirm-btn.cancel {
        background: var(--color-bg2);
        color: var(--color-muted);
        border: 1px solid var(--color-border);
    }

    .confirm-btn.cancel:hover {
        color: var(--color-foreground);
        border-color: var(--color-foreground);
    }

    .confirm-btn.delete {
        background: var(--color-error, #ef4444);
        color: white;
    }

    .confirm-btn.delete:hover {
        filter: brightness(1.1);
    }
</style>
