<script lang="ts">
    import AgentRow from "./AgentRow.svelte";
    import GatewayInfo from "./GatewayInfo.svelte";
    import HudBorder from "$lib/components/decorations/HudBorder.svelte";
    import DotMatrix from "$lib/components/decorations/DotMatrix.svelte";
    import { gw } from "$lib/state/gateway-data.svelte";
    import { conn } from "$lib/state/connection.svelte";
    import { ui } from "$lib/state/ui.svelte";
    import AddAgentModal from "./AddAgentModal.svelte";
    import { Plus, ChevronLeft, ChevronRight, Bot, Radio } from "lucide-svelte";
    import * as m from "$lib/paraglide/messages";

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

    const collapsed = $derived(ui.sidebarCollapsed);

    function toggleCollapse() {
        ui.sidebarCollapsed = !ui.sidebarCollapsed;
    }

    const agentCount = $derived(gw.agents.length);
    const activeAgentCount = $derived(
        gw.agents.filter(
            (a) => a.status === "running" || a.status === "thinking",
        ).length,
    );
</script>

<HudBorder
    class="{collapsed
        ? 'w-[60px]'
        : 'w-[280px]'} shrink-0 overflow-hidden border-r border-border bg-bg2 flex flex-col transition-[width] duration-200 ease-out"
>
    <!-- Header -->
    {#if collapsed}
        <div
            class="px-2 py-3 border-b border-border shrink-0 flex flex-col items-center gap-2"
        >
            <button
                class="flex items-center justify-center w-8 h-8 rounded-lg border border-border bg-transparent text-muted-foreground hover:text-foreground hover:border-muted hover:bg-bg3 transition-all duration-150"
                onclick={toggleCollapse}
                aria-label={m.sidebar_expand()}
                title={m.sidebar_expand()}
            >
                <ChevronRight size={14} />
            </button>
            <button
                class="flex items-center justify-center w-8 h-8 rounded-lg border border-border bg-transparent text-muted-foreground hover:text-accent hover:border-accent/50 transition-all duration-150"
                onclick={() => {
                    ui.agentAddOpen = true;
                }}
                aria-label={m.agent_addLabel()}
                title={m.agent_addLabel()}
            >
                <Plus size={16} />
            </button>
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
                        class="flex items-center justify-center w-7 h-7 rounded-md border border-border bg-transparent text-muted-foreground hover:text-accent hover:border-accent/50 transition-all duration-150"
                        onclick={() => {
                            ui.agentAddOpen = true;
                        }}
                        aria-label={m.agent_addLabel()}
                        title={m.agent_addLabel()}
                    >
                        <Plus size={14} />
                    </button>
                    <button
                        class="flex items-center justify-center w-7 h-7 rounded-md border border-border bg-transparent text-muted-foreground hover:text-foreground hover:border-muted hover:bg-bg3 transition-all duration-150"
                        onclick={toggleCollapse}
                        aria-label={m.sidebar_collapse()}
                        title={m.sidebar_collapse()}
                    >
                        <ChevronLeft size={14} />
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
                        <span>{m.agent_statusActive({ count: activeAgentCount })}</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                        <span
                            class="w-1.5 h-1.5 rounded-full bg-muted-foreground/50"
                        ></span>
                        <span>{m.sidebar_totalCount({ count: agentCount })}</span>
                    </div>
                </div>
            {/if}
        </div>
    {/if}

    <!-- Agent list -->
    <div class="flex-1 overflow-y-auto min-h-0">
        {#if !conn.connected}
            <div class="py-8 px-3 text-center">
                {#if collapsed}
                    <div
                        class="flex flex-col items-center gap-2 text-muted-foreground/50"
                    >
                        <Radio size={16} />
                        <span class="text-[9px] rotate-90 whitespace-nowrap"
                            >{m.sidebar_offline()}</span
                        >
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
                            <button
                                class="text-[10px] px-3 py-1.5 rounded-full bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
                                onclick={() => (ui.overlayOpen = true)}
                            >
                                {m.sidebar_connectToHost()}
                            </button>
                        {/if}
                    </div>
                {/if}
            </div>
        {:else if gw.agents.length === 0}
            <div class="py-8 px-3 text-center">
                {#if collapsed}
                    <div
                        class="flex flex-col items-center gap-2 text-muted-foreground/50"
                    >
                        <Bot size={18} />
                        <span class="text-[9px]">0</span>
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
                        <button
                            class="text-[10px] px-3 py-1.5 rounded-full bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
                            onclick={() => (ui.agentAddOpen = true)}
                        >
                            {m.sidebar_createFirstAgent()}
                        </button>
                    </div>
                {/if}
            </div>
        {:else}
            <div class="py-1">
                {#each gw.agents as agent, i (agent.id)}
                    <AgentRow
                        {agent}
                        selected={ui.selectedAgentId === agent.id}
                        accentColor={ACCENT_COLORS[i % ACCENT_COLORS.length]}
                        compact={collapsed}
                        onclick={() => {
                            ui.selectedAgentId = agent.id;
                            ui.selectedSessionKey = `agent:${agent.id}:main`;
                        }}
                    />
                {/each}
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

{#if ui.agentAddOpen}
    <AddAgentModal />
{/if}
