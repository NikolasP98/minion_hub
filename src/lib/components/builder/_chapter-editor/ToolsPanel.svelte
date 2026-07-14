<script lang="ts">
    import { Sparkles } from "lucide-svelte";
    import { getToolInfo } from "$lib/data/tool-manifest";
    import * as m from '$lib/paraglide/messages';

    interface Props {
        availableToolIds: string[];
        selectedToolIds: string[];
        suggestedToolIds: string[];
        onToggle: (toolId: string) => void;
    }

    let { availableToolIds, selectedToolIds, suggestedToolIds, onToggle }: Props = $props();
</script>

<div class="field">
    <span class="field-label">{m.tools_title()} <span class="tool-count">{selectedToolIds.length}</span></span>
    {#if availableToolIds.length === 0}
        <div class="tools-empty">{m.tools_noTools()}</div>
    {:else}
        <div class="tools-grid">
            {#each availableToolIds as toolId (toolId)}
                {@const tool = getToolInfo(toolId)}
                {@const checked = selectedToolIds.includes(toolId)}
                {@const isSuggested = !checked && suggestedToolIds.includes(toolId)}
                <label class="tool-chip" class:checked class:suggested={isSuggested}>
                    <input type="checkbox" {checked} onchange={() => onToggle(toolId)} />
                    <span class="tool-icon">{tool.icon}</span>
                    <span class="tool-name">{tool.name}</span>
                    {#if isSuggested}
                        <Sparkles size={10} class="suggested-sparkle" />
                    {/if}
                </label>
            {/each}
        </div>
    {/if}
</div>

<style>
    .field {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
    }

    .field-label {
        font-size: var(--font-size-caption);
        font-weight: 600;
        color: var(--color-foreground);
    }

    .tool-count {
        font-size: var(--font-size-telemetry);
        color: var(--color-muted);
        background: var(--color-bg3);
        padding: 1px var(--space-2);
        border-radius: var(--radius-full);
        margin-left: var(--space-1);
        font-weight: 500;
    }

    .tools-empty {
        padding: var(--space-3);
        text-align: center;
        color: var(--color-muted);
        font-size: var(--font-size-caption);
        background: var(--color-bg2);
        border: 1px dashed var(--color-border);
        border-radius: var(--radius-md);
    }

    .tools-grid {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1);
    }

    .tool-chip {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        padding: var(--space-1) var(--space-2);
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        cursor: pointer;
        font-size: var(--font-size-caption);
        transition: all var(--duration-fast) var(--ease-standard);
    }
    .tool-chip:hover { border-color: var(--color-accent); }
    .tool-chip.checked {
        border-color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 8%, var(--color-bg2));
    }
    .tool-chip input[type="checkbox"] { display: none; }

    .tool-icon { font-size: var(--font-size-body); }
    .tool-name {
        color: var(--color-foreground);
        font-weight: 500;
    }
    .tool-chip:not(.checked) .tool-name { color: var(--color-muted); }
    .tool-chip.suggested {
        border-color: color-mix(in srgb, var(--color-accent) 30%, var(--color-border));
        background: color-mix(in srgb, var(--color-accent) 4%, var(--color-bg2));
        border-style: dashed;
    }
</style>
