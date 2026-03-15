<script lang="ts">
    import AgentRow from "./AgentRow.svelte";
    import AgentGroupHeader from "./AgentGroupHeader.svelte";
    import GatewayInfo from "$lib/components/layout/GatewayInfo.svelte";
    import HudBorder from "$lib/components/decorations/HudBorder.svelte";
    import DotMatrix from "$lib/components/decorations/DotMatrix.svelte";
    import { gw, visibleAgents } from "$lib/state/gateway/gateway-data.svelte";
    import { conn } from "$lib/state/gateway/connection.svelte";
    import { ui } from "$lib/state/ui/ui.svelte";
    import { hostsState } from "$lib/state/features/hosts.svelte";
    import { wsConnect } from "$lib/services/gateway.svelte";
    import Skeleton from "$lib/components/ui/Skeleton.svelte";
    import { Bot, Radio, LayoutList, LayoutGrid, FolderPlus, ChevronDown, ChevronRight } from "lucide-svelte";
    import * as m from "$lib/paraglide/messages";
    import type { CollapseLevel } from '$lib/components/layout/Splitter.svelte';
    import {
        agentGroupsState,
        createAgentGroup,
        updateAgentGroup,
        deleteAgentGroup,
        moveAgentToGroup,
        toggleAgentViewMode,
        toggleGroupCollapsed,
        toggleUngroupedCollapsed,
    } from "$lib/state/features/agent-groups.svelte";
    import { builderState, loadBuiltAgents } from "$lib/state/builder/builder.svelte";
    import type { Agent } from "$lib/types/gateway";
    import { diceBearAvatarUrl } from "$lib/utils/avatar";
    import { goto } from "$app/navigation";
    import { onMount } from "svelte";

    interface Props {
        /** Collapse level from the parent Splitter */
        collapseLevel?: CollapseLevel;
    }

    let { collapseLevel = 'expanded' }: Props = $props();

    // Show minibar UI when in mini or collapsed state
    const collapsed = $derived(collapseLevel !== 'expanded');

    onMount(() => {
        loadBuiltAgents();
    });

    type SidebarAgent = Agent & {
        source: 'gateway' | 'builder';
    };

    const ACCENT_COLORS = [
        "#3b82f6",
        "#22c55e",
        "#a855f7",
        "#ec4899",
        "#06b6d4",
        "#f59e0b",
        "#10b981",
        "#ef4444",
    ];

    const activityData = $derived(
        conn.connected
            ? Array.from({ length: 16 }, () => Math.random() * 0.8 + 0.2)
            : new Array(16).fill(0),
    );

    const gatewayAgents = $derived(visibleAgents.value);

    // Merge gateway + builder agents into unified list
    const builderAgentsMapped: SidebarAgent[] = $derived(
        builderState.agents.map((a) => ({
            id: `builder:${a.id}`,
            name: a.name,
            emoji: a.emoji || undefined,
            status: a.status,
            source: 'builder' as const,
        })),
    );

    const allAgents: SidebarAgent[] = $derived([
        ...gatewayAgents.map((a) => ({
            ...a,
            source: 'gateway' as const,
        })),
        ...builderAgentsMapped,
    ]);

    const agentCount = $derived(allAgents.length);
    const activeAgentCount = $derived(
        gatewayAgents.filter(
            (a) => a.status === "running" || a.status === "thinking",
        ).length,
    );

    // Agent grouping
    const groups = $derived(agentGroupsState.groups);
    const groupedAgentIds = $derived(
        new Set(groups.flatMap((g) => g.memberAgentIds)),
    );
    const ungroupedAgents = $derived(
        allAgents.filter((a) => !groupedAgentIds.has(a.id)),
    );

    let ungroupedDragOver = $state(false);
    let creatingGroup = $state(false);
    let newGroupName = $state("");
    let newGroupInput: HTMLInputElement | undefined = $state();

    function handleNewGroupSubmit() {
        const name = newGroupName.trim();
        if (name) createAgentGroup(name);
        newGroupName = "";
        creatingGroup = false;
    }

    function startCreatingGroup() {
        creatingGroup = true;
        requestAnimationFrame(() => newGroupInput?.focus());
    }

    function handleGroupDrop(groupId: string | null) {
        return (e: DragEvent) => {
            e.preventDefault();
            const raw = e.dataTransfer?.getData("application/agent-move");
            if (!raw) return;
            const { agentId, fromGroupId } = JSON.parse(raw);
            if (fromGroupId === groupId) return;
            moveAgentToGroup(agentId, fromGroupId, groupId);
        };
    }

    function handleGroupDragOver(e: DragEvent) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    }

    function selectAgent(agent: SidebarAgent) {
        if (agent.source === 'builder') {
            const builderId = agent.id.replace(/^builder:/, '');
            goto(`/builder/agents/${builderId}`);
        } else {
            ui.selectedAgentId = agent.id;
            ui.selectedSessionKey = `agent:${agent.id}:main`;
        }
    }

    function isSelected(agent: SidebarAgent): boolean {
        if (agent.source === 'builder') return false;
        return ui.selectedAgentId === agent.id;
    }

    function findAgent(agentId: string): SidebarAgent | undefined {
        return allAgents.find((a) => a.id === agentId);
    }
</script>

<HudBorder
    class="w-full h-full overflow-hidden border-r border-border bg-bg2 flex flex-col"
>
    <!-- Header -->
    {#if collapsed}
        <div
            class="px-2 py-3 border-b border-border shrink-0 flex flex-col items-center gap-2"
        >
            <Bot size={16} class="text-brand-pink" />
            <div
                class="w-2 h-2 rounded-full {conn.connected
                    ? 'bg-success shadow-[0_0_6px_var(--color-success)]'
                    : 'bg-destructive shadow-[0_0_6px_var(--color-destructive)]'}"
            ></div>
        </div>
    {:else}
        <div class="px-4 py-3 border-b border-border shrink-0">
            <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2">
                    <Bot size={16} class="text-brand-pink" />
                    <span
                        class="text-xs font-bold tracking-widest uppercase text-muted-foreground"
                        >{m.agent_title()}</span
                    >
                </div>
                <div class="flex items-center gap-1">
                    <button
                        class="flex items-center justify-center w-6 h-6 rounded-md transition-all duration-150 {agentGroupsState.viewMode === 'list'
                            ? 'bg-accent/10 text-accent'
                            : 'text-muted-foreground hover:text-foreground'}"
                        onclick={toggleAgentViewMode}
                        title={agentGroupsState.viewMode === 'list' ? m.agentGroup_galleryView() : m.agentGroup_listView()}
                    >
                        {#if agentGroupsState.viewMode === 'list'}
                            <LayoutList size={13} />
                        {:else}
                            <LayoutGrid size={13} />
                        {/if}
                    </button>
                    <button
                        class="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:text-accent transition-all duration-150"
                        onclick={startCreatingGroup}
                        title={m.agentGroup_newGroup()}
                    >
                        <FolderPlus size={13} />
                    </button>
                </div>
            </div>

            <!-- Stats row -->
            {#if conn.connected}
                <div
                    class="flex items-center gap-3 text-[10px] text-muted-foreground"
                >
                    <div class="flex items-center gap-1.5">
                        <span class="w-1.5 h-1.5 rounded-full bg-success"
                        ></span>
                        <span
                            >{m.agent_statusActive({
                                count: activeAgentCount,
                            })}</span
                        >
                    </div>
                    <div class="flex items-center gap-1.5">
                        <span
                            class="w-1.5 h-1.5 rounded-full bg-muted-foreground/50"
                        ></span>
                        <span
                            >{m.sidebar_totalCount({ count: agentCount })}</span
                        >
                    </div>
                </div>
            {/if}
        </div>
    {/if}

    <!-- Agent list -->
    <div class="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
        {#if !conn.connected && builderAgentsMapped.length === 0}
            {#if conn.connecting && !collapsed}
                <!-- Skeleton loading rows while connecting -->
                <div class="py-2 px-2.5 flex flex-col gap-1">
                    {#each Array(5) as _}
                        <div class="flex items-center gap-2.5 px-2 py-2.5 rounded-lg">
                            <Skeleton width="28px" height="28px" rounded="rounded-full" />
                            <div class="flex-1 flex flex-col gap-1.5">
                                <Skeleton width="60%" height="10px" />
                                <Skeleton width="35%" height="8px" />
                            </div>
                        </div>
                    {/each}
                </div>
            {:else}
                <div class="px-2 py-4 text-center">
                    {#if collapsed}
                        <div
                            class="flex flex-col items-center text-muted-foreground/50"
                        >
                            <Radio size={16} />
                        </div>
                    {:else}
                        <div
                            class="flex flex-col items-center gap-3 text-muted-foreground"
                        >
                            <div
                                class="w-10 h-10 rounded-full bg-bg3 flex items-center justify-center"
                            >
                                <Radio size={18} class="opacity-50" />
                            </div>
                            <div class="text-xs">
                                {conn.connecting
                                    ? m.conn_connecting()
                                    : m.conn_notConnected()}
                            </div>
                            {#if !conn.connecting}
                                {#if hostsState.activeHostId}
                                    <button
                                        class="text-[10px] px-3 py-1.5 rounded-full bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
                                        onclick={() => wsConnect()}
                                    >
                                        {m.sidebar_reconnect()}
                                    </button>
                                {:else}
                                    <button
                                        class="text-[10px] px-3 py-1.5 rounded-full bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
                                        onclick={() => (ui.overlayOpen = true)}
                                    >
                                        {m.sidebar_connectToHost()}
                                    </button>
                                {/if}
                            {/if}
                        </div>
                    {/if}
                </div>
            {/if}
        {:else if allAgents.length === 0}
            <div class="px-2 py-4 text-center">
                {#if collapsed}
                    <div
                        class="flex flex-col items-center text-muted-foreground/50"
                    >
                        <Bot size={18} />
                    </div>
                {:else}
                    <div
                        class="flex flex-col items-center gap-3 text-muted-foreground"
                    >
                        <div
                            class="w-10 h-10 rounded-full bg-bg3 flex items-center justify-center"
                        >
                            <Bot size={20} class="opacity-50" />
                        </div>
                        <div class="text-xs">{m.agent_noAgents()}</div>
                    </div>
                {/if}
            </div>
        {:else}
            <div class="py-1">
                <!-- New group inline input -->
                {#if creatingGroup && !collapsed}
                    <div class="px-2.5 py-1.5 border-b border-border/50">
                        <input
                            bind:this={newGroupInput}
                            bind:value={newGroupName}
                            class="w-full text-[11px] font-semibold uppercase tracking-wider bg-transparent border-b border-accent/50 text-foreground outline-none px-0 py-0.5"
                            placeholder={m.agentGroup_newGroup()}
                            onblur={handleNewGroupSubmit}
                            onkeydown={(e) => {
                                if (e.key === 'Enter') handleNewGroupSubmit();
                                if (e.key === 'Escape') { creatingGroup = false; newGroupName = ''; }
                            }}
                        />
                    </div>
                {/if}

                {#if agentGroupsState.viewMode === 'list' || collapsed}
                    <!-- LIST VIEW -->
                    {#each groups as group, gi (group.id)}
                        {#if !collapsed}
                            <AgentGroupHeader
                                {group}
                                collapsed={agentGroupsState.collapsedGroupIds.has(group.id)}
                                onToggle={() => toggleGroupCollapsed(group.id)}
                                onRename={(name) => updateAgentGroup(group.id, { name })}
                                onDelete={() => deleteAgentGroup(group.id)}
                                onDrop={handleGroupDrop(group.id)}
                                onDragOver={handleGroupDragOver}
                                onDragLeave={() => {}}
                            />
                        {/if}

                        {#if !agentGroupsState.collapsedGroupIds.has(group.id)}
                            {#each group.memberAgentIds as agentId, ai (agentId)}
                                {@const agent = findAgent(agentId)}
                                {#if agent}
                                    <AgentRow
                                        {agent}
                                        selected={isSelected(agent)}
                                        accentColor={ACCENT_COLORS[(gi * 3 + ai) % ACCENT_COLORS.length]}
                                        compact={collapsed}
                                        groupId={group.id}
                                        onclick={() => selectAgent(agent)}
                                    />
                                {/if}
                            {/each}
                        {/if}
                    {/each}

                    <!-- Ungrouped agents -->
                    {#if ungroupedAgents.length > 0}
                        {#if groups.length > 0 && !collapsed}
                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                            <div
                                class="flex items-center gap-1.5 px-2.5 py-1.5 cursor-pointer select-none border-b border-border/50 transition-colors {ungroupedDragOver ? 'bg-accent/10 border-accent/30' : 'hover:bg-white/3'}"
                                onclick={toggleUngroupedCollapsed}
                                ondragover={(e) => { handleGroupDragOver(e); ungroupedDragOver = true; }}
                                ondragleave={() => { ungroupedDragOver = false; }}
                                ondrop={(e) => { ungroupedDragOver = false; handleGroupDrop(null)(e); }}
                                role="button"
                                tabindex="0"
                                onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleUngroupedCollapsed(); }}
                            >
                                <span class="text-muted-foreground shrink-0">
                                    {#if agentGroupsState.ungroupedCollapsed}
                                        <ChevronRight size={12} />
                                    {:else}
                                        <ChevronDown size={12} />
                                    {/if}
                                </span>
                                <span class="flex-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50 truncate">
                                    {m.agentGroup_ungrouped()}
                                </span>
                                <span class="text-[9px] text-muted-foreground/50 tabular-nums shrink-0">
                                    {ungroupedAgents.length}
                                </span>
                            </div>
                        {/if}
                        {#if !agentGroupsState.ungroupedCollapsed || groups.length === 0}
                            {#each ungroupedAgents as agent, i (agent.id)}
                                <AgentRow
                                    {agent}
                                    selected={isSelected(agent)}
                                    accentColor={ACCENT_COLORS[i % ACCENT_COLORS.length]}
                                    compact={collapsed}
                                    groupId={null}
                                    onclick={() => selectAgent(agent)}
                                />
                            {/each}
                        {/if}
                    {/if}
                {:else}
                    <!-- GALLERY VIEW -->
                    {#each groups as group (group.id)}
                        <div class="px-2.5 pt-2 pb-1">
                            <div class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-1.5">
                                {group.name}
                            </div>
                            <div
                                class="flex flex-wrap gap-1.5"
                                ondragover={handleGroupDragOver}
                                ondrop={handleGroupDrop(group.id)}
                                role="group"
                            >
                                {#each group.memberAgentIds as agentId (agentId)}
                                    {@const agent = findAgent(agentId)}
                                    {#if agent}
                                        <button
                                            class="w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-150 cursor-pointer border {isSelected(agent)
                                                ? 'bg-bg3 border-accent/50'
                                                : 'bg-bg2 border-border hover:border-muted hover:bg-bg3'}"
                                            draggable="true"
                                            ondragstart={(e) => {
                                                e.dataTransfer?.setData('application/agent-move', JSON.stringify({ agentId: agent.id, fromGroupId: group.id }));
                                                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                                            }}
                                            onclick={() => selectAgent(agent)}
                                            title={agent.name ?? agent.id}
                                        >
                                            {#if agent.emoji}
                                                <span class="text-base leading-none">{agent.emoji}</span>
                                            {:else}
                                                <img src={diceBearAvatarUrl(agent.name ?? agent.id)} alt="" class="w-6 h-6 rounded-full" />
                                            {/if}
                                        </button>
                                    {/if}
                                {/each}
                            </div>
                        </div>
                    {/each}

                    {#if ungroupedAgents.length > 0}
                        {#if groups.length > 0}
                            <div class="px-2.5 pt-2 pb-1">
                                <div class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-1.5">
                                    {m.agentGroup_ungrouped()}
                                </div>
                            </div>
                        {/if}
                        <div
                            class="px-2.5 pb-2 flex flex-wrap gap-1.5"
                            ondragover={handleGroupDragOver}
                            ondrop={handleGroupDrop(null)}
                            role="group"
                        >
                            {#each ungroupedAgents as agent (agent.id)}
                                <button
                                    class="w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-150 cursor-pointer border {isSelected(agent)
                                        ? 'bg-bg3 border-accent/50'
                                        : 'bg-bg2 border-border hover:border-muted hover:bg-bg3'}"
                                    draggable="true"
                                    ondragstart={(e) => {
                                        e.dataTransfer?.setData('application/agent-move', JSON.stringify({ agentId: agent.id, fromGroupId: null }));
                                        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                                    }}
                                    onclick={() => selectAgent(agent)}
                                    title={agent.name ?? agent.id}
                                >
                                    {#if agent.emoji}
                                        <span class="text-base leading-none">{agent.emoji}</span>
                                    {:else}
                                        <img src={diceBearAvatarUrl(agent.name ?? agent.id)} alt="" class="w-6 h-6 rounded-full" />
                                    {/if}
                                </button>
                            {/each}
                        </div>
                    {/if}
                {/if}
            </div>
        {/if}
    </div>

    <!-- Footer -->
    {#if collapsed}
        <div
            class="shrink-0 px-2 py-3 border-t border-border flex flex-col items-center gap-2"
        >
            <div
                class="w-2 h-2 rounded-full {conn.connected
                    ? 'bg-success shadow-[0_0_6px_var(--color-success)]'
                    : 'bg-destructive shadow-[0_0_6px_var(--color-destructive)]'}"
            ></div>
            {#if conn.connected && activeAgentCount > 0}
                <div
                    class="w-1.5 h-1.5 rounded-full bg-accent animate-pulse"
                ></div>
            {/if}
        </div>
    {:else}
        <div
            class="shrink-0 px-3 py-3 border-t border-border flex flex-col gap-3"
        >
            <GatewayInfo />
            <div class="flex items-center justify-center py-1">
                <DotMatrix data={activityData} cols={8} />
            </div>
        </div>
    {/if}
</HudBorder>
