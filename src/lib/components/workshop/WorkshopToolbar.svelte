<script lang="ts">
    import { gw } from "$lib/state/gateway-data.svelte";
    import WorkshopAgentPill from "./WorkshopAgentPill.svelte";
    import * as m from "$lib/paraglide/messages";
    import {
        saveSync,
        workshopState,
        toggleViewMode,
    } from "$lib/state/workshop.svelte";
    import { Grid3X3, Box } from "lucide-svelte";

    import type { ElementType } from "$lib/state/workshop.svelte";

    const elementTypes = $derived([
        { type: "pinboard" as ElementType, icon: "\u{1F4CC}", label: m.workshop_pinboard() },
        { type: "messageboard" as ElementType, icon: "\u{1F4CB}", label: m.workshop_messageboard() },
        { type: "inbox" as ElementType, icon: "\u{1F4EC}", label: m.workshop_inbox() },
        { type: "rulebook" as ElementType, icon: "\u{1F4D6}", label: m.workshop_rulebook() },
    ]);

    function onDragStart(
        e: DragEvent,
        agent: {
            id: string;
            name?: string;
            emoji?: string;
            description?: string;
        },
    ) {
        e.dataTransfer?.setData(
            "application/workshop-agent",
            JSON.stringify(agent),
        );
        e.dataTransfer!.effectAllowed = "copy";
    }

    function onElementDragStart(
        e: DragEvent,
        type: ElementType,
        label: string,
    ) {
        e.dataTransfer?.setData(
            "application/workshop-element",
            JSON.stringify({ type, label }),
        );
        e.dataTransfer!.effectAllowed = "copy";
    }

    const isHabboMode = $derived(workshopState.settings.viewMode === "habbo");
</script>

<div
    class="h-12 border-b border-border bg-bg2/80 backdrop-blur flex items-center px-3 gap-2 relative z-40"
>
    <!-- Left label -->
    <span
        class="font-mono text-[10px] uppercase tracking-widest text-muted shrink-0 select-none"
    >
        {m.workshop_title()}
    </span>

    <div class="w-px h-6 bg-border shrink-0"></div>

    <!-- Agent list (scrollable) -->
    <div
        class="flex-1 overflow-x-auto flex items-center gap-2 min-w-0 scrollbar-thin"
    >
        {#each gw.agents as agent (agent.id)}
            <WorkshopAgentPill
                {agent}
                onDragStart={(e) => onDragStart(e, agent)}
            />
        {:else}
            <span class="text-[10px] font-mono text-muted italic"
                >{m.workshop_noAgents()}</span
            >
        {/each}
    </div>

    <div class="w-px h-6 bg-border shrink-0"></div>

    <!-- Element buttons -->
    <div class="flex items-center gap-1 shrink-0">
        <span
            class="font-mono text-[9px] uppercase tracking-widest text-muted/60 mr-0.5 select-none"
            >{m.workshop_elemLabel()}</span
        >
        {#each elementTypes as et (et.type)}
            <button
                type="button"
                class="w-8 h-8 rounded border border-border bg-bg3 shrink-0 flex items-center justify-center cursor-grab active:cursor-grabbing hover:border-accent transition-colors text-sm"
                draggable="true"
                ondragstart={(e) => onElementDragStart(e, et.type, et.label)}
                title={et.label}
            >
                {et.icon}
            </button>
        {/each}
    </div>

    <div class="w-px h-6 bg-border shrink-0"></div>

    <!-- View Mode Toggle -->
    <button
        type="button"
        onclick={toggleViewMode}
        class="flex items-center gap-1.5 px-2.5 h-8 rounded border transition-all duration-200 shrink-0
      {isHabboMode
            ? 'border-accent/50 bg-accent/10 text-accent'
            : 'border-border bg-bg3 text-muted hover:text-foreground hover:border-muted-foreground'}"
        title={isHabboMode ? m.workshop_switchToClassic() : m.workshop_switchToHabbo()}
    >
        {#if isHabboMode}
            <Box size={14} />
            <span class="text-[10px] font-medium hidden sm:inline">{m.workshop_viewHabbo()}</span>
        {:else}
            <Grid3X3 size={14} />
            <span class="text-[10px] font-medium hidden sm:inline">{m.workshop_viewClassic()}</span>
        {/if}
    </button>

    <div class="w-px h-6 bg-border shrink-0"></div>

    <!-- Syncing indicator + Gallery link -->
    <div class="flex items-center gap-2 shrink-0">
        {#if saveSync.isSyncing}
            <span class="text-[9px] font-mono text-muted/60 animate-pulse"
                >{m.workshop_syncing()}</span
            >
        {/if}
        <a
            href="/workshop"
            class="h-7 px-2.5 text-[10px] font-mono uppercase tracking-wider rounded border border-border text-muted hover:bg-bg3 hover:text-foreground transition-colors flex items-center gap-1"
        >
            ↩ {m.workshop_gallery()}
        </a>
    </div>
</div>
