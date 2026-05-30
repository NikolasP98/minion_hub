<script lang="ts">
    import { workshopState } from "$lib/state/workshop/workshop.svelte";
    import * as m from "$lib/paraglide/messages";
    import {
        saveSync,
        setViewMode,
        undoState,
        toggleIdleBanter,
    } from "$lib/state/workshop/workshop.svelte";
    import { banterBudget } from "$lib/state/workshop/banter-budget.svelte";
    import Undo2 from "lucide-svelte/icons/undo-2";
    import MessageCircle from "lucide-svelte/icons/message-circle";
    import MessageCircleOff from "lucide-svelte/icons/message-circle-off";

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

    function requestUndo() {
        window.dispatchEvent(new Event("workshop:undo"));
    }

    const banterEnabled = $derived(workshopState.settings.idleBanterEnabled);
    const banterTotal = $derived(workshopState.settings.idleBanterBudgetPerHour);
    const banterExhausted = $derived(banterBudget.used >= banterTotal);
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

    <!-- Spacer: the agent/element palette now lives in the left dock -->
    <div class="flex-1"></div>

    <!-- Banter budget meter: surfaces the hidden idle auto-chat budget + on/off -->
    <button
        type="button"
        onclick={toggleIdleBanter}
        title={banterEnabled
            ? m.workshop_banterHintOn()
            : m.workshop_banterHintOff()}
        aria-label={m.workshop_banter()}
        aria-pressed={banterEnabled}
        class="h-7 px-2 shrink-0 flex items-center gap-1 rounded border border-border font-mono text-[10px] transition-colors hover:bg-bg3 {banterEnabled
            ? 'text-muted'
            : 'text-muted/40'}"
    >
        {#if banterEnabled}
            <MessageCircle size={13} />
        {:else}
            <MessageCircleOff size={13} />
        {/if}
        <span
            class="tabular-nums {!banterEnabled
                ? 'line-through'
                : banterExhausted
                  ? 'text-yellow-400'
                  : 'text-foreground/70'}"
        >
            {banterBudget.used}/{banterTotal}
        </span>
    </button>

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
