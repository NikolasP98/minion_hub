<script lang="ts">
  import { Button } from '$lib/components/ui';
import { Loader2, Check } from "lucide-svelte";
    import * as m from '$lib/paraglide/messages';
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

    type HoverType = 'built-skill';

    interface Props {
        contentProps: Record<string, any>;
        skillsLoading: boolean;
        publishedSkills: BuiltSkill[];
        selectedBuiltSkillIds: string[];
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
        showPopover: (type: HoverType, id: string, e: MouseEvent) => void;
        trackCursor: (e: MouseEvent) => void;
        hidePopover: () => void;
    }

    let {
        contentProps,
        skillsLoading,
        publishedSkills,
        selectedBuiltSkillIds,
        totalSelected,
        emoji,
        name,
        model,
        hoveredItem,
        tooltipPos,
        tooltipVisible,
        popoverData,
        toggleBuiltSkill,
        showPopover,
        trackCursor,
        hidePopover,
    }: Props = $props();
</script>

<div {...contentProps}>
    <span class="field-helper">
        {m.builder_selectSkillsTools({ count: totalSelected })}
    </span>

    {#if skillsLoading}
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
                        <Button variant="ghost"
                            type="button"
                            class={`icon-btn${selected ? ' selected' : ''}`}
                            onclick={() => toggleBuiltSkill(skill.id)}
                            onmouseenter={(e: MouseEvent) => showPopover('built-skill', skill.id, e)}
                            onmousemove={trackCursor}
                            onmouseleave={hidePopover}
                            aria-label={skill.name}
                        >
                            <span class="icon-emoji">{skill.emoji || '\u{1F4D6}'}</span>
                            {#if selected}<span class="icon-check"><Check size={10} /></span>{/if}
                        </Button>
                    {/each}
                </div>
            </div>
        {/if}

        {#if publishedSkills.length === 0}
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
        font-size: var(--font-size-caption);
        color: var(--color-muted);
        margin-bottom: var(--space-2);
    }

    .cap-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
        padding: var(--space-6);
        color: var(--color-muted);
        font-size: var(--font-size-body);
    }

    .cap-empty {
        padding: var(--space-6);
        text-align: center;
        color: var(--color-muted);
        font-size: var(--font-size-body);
        background: var(--color-bg2);
        border: 1px dashed var(--color-border);
        border-radius: var(--radius-md);
        margin-top: var(--space-2);
    }

    .cap-group {
        margin-bottom: var(--space-3);
    }

    .cap-group-label {
        display: flex;
        align-items: center;
        gap: var(--space-1);
        font-size: var(--font-size-telemetry);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-muted);
        margin-bottom: var(--space-2);
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
        gap: var(--space-2);
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
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: all var(--duration-fast) var(--ease-standard);
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
        box-shadow: var(--shadow-elevation-1);
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
        font-size: var(--font-size-page-title);
        line-height: 1;
    }

    .icon-tool-label {
        font-size: var(--font-size-telemetry);
        font-weight: 700;
        font-family: "JetBrains Mono", "Fira Code", monospace;
        color: var(--color-muted);
        text-transform: lowercase;
        line-height: 1;
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
        border-radius: var(--radius-full);
        line-height: 1;
    }

    .summary {
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: var(--space-3) var(--space-3);
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        margin-top: var(--space-4);
    }

    .summary-row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
    }

    .summary-emoji {
        font-size: var(--font-size-page-title);
        line-height: 1;
    }

    .summary-name {
        font-size: var(--font-size-body);
        font-weight: 700;
        color: var(--color-foreground);
    }

    .summary-detail {
        font-size: var(--font-size-caption);
        color: var(--color-muted);
    }

    .summary-detail code {
        font-family: "JetBrains Mono", "Fira Code", monospace;
        font-size: var(--font-size-telemetry);
        background: var(--color-bg3, var(--color-bg));
        padding: 1px var(--space-1);
        border-radius: var(--radius-xs);
        color: var(--color-foreground);
    }
</style>
