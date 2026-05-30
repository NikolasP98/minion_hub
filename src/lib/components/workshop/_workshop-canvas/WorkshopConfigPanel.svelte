<script lang="ts">
    import { workshopState } from "$lib/state/workshop/workshop.svelte";
    import ToggleSwitch from "$lib/components/config/ToggleSwitch.svelte";
    import * as m from "$lib/paraglide/messages";

    interface Props {
        configOpen: boolean;
        onToggleOpen: () => void;
        perfFps: number;
        perfFrameMs: number;
        perfHeapMB: number | null;
        showChatRopes: boolean;
        onToggleChatRopes: () => void;
        showRelationshipRopes: boolean;
        onToggleRelationshipRopes: () => void;
        debugMode: boolean;
        onToggleDebugMode: (v: boolean) => void;
    }

    let {
        configOpen,
        onToggleOpen,
        perfFps,
        perfFrameMs,
        perfHeapMB,
        showChatRopes,
        onToggleChatRopes,
        showRelationshipRopes,
        onToggleRelationshipRopes,
        debugMode,
        onToggleDebugMode,
    }: Props = $props();
</script>

<div class="absolute bottom-3 left-3 z-40 flex flex-col items-start gap-0">
    {#if configOpen}
        {@const agentCount = Object.keys(workshopState.agents).length}
        {@const elementCount = Object.keys(workshopState.elements).length}
        {@const activeConvs = Object.values(
            workshopState.conversations,
        ).filter((c) => c.status === "active").length}
        {@const totalConvs = Object.keys(workshopState.conversations).length}
        <div
            class="mb-0 rounded-t bg-bg2/90 backdrop-blur border border-b-0 border-border text-[8px] font-mono p-1.5 min-w-[130px] space-y-0.5"
        >
            <!-- Stats: perf -->
            <div
                class="text-[7px] text-muted-strong uppercase tracking-wider mb-1"
            >
                {m.workshop_configPerf()}
            </div>
            <div class="flex justify-between gap-3">
                <span class="text-muted-strong">{m.workshop_configFps()}</span>
                <span
                    class="tabular-nums font-semibold {perfFps >= 50
                        ? 'text-green-400'
                        : perfFps >= 30
                          ? 'text-yellow-400'
                          : 'text-red-400'}">{perfFps}</span
                >
            </div>
            <div class="flex justify-between gap-3">
                <span class="text-muted-strong">{m.workshop_configFrame()}</span>
                <span class="text-foreground/80 tabular-nums"
                    >{perfFrameMs}ms</span
                >
            </div>
            {#if perfHeapMB !== null}
                <div class="flex justify-between gap-3">
                    <span class="text-muted-strong">{m.workshop_configHeap()}</span>
                    <span class="text-foreground/80 tabular-nums"
                        >{perfHeapMB} MB</span
                    >
                </div>
            {/if}

            <!-- Stats: scene -->
            <div class="border-t border-border/30 mt-1 pt-1 space-y-0.5">
                <div
                    class="text-[7px] text-muted-strong uppercase tracking-wider mb-0.5"
                >
                    {m.workshop_configScene()}
                </div>
                <div class="flex justify-between gap-3">
                    <span class="text-muted-strong">{m.workshop_configAgents()}</span>
                    <span class="text-foreground/80 tabular-nums"
                        >{agentCount}</span
                    >
                </div>
                <div class="flex justify-between gap-3">
                    <span class="text-muted-strong">{m.workshop_configElements()}</span>
                    <span class="text-foreground/80 tabular-nums"
                        >{elementCount}</span
                    >
                </div>
                <div class="flex justify-between gap-3">
                    <span class="text-muted-strong">{m.workshop_configConvs()}</span>
                    <span class="text-foreground/80 tabular-nums">
                        <span class="text-green-400">{activeConvs}</span
                        >/{totalConvs}
                    </span>
                </div>
            </div>

            <!-- Ropes -->
            <div class="border-t border-border/30 mt-1 pt-1">
                <div
                    class="text-[7px] text-muted-strong uppercase tracking-wider mb-1"
                >
                    {m.workshop_configRopes()}
                </div>
                <div class="flex rounded border border-border overflow-hidden">
                    <button
                        class="flex-1 px-2 py-0.5 text-[8px] transition-colors {showChatRopes
                            ? 'bg-accent/80 text-white'
                            : 'bg-bg3 text-muted hover:text-foreground'}"
                        onclick={onToggleChatRopes}
                    >
                        {m.workshop_configRopesChat()}
                    </button>
                    <button
                        class="flex-1 px-2 py-0.5 text-[8px] transition-colors {showRelationshipRopes
                            ? 'bg-accent/80 text-white'
                            : 'bg-bg3 text-muted hover:text-foreground'}"
                        onclick={onToggleRelationshipRopes}
                    >
                        {m.workshop_configRopesRelations()}
                    </button>
                </div>
            </div>

            <!-- Debug -->
            <div class="border-t border-border/30 mt-1 pt-1">
                <div class="flex items-center justify-between">
                    <span class="text-[7px] text-muted-strong uppercase tracking-wider"
                        >{m.workshop_configAgentDebug()}</span
                    >
                    <ToggleSwitch
                        id="workshop-debug"
                        checked={debugMode}
                        onchange={onToggleDebugMode}
                    />
                </div>
            </div>
        </div>
    {/if}
    <button
        class="flex items-center gap-1.5 px-2 py-1 text-[9px] font-mono text-muted hover:text-foreground transition-colors backdrop-blur border border-border bg-bg2/80 {configOpen
            ? 'rounded-b rounded-t-none w-full justify-center'
            : 'rounded'}"
        onclick={onToggleOpen}
    >
        {configOpen ? `⚙ ${m.workshop_config()}` : "⚙"}
    </button>
</div>
