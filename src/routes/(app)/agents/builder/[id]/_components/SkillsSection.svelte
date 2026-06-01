<script lang="ts">
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
                        <button
                            type="button"
                            class="slot-remove"
                            onclick={() => onRemoveSkill(slot.skillId)}
                            title={m.common_remove()}
                        >
                            <X size={14} />
                        </button>
                    </div>
                {/each}
            </div>
        {/if}

        <!-- Drop zone / Add skill button -->
        <div class="skill-drop-zone-wrapper">
            <button
                type="button"
                class="skill-drop-zone"
                onclick={onTogglePicker}
            >
                <Plus size={14} />
                <span>{m.builder_dropSkillHint()}</span>
            </button>

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
                            <button
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
                            </button>
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
        border-radius: 0.75rem;
        overflow: hidden;
    }

    .section-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1rem;
        margin: 0;
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-muted);
        border-bottom: 1px solid var(--color-border);
    }

    .section-count {
        font-size: 0.5625rem;
        color: var(--color-muted);
        background: var(--color-bg3);
        padding: 0.0625rem 0.375rem;
        border-radius: 9999px;
        font-weight: 500;
    }

    .section-body {
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .skill-slot-list {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
    }

    .skill-slot-card {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.625rem;
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
        border-radius: 0.5rem;
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
        font-size: 1rem;
        line-height: 1;
        flex-shrink: 0;
    }

    .slot-info {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .slot-name {
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--color-foreground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .slot-status {
        font-size: 0.5625rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        padding: 0.0625rem 0.375rem;
        border-radius: 9999px;
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
        border-radius: 0.25rem;
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
        color: var(--color-error, #ef4444);
        background: color-mix(in srgb, var(--color-error, #ef4444) 12%, transparent);
    }

    .skill-drop-zone-wrapper {
        position: relative;
    }

    .skill-drop-zone {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        width: 100%;
        padding: 0.75rem;
        border: 2px dashed var(--color-border);
        border-radius: 0.5rem;
        background: transparent;
        color: var(--color-muted);
        font-size: 0.75rem;
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
        border-radius: 0.5rem;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        max-height: 16rem;
        overflow-y: auto;
        z-index: 100;
    }

    .skill-picker-header {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.5rem 0.75rem;
        font-size: 0.625rem;
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
        padding: 1rem 0.75rem;
        font-size: 0.75rem;
        color: var(--color-muted);
        text-align: center;
    }

    .skill-picker-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        width: 100%;
        padding: 0.5rem 0.75rem;
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
        font-size: 0.9375rem;
        line-height: 1;
        flex-shrink: 0;
    }

    .picker-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
    }

    .picker-name {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--color-foreground);
    }

    .picker-desc {
        font-size: 0.625rem;
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
        border-radius: 0 0 0.5rem 0.5rem;
        z-index: 100;
    }
</style>
