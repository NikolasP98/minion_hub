<script lang="ts">
    import AgentSelector from "./AgentSelector.svelte";
    import { promptSections } from "$lib/state/features/prompt-sections.svelte";
    import type { PromptMode } from "@minion-stack/shared";

    const modes: PromptMode[] = ["full", "minimal", "none"];

    function handleModeChange(event: Event) {
        const select = event.currentTarget as HTMLSelectElement;
        promptSections.mode = select.value as PromptMode;
    }
</script>

<div class="flex items-center gap-2">
    <AgentSelector />
    <div class="h-4 w-px bg-border/60"></div>
    <label class="flex items-center gap-1.5 text-xs text-muted">
        <span class="font-medium">Mode</span>
        <select
            value={promptSections.mode}
            onchange={handleModeChange}
            class="bg-bg2 border border-border rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-accent"
        >
            {#each modes as mode (mode)}
                <option value={mode}>{mode}</option>
            {/each}
        </select>
    </label>
</div>
