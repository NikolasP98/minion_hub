<script lang="ts">
    import { gw } from "$lib/state/gateway/gateway-data.svelte";
    import { workshopState } from "$lib/state/workshop/workshop.svelte";
    import WorkshopAgentPill from "./WorkshopAgentPill.svelte";
    import * as m from "$lib/paraglide/messages";
    import {
        saveSync,
        setViewMode,
    } from "$lib/state/workshop/workshop.svelte";

    const viewModes = [
        { mode: "classic" as const, label: m.workshop_viewClassic() },
        { mode: "habbo" as const, label: m.workshop_viewHabbo() },
        { mode: "pixel" as const, label: m.workshop_viewPixel() },
    ];

    // Short clock label for the last successful save (e.g. "1:15 PM").
    const savedClock = $derived.by(() => {
        if (saveSync.lastSavedAt === null) return null;
        return new Date(saveSync.lastSavedAt).toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
        });
    });
    import ChevronLeft from "lucide-svelte/icons/chevron-left";
    import ChevronRight from "lucide-svelte/icons/chevron-right";
    import Undo2 from "lucide-svelte/icons/undo-2";
    import { undoState } from "$lib/state/workshop/workshop.svelte";

    import type { ElementType } from "$lib/state/workshop/workshop.svelte";

    function requestUndo() {
        window.dispatchEvent(new Event("workshop:undo"));
    }

    const elementTypes = $derived([
        { type: "pinboard" as ElementType, icon: "\u{1F4CC}", label: m.workshop_pinboard() },
        { type: "messageboard" as ElementType, icon: "\u{1F4CB}", label: m.workshop_messageboard() },
        { type: "inbox" as ElementType, icon: "\u{1F4EC}", label: m.workshop_inbox() },
        { type: "rulebook" as ElementType, icon: "\u{1F4D6}", label: m.workshop_rulebook() },
        { type: "portal" as ElementType, icon: "\u{1F300}", label: m.workshop_portal() },
    ]);

    // Count how many instances of each agentId are on canvas
    const instanceCounts = $derived.by(() => {
        const counts: Record<string, number> = {};
        for (const inst of Object.values(workshopState.agents)) {
            counts[inst.agentId] = (counts[inst.agentId] ?? 0) + 1;
        }
        return counts;
    });

    // Split gateway agents into "on canvas" vs "available"
    const onCanvasAgents = $derived(
        gw.agents.filter((a) => (instanceCounts[a.id] ?? 0) > 0)
    );
    const availableAgents = $derived(
        gw.agents.filter((a) => (instanceCounts[a.id] ?? 0) === 0)
    );

    // Scroll state
    let scrollEl = $state<HTMLDivElement | null>(null);
    let canScrollLeft = $state(false);
    let canScrollRight = $state(false);
    let scrollThumbLeft = $state(0);
    let scrollThumbWidth = $state(0);
    let hasOverflow = $state(false);

    function updateScrollState() {
        if (!scrollEl) return;
        const { scrollLeft, scrollWidth, clientWidth } = scrollEl;
        canScrollLeft = scrollLeft > 1;
        canScrollRight = scrollLeft + clientWidth < scrollWidth - 1;
        hasOverflow = scrollWidth > clientWidth + 1;
        if (hasOverflow) {
            const ratio = clientWidth / scrollWidth;
            scrollThumbWidth = Math.max(ratio * 100, 10);
            scrollThumbLeft = (scrollLeft / (scrollWidth - clientWidth)) * (100 - scrollThumbWidth);
        }
    }

    function scrollBy(delta: number) {
        scrollEl?.scrollBy({ left: delta, behavior: "smooth" });
    }

    function handleWheel(e: WheelEvent) {
        if (!scrollEl || !hasOverflow) return;
        // Convert vertical scroll to horizontal
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            e.preventDefault();
            scrollEl.scrollLeft += e.deltaY;
        }
    }

    // Re-evaluate scroll state when agents change or container resizes
    $effect(() => {
        // Touch reactive deps to re-run when agents change
        void gw.agents.length;
        void Object.keys(workshopState.agents).length;

        if (!scrollEl) return;
        updateScrollState();

        const ro = new ResizeObserver(() => updateScrollState());
        ro.observe(scrollEl);

        scrollEl.addEventListener("scroll", updateScrollState, { passive: true });
        const el = scrollEl;

        return () => {
            ro.disconnect();
            el.removeEventListener("scroll", updateScrollState);
        };
    });

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

    <!-- Agent list (custom scrollable) -->
    <div class="flex-1 flex flex-col min-w-0 relative">
        <div class="flex items-center">
            {#if canScrollLeft}
                <button
                    type="button"
                    class="shrink-0 w-5 h-9 flex items-center justify-center text-muted hover:text-foreground transition-colors"
                    onclick={() => scrollBy(-120)}
                >
                    <ChevronLeft size={14} />
                </button>
            {/if}

            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
                bind:this={scrollEl}
                onwheel={handleWheel}
                class="flex-1 overflow-hidden flex items-center gap-2 min-w-0"
            >
                {#if gw.agents.length === 0}
                    <span class="text-[10px] font-mono text-muted italic"
                        >{m.workshop_noAgents()}</span
                    >
                {:else}
                    {#if onCanvasAgents.length > 0}
                        {#each onCanvasAgents as agent (agent.id)}
                            <WorkshopAgentPill
                                {agent}
                                count={instanceCounts[agent.id]}
                                onDragStart={(e) => onDragStart(e, agent)}
                            />
                        {/each}
                    {/if}

                    {#if onCanvasAgents.length > 0 && availableAgents.length > 0}
                        <div class="w-px h-6 bg-border/50 shrink-0 mx-1"></div>
                    {/if}

                    {#if availableAgents.length > 0}
                        {#each availableAgents as agent (agent.id)}
                            <WorkshopAgentPill
                                {agent}
                                onDragStart={(e) => onDragStart(e, agent)}
                            />
                        {/each}
                    {/if}
                {/if}
            </div>

            {#if canScrollRight}
                <button
                    type="button"
                    class="shrink-0 w-5 h-9 flex items-center justify-center text-muted hover:text-foreground transition-colors"
                    onclick={() => scrollBy(120)}
                >
                    <ChevronRight size={14} />
                </button>
            {/if}
        </div>

        <!-- Scroll indicator -->
        {#if hasOverflow}
            <div class="absolute bottom-0 left-0 right-0 h-[2px]">
                <div
                    class="h-full rounded-full bg-muted/40 transition-all duration-100"
                    style="width: {scrollThumbWidth}%; margin-left: {scrollThumbLeft}%"
                ></div>
            </div>
        {/if}
    </div>

    <div class="w-px h-6 bg-border shrink-0"></div>

    <!-- Element buttons -->
    <div class="flex items-center gap-1 shrink-0">
        <span
            class="font-mono text-[9px] uppercase tracking-widest text-muted-strong mr-0.5 select-none"
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

    <!-- Undo (structural: add / delete / relationship) -->
    <button
        type="button"
        disabled={!undoState.canUndo}
        onclick={requestUndo}
        title="{m.workshop_undo()} (Ctrl+Z)"
        aria-label={m.workshop_undo()}
        class="h-7 w-7 shrink-0 flex items-center justify-center rounded border border-border text-muted transition-colors hover:bg-bg3 hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
    >
        <Undo2 size={14} />
    </button>

    <div class="w-px h-6 bg-border shrink-0"></div>

    <!-- View mode segmented control -->
    <div
        class="flex items-center rounded border border-border overflow-hidden shrink-0"
        role="group"
        aria-label={m.workshop_configViewMode()}
    >
        {#each viewModes as vm (vm.mode)}
            <button
                type="button"
                aria-pressed={workshopState.settings.viewMode === vm.mode}
                class="h-7 px-2.5 text-[10px] font-mono uppercase tracking-wider transition-colors {workshopState
                    .settings.viewMode === vm.mode
                    ? 'bg-accent text-white'
                    : 'bg-bg3 text-muted hover:text-foreground'}"
                onclick={() => setViewMode(vm.mode)}
            >
                {vm.label}
            </button>
        {/each}
    </div>

    <div class="w-px h-6 bg-border shrink-0"></div>

    <!-- Save status + Gallery link -->
    <div class="flex items-center gap-2 shrink-0">
        {#if saveSync.isSyncing}
            <span
                class="text-[9px] font-mono text-muted-strong animate-pulse"
                title={m.workshop_savingScene()}
            >
                {m.workshop_savingScene()}
            </span>
        {:else if savedClock}
            <span
                class="text-[9px] font-mono text-muted flex items-center gap-1"
                title={m.workshop_savingScene()}
            >
                <span class="w-1.5 h-1.5 rounded-full bg-green-400/70"></span>
                {m.workshop_sceneSaved()} {savedClock}
            </span>
        {/if}
        <a
            href="/agents/workshop"
            class="h-7 px-2.5 text-[10px] font-mono uppercase tracking-wider rounded border border-border text-muted hover:bg-bg3 hover:text-foreground transition-colors flex items-center gap-1"
        >
            ↩ {m.workshop_gallery()}
        </a>
    </div>
</div>
