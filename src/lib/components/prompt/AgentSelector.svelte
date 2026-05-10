<script lang="ts">
    import { ChevronDown } from "lucide-svelte";
    import { visibleAgents } from "$lib/state/gateway/gateway-data.svelte";
    import {
        promptSections,
        resetPromptSectionsForAgent,
    } from "$lib/state/features/prompt-sections.svelte";

    const agents = $derived(visibleAgents.value);
    const activeAgent = $derived(
        promptSections.agentId
            ? agents.find((a) => a.id === promptSections.agentId)
            : null
    );

    function handleChange(event: Event) {
        const select = event.currentTarget as HTMLSelectElement;
        const value = select.value || null;
        resetPromptSectionsForAgent(value);
    }
</script>

<label class="agent-selector">
    <span class="sr-only">Agent</span>
    <div
        class="relative inline-flex items-center nav-pill {activeAgent
            ? 'active-accent'
            : ''}"
    >
        <select
            value={promptSections.agentId ?? ''}
            onchange={handleChange}
            disabled={agents.length === 0}
            class="pr-6 pl-2 py-1 bg-transparent appearance-none cursor-pointer text-xs font-medium focus:outline-none"
        >
            {#if agents.length === 0}
                <option value="">No agents available</option>
            {:else}
                <option value="">Select agent…</option>
                {#each agents as agent (agent.id)}
                    <option value={agent.id}>
                        {agent.name ?? agent.id}
                    </option>
                {/each}
            {/if}
        </select>
        <ChevronDown
            size={12}
            class="absolute right-1.5 pointer-events-none opacity-60"
        />
    </div>
</label>

<style>
    .agent-selector .nav-pill {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.25rem 0.5rem;
        border-radius: 0.5rem;
        font-size: 0.75rem;
        font-weight: 500;
        color: var(--color-muted);
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        transition: all 0.15s ease;
    }

    .agent-selector .nav-pill:hover {
        color: var(--color-foreground);
        background: var(--color-bg3);
    }

    .agent-selector .nav-pill.active-accent {
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 8%, transparent);
        border-color: color-mix(in srgb, var(--color-accent) 30%, transparent);
    }

    .agent-selector select {
        color: inherit;
        font: inherit;
    }

    .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
    }
</style>
