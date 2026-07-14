<script lang="ts">
  import { Button } from '$lib/components/ui';
import { Grip, Plus, X, BookOpen } from "lucide-svelte";
    import * as m from '$lib/paraglide/messages';

    interface SkillSlot { skillId: string; position: number; }
    interface SkillInfo { id: string; name: string; emoji: string; status: string; description: string; }
    interface AssignedSlot { skillId: string; position: number; info: SkillInfo | undefined; }

    interface Props {
        skillSlots: SkillSlot[];
        assignedSkillInfos: AssignedSlot[];
        availableSkills: SkillInfo[];
        assignedSkillIds: Set<string>;
        pickableSkills: SkillInfo[];
        showSkillPicker: boolean;
        dragOverIdx: number | null;
        onTogglePicker: () => void;
        onAddSkill: (skillId: string) => void;
        onRemoveSkill: (skillId: string) => void;
        onSlotDragStart: (e: DragEvent, idx: number) => void;
        onSlotDragOver: (e: DragEvent, idx: number) => void;
        onSlotDragLeave: () => void;
        onSlotDrop: (e: DragEvent, idx: number) => void;
        onSlotDragEnd: () => void;
    }

    let {
        skillSlots,
        assignedSkillInfos,
        availableSkills,
        assignedSkillIds,
        pickableSkills,
        showSkillPicker,
        dragOverIdx,
        onTogglePicker,
        onAddSkill,
        onRemoveSkill,
        onSlotDragStart,
        onSlotDragOver,
        onSlotDragLeave,
        onSlotDrop,
        onSlotDragEnd,
    }: Props = $props();
</script>

<section class="editor-section">
    <h3 class="section-header">
        {m.builder_skillSlots()}
        <span class="section-count">{skillSlots.length}</span>
    </h3>
    <div class="section-body">
        {#if assignedSkillInfos.length > 0}
            <div class="skill-slot-list">
                {#each assignedSkillInfos as slot, i (slot.skillId)}
                    <div
                        class="skill-slot-card"
                        class:drag-over={dragOverIdx === i}
                        draggable="true"
                        role="listitem"
                        ondragstart={(e) => onSlotDragStart(e, i)}
                        ondragover={(e) => onSlotDragOver(e, i)}
                        ondragleave={onSlotDragLeave}
                        ondrop={(e) => onSlotDrop(e, i)}
                        ondragend={onSlotDragEnd}
                    >
                        <span class="slot-grip" title={m.builder_dragToReorder()}>
                            <Grip size={14} />
                        </span>
                        <span class="slot-emoji">{slot.info?.emoji ?? "\u{1F4D6}"}</span>
                        <div class="slot-info">
                            <span class="slot-name">{slot.info?.name ?? slot.skillId}</span>
                            {#if slot.info}
                                <span class="slot-status {slot.info.status}">{slot.info.status}</span>
                            {/if}
                        </div>
                        <Button variant="ghost"
                            type="button"
                            class="slot-remove"
                            onclick={() => onRemoveSkill(slot.skillId)}
                            title={m.common_remove()}
                        >
                            <X size={14} />
                        </Button>
                    </div>
                {/each}
            </div>
        {/if}

        <!-- Drop zone / Add skill button -->
        <div class="skill-drop-zone-wrapper">
            <Button variant="ghost"
                type="button"
                class="skill-drop-zone"
                onclick={onTogglePicker}
            >
                <Plus size={14} />
                <span>{m.builder_dropSkillHint()}</span>
            </Button>

            {#if showSkillPicker}
                <div class="skill-picker">
                    <div class="skill-picker-header">
                        <BookOpen size={12} />
                        <span>{m.builder_publishedSkills()}</span>
                    </div>
                    {#if pickableSkills.length === 0}
                        <div class="skill-picker-empty">
                            {m.builder_noPublishedSkills()}
                        </div>
                    {:else}
                        {#each pickableSkills as skill (skill.id)}
                            <Button variant="ghost"
                                type="button"
                                class="skill-picker-item"
                                onclick={() => onAddSkill(skill.id)}
                            >
                                <span class="picker-emoji">{skill.emoji || "\u{1F4D6}"}</span>
                                <div class="picker-info">
                                    <span class="picker-name">{skill.name}</span>
                                    {#if skill.description}
                                        <span class="picker-desc">{skill.description}</span>
                                    {/if}
                                </div>
                            </Button>
                        {/each}
                    {/if}
                </div>
            {/if}

            {#if availableSkills.filter(s => assignedSkillIds.has(s.id)).length > 0 && showSkillPicker}
                <!-- Already assigned skills shown grayed out -->
                <div class="skill-picker-assigned">
                    <div class="skill-picker-header muted">
                        <span>{m.builder_alreadyAssigned()}</span>
                    </div>
                    {#each availableSkills.filter(s => assignedSkillIds.has(s.id)) as skill (skill.id)}
                        <div class="skill-picker-item disabled">
                            <span class="picker-emoji">{skill.emoji || "\u{1F4D6}"}</span>
                            <div class="picker-info">
                                <span class="picker-name">{skill.name}</span>
                            </div>
                        </div>
                    {/each}
                </div>
            {/if}
        </div>
    </div>
</section>

<style>
    .editor-section {
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        overflow: hidden;
    }

    .section-header {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-3) var(--space-4);
        margin: 0;
        font-size: var(--font-size-caption);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-muted);
        border-bottom: 1px solid var(--color-border);
    }

    .section-count {
        font-size: var(--font-size-telemetry);
        color: var(--color-muted);
        background: var(--color-bg3);
        padding: var(--space-0-5) var(--space-2);
        border-radius: var(--radius-full);
        font-weight: 500;
    }

    .section-body {
        padding: var(--space-4);
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
    }

    .skill-slot-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .skill-slot-card {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-2);
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        transition: all var(--duration-fast) var(--ease-standard);
        cursor: grab;
    }

    .skill-slot-card:active {
        cursor: grabbing;
    }

    .skill-slot-card:hover {
        border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
    }

    .skill-slot-card.drag-over {
        border-color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 6%, transparent);
    }

    .slot-grip {
        display: flex;
        align-items: center;
        color: var(--color-muted);
        opacity: 0.5;
        flex-shrink: 0;
    }

    .skill-slot-card:hover .slot-grip {
        opacity: 1;
    }

    .slot-emoji {
        font-size: var(--font-size-page-title);
        line-height: 1;
        flex-shrink: 0;
    }

    .slot-info {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: var(--space-2);
    }

    .slot-name {
        font-size: var(--font-size-body);
        font-weight: 600;
        color: var(--color-foreground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .slot-status {
        font-size: var(--font-size-telemetry);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        padding: var(--space-0-5) var(--space-2);
        border-radius: var(--radius-full);
        flex-shrink: 0;
    }

    .slot-status.draft {
        color: var(--color-warning);
        background: color-mix(in srgb, var(--color-warning) 12%, transparent);
    }

    .slot-status.published {
        color: var(--color-success);
        background: color-mix(in srgb, var(--color-success) 12%, transparent);
    }

    .slot-remove {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 1.5rem;
        height: 1.5rem;
        border-radius: var(--radius-sm);
        color: var(--color-muted);
        background: none;
        border: none;
        cursor: pointer;
        transition: all var(--duration-instant) var(--ease-standard);
        font-family: inherit;
        flex-shrink: 0;
        opacity: 0;
    }

    .skill-slot-card:hover .slot-remove {
        opacity: 1;
    }

    .slot-remove:hover {
        color: var(--color-danger-fg);
        background: var(--color-danger-surface);
    }

    .skill-drop-zone-wrapper {
        position: relative;
    }

    .skill-drop-zone {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
        width: 100%;
        padding: var(--space-3);
        border: 2px dashed var(--color-border);
        border-radius: var(--radius-md);
        background: transparent;
        color: var(--color-muted);
        font-size: var(--font-size-caption);
        font-family: inherit;
        cursor: pointer;
        transition: all var(--duration-fast) var(--ease-standard);
    }

    .skill-drop-zone:hover {
        border-color: var(--color-accent);
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 4%, transparent);
    }

    .skill-picker {
        position: absolute;
        top: calc(100% + 0.375rem);
        left: 0;
        right: 0;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-elevation-2);
        max-height: 16rem;
        overflow-y: auto;
        z-index: var(--layer-debug);
    }

    .skill-picker-header {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-3);
        font-size: var(--font-size-telemetry);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-muted);
        border-bottom: 1px solid var(--color-border);
    }

    .skill-picker-header.muted {
        opacity: 0.6;
    }

    .skill-picker-empty {
        padding: var(--space-4) var(--space-3);
        font-size: var(--font-size-caption);
        color: var(--color-muted);
        text-align: center;
    }

    .skill-picker-item {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        width: 100%;
        padding: var(--space-2) var(--space-3);
        background: none;
        border: none;
        cursor: pointer;
        text-align: left;
        font-family: inherit;
        transition: background var(--duration-instant) var(--ease-standard);
        color: inherit;
    }

    .skill-picker-item:hover {
        background: var(--color-bg2);
    }

    .skill-picker-item.disabled {
        opacity: 0.4;
        cursor: not-allowed;
        pointer-events: none;
    }

    .picker-emoji {
        font-size: var(--font-size-page-title);
        line-height: 1;
        flex-shrink: 0;
    }

    .picker-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-0-5);
    }

    .picker-name {
        font-size: var(--font-size-caption);
        font-weight: 600;
        color: var(--color-foreground);
    }

    .picker-desc {
        font-size: var(--font-size-telemetry);
        color: var(--color-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .skill-picker-assigned {
        position: absolute;
        left: 0;
        right: 0;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-top: none;
        border-radius: 0 0 var(--radius-md) var(--radius-md);
        z-index: var(--layer-debug);
    }
</style>
