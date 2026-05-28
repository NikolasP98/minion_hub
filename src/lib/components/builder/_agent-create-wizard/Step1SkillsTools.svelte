<script lang="ts">
    import { Loader2, Check, Wrench } from "lucide-svelte";
    import * as m from '$lib/paraglide/messages';
    import type { SkillStatusEntry } from "$lib/types/skills";
    import type { ToolStatusEntry } from "$lib/types/tools";
    import CursorTooltip from "./CursorTooltip.svelte";

    interface BuiltSkill {
        id: string;
        name: string;
        description: string;
        emoji: string;
        status: string;
    }

    interface PopoverData {
        emoji: string | null;
        name: string;
        desc: string;
        badge: string | null;
    }

    type HoverType = 'skill' | 'built-skill' | 'tool';

    interface Props {
        contentProps: Record<string, any>;
        skillsLoading: boolean;
        toolsLoading: boolean;
        publishedSkills: BuiltSkill[];
        gatewaySkills: SkillStatusEntry[];
        gatewayTools: ToolStatusEntry[];
        ineligibleSkills: SkillStatusEntry[];
        skillsBySource: Map<string, SkillStatusEntry[]>;
        toolsByGroup: Map<string, ToolStatusEntry[]>;
        selectedBuiltSkillIds: string[];
        selectedGatewaySkillIds: string[];
        selectedToolIds: string[];
        totalSelected: number;
        emoji: string;
        name: string;
        model: string;
        // tooltip
        hoveredItem: { type: HoverType; id: string } | null;
        tooltipPos: { x: number; y: number };
        tooltipVisible: boolean;
        popoverData: PopoverData | null;
        // callbacks
        toggleBuiltSkill: (id: string) => void;
        toggleGatewaySkill: (id: string) => void;
        toggleTool: (id: string) => void;
        showPopover: (type: HoverType, id: string, e: MouseEvent) => void;
        trackCursor: (e: MouseEvent) => void;
        hidePopover: () => void;
    }

    let {
        contentProps,
        skillsLoading,
        toolsLoading,
        publishedSkills,
        gatewaySkills,
        gatewayTools,
        ineligibleSkills,
        skillsBySource,
        toolsByGroup,
        selectedBuiltSkillIds,
        selectedGatewaySkillIds,
        selectedToolIds,
        totalSelected,
        emoji,
        name,
        model,
        hoveredItem,
        tooltipPos,
        tooltipVisible,
        popoverData,
        toggleBuiltSkill,
        toggleGatewaySkill,
        toggleTool,
        showPopover,
        trackCursor,
        hidePopover,
    }: Props = $props();
</script>

<div {...contentProps}>
    <span class="field-helper">
        {m.builder_selectSkillsTools({ count: totalSelected })}
    </span>

    {#if skillsLoading || toolsLoading}
        <div class="cap-loading">
            <Loader2 size={18} class="spin" />
            <span>{m.builder_loadingCapabilities()}</span>
        </div>
    {:else}
        <!-- Built Skills (custom) -->
        {#if publishedSkills.length > 0}
            <div class="cap-group">
                <span class="cap-group-label">{m.builder_customSkills()}</span>
                <div class="icon-grid">
                    {#each publishedSkills as skill (skill.id)}
                        {@const selected = selectedBuiltSkillIds.includes(skill.id)}
                        <button
                            type="button"
                            class="icon-btn"
                            class:selected
                            onclick={() => toggleBuiltSkill(skill.id)}
                            onmouseenter={(e) => showPopover('built-skill', skill.id, e)}
                            onmousemove={trackCursor}
                            onmouseleave={hidePopover}
                            aria-label={skill.name}
                        >
                            <span class="icon-emoji">{skill.emoji || '\u{1F4D6}'}</span>
                            {#if selected}<span class="icon-check"><Check size={10} /></span>{/if}
                        </button>
                    {/each}
                </div>
            </div>
        {/if}

        <!-- Gateway Skills grouped by source -->
        {#each [...skillsBySource.entries()] as [source, skills] (source)}
            <div class="cap-group">
                <span class="cap-group-label">
                    {source === 'bundled' ? m.builder_builtInSkills() : source}
                </span>
                <div class="icon-grid">
                    {#each skills as skill (skill.skillKey)}
                        {@const selected = selectedGatewaySkillIds.includes(skill.skillKey)}
                        <button
                            type="button"
                            class="icon-btn"
                            class:selected
                            class:icon-disabled={skill.disabled}
                            onclick={() => toggleGatewaySkill(skill.skillKey)}
                            onmouseenter={(e) => showPopover('skill', skill.skillKey, e)}
                            onmousemove={trackCursor}
                            onmouseleave={hidePopover}
                            aria-label={skill.name}
                        >
                            <span class="icon-emoji">{skill.emoji || '\u{1F4D6}'}</span>
                            {#if selected}<span class="icon-check"><Check size={10} /></span>{/if}
                        </button>
                    {/each}
                </div>
            </div>
        {/each}

        <!-- Ineligible skills -->
        {#if ineligibleSkills.length > 0}
            <div class="cap-group">
                <span class="cap-group-label cap-group-label--dim">{m.builder_unavailable({ count: ineligibleSkills.length })}</span>
                <div class="icon-grid">
                    {#each ineligibleSkills as skill (skill.skillKey)}
                        <button
                            type="button"
                            class="icon-btn icon-ineligible"
                            disabled
                            onmouseenter={(e) => showPopover('skill', skill.skillKey, e)}
                            onmousemove={trackCursor}
                            onmouseleave={hidePopover}
                            aria-label="{skill.name} ({m.builder_unavailableLabel()})"
                        >
                            <span class="icon-emoji">{skill.emoji || '\u{1F4D6}'}</span>
                        </button>
                    {/each}
                </div>
            </div>
        {/if}

        <!-- Tools grouped by group tag -->
        {#if gatewayTools.length > 0}
            {#each [...toolsByGroup.entries()] as [group, tools] (group)}
                <div class="cap-group">
                    <span class="cap-group-label">
                        <Wrench size={10} class="cap-group-icon" />
                        {group}
                    </span>
                    <div class="icon-grid">
                        {#each tools as tool (tool.id)}
                            {@const selected = selectedToolIds.includes(tool.id)}
                            <button
                                type="button"
                                class="icon-btn icon-btn--tool"
                                class:selected
                                onclick={() => toggleTool(tool.id)}
                                onmouseenter={(e) => showPopover('tool', tool.id, e)}
                                onmousemove={trackCursor}
                                onmouseleave={hidePopover}
                                aria-label={tool.id}
                            >
                                <span class="icon-tool-label">{tool.id.slice(0, 2)}</span>
                                {#if selected}<span class="icon-check"><Check size={10} /></span>{/if}
                            </button>
                        {/each}
                    </div>
                </div>
            {/each}
        {/if}

        {#if gatewaySkills.length === 0 && publishedSkills.length === 0 && gatewayTools.length === 0}
            <div class="cap-empty">
                {m.builder_noCapabilities()}
            </div>
        {/if}
    {/if}

    <!-- Summary -->
    <div class="summary">
        <div class="summary-row">
            <span class="summary-emoji">{emoji}</span>
            <span class="summary-name">{name || m.builder_untitled()}</span>
        </div>
        {#if model}
            <div class="summary-detail">
                <code>{model}</code>
            </div>
        {/if}
        <div class="summary-detail">
            {m.builder_capabilitiesSelected({ count: totalSelected })}
        </div>
    </div>

    <!-- Cursor-following tooltip -->
    <CursorTooltip
        visible={!!hoveredItem && !!popoverData && tooltipVisible}
        pos={tooltipPos}
        data={popoverData}
    />
</div>

<style>
    .field-helper {
        font-size: 11px;
        color: var(--color-muted);
        margin-bottom: 6px;
    }

    .cap-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 24px;
        color: var(--color-muted);
        font-size: 13px;
    }

    .cap-empty {
        padding: 24px;
        text-align: center;
        color: var(--color-muted);
        font-size: 13px;
        background: var(--color-bg2);
        border: 1px dashed var(--color-border);
        border-radius: 8px;
        margin-top: 8px;
    }

    .cap-group {
        margin-bottom: 14px;
    }

    .cap-group-label {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-muted);
        margin-bottom: 6px;
    }

    .cap-group-label--dim {
        opacity: 0.6;
    }

    :global(.cap-group-icon) {
        opacity: 0.6;
    }

    .icon-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        justify-content: flex-start;
    }

    .icon-btn {
        position: relative;
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--color-bg2);
        border: 1.5px solid var(--color-border);
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.15s;
        font-family: inherit;
        padding: 0;
        flex-shrink: 0;
    }
    .icon-btn:hover {
        border-color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 6%, var(--color-bg2));
        transform: translateY(-1px);
    }
    .icon-btn.selected {
        border-color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 12%, var(--color-bg2));
        box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--color-accent) 30%, transparent);
    }

    .icon-btn.icon-disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .icon-btn.icon-ineligible {
        opacity: 0.25;
        cursor: default;
    }

    .icon-btn--tool {
        background: var(--color-bg2);
    }

    .icon-emoji {
        font-size: 16px;
        line-height: 1;
    }

    .icon-tool-label {
        font-size: 10px;
        font-weight: 700;
        font-family: "JetBrains Mono", "Fira Code", monospace;
        color: var(--color-muted);
        text-transform: lowercase;
        line-height: 1;
    }
    .icon-btn.selected .icon-tool-label {
        color: var(--color-accent);
    }

    .icon-check {
        position: absolute;
        top: -4px;
        right: -4px;
        width: 14px;
        height: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--color-accent);
        color: white;
        border-radius: 50%;
        line-height: 1;
    }

    .summary {
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-top: 16px;
    }

    .summary-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .summary-emoji {
        font-size: 18px;
        line-height: 1;
    }

    .summary-name {
        font-size: 13px;
        font-weight: 700;
        color: var(--color-foreground);
    }

    .summary-detail {
        font-size: 11px;
        color: var(--color-muted);
    }

    .summary-detail code {
        font-family: "JetBrains Mono", "Fira Code", monospace;
        font-size: 10px;
        background: var(--color-bg3, var(--color-bg));
        padding: 1px 5px;
        border-radius: 3px;
        color: var(--color-foreground);
    }
</style>
