<script lang="ts">
    import { autosize } from '$lib/actions/autosize';
    import * as m from '$lib/paraglide/messages';
    import AiWandButton from './AiWandButton.svelte';
    import ConflictBox from './ConflictBox.svelte';
    import type { FieldKey, FieldConflict, AiFieldName } from './types';

    interface Props {
        triggerConditions: string;
        guide: string;
        context: string;
        outputDef: string;
        successCriteria: string;
        conflicts: Partial<Record<FieldKey, FieldConflict>>;
        aiGenerated: boolean;
        fieldAiLoading: Record<string, boolean>;
        fieldAiGenerated: Record<string, boolean>;
        onFieldAiFill: (fieldName: AiFieldName) => void;
        onClearFieldAiGenerated: (fieldName: string) => void;
        onResolveConflict: (field: FieldKey, choice: 'user' | 'ai') => void;
    }

    let {
        triggerConditions = $bindable(),
        guide = $bindable(),
        context = $bindable(),
        outputDef = $bindable(),
        successCriteria = $bindable(),
        conflicts,
        aiGenerated,
        fieldAiLoading,
        fieldAiGenerated,
        onFieldAiFill,
        onClearFieldAiGenerated,
        onResolveConflict,
    }: Props = $props();
</script>

<div class="advanced-fields">
    <!-- Trigger Conditions -->
    <div class="field">
        <label class="field-label" for="ch-trigger">{m.builder_triggerConditions()}</label>
        <span class="field-helper">{m.builder_triggerConditionsHint()}</span>
        <textarea id="ch-trigger" class="field-textarea" use:autosize={triggerConditions} bind:value={triggerConditions} placeholder={m.builder_triggerPlaceholder()}></textarea>
        {#if conflicts.triggerConditions}
            <ConflictBox field="triggerConditions" conflict={conflicts.triggerConditions} onResolve={onResolveConflict} />
        {/if}
    </div>

    <!-- Instructions (guide) -->
    <div class="field">
        <div class="field-label-row">
            <label class="field-label" for="ch-guide">{m.builder_instructions()}</label>
            <AiWandButton loading={!!fieldAiLoading['guide']} onclick={() => onFieldAiFill('guide')} title="AI fill this field" />
        </div>
        <span class="field-helper">{m.builder_instructionsHint()}</span>
        {#if aiGenerated && !conflicts.guide}
            <span class="ai-label">({m.builder_aiGeneratedReview()})</span>
        {/if}
        <textarea id="ch-guide" class="field-textarea field-textarea--mono" class:ai-generated={fieldAiGenerated['guide']} use:autosize={guide} bind:value={guide} oninput={() => onClearFieldAiGenerated('guide')} placeholder={m.builder_guidePlaceholder()}></textarea>
        {#if conflicts.guide}
            <ConflictBox field="guide" conflict={conflicts.guide} onResolve={onResolveConflict} />
        {/if}
    </div>

    <!-- Input Expectations (context) -->
    <div class="field">
        <div class="field-label-row">
            <label class="field-label" for="ch-context">{m.builder_inputExpectations()}</label>
            <AiWandButton loading={!!fieldAiLoading['context']} onclick={() => onFieldAiFill('context')} title="AI fill this field" />
        </div>
        <span class="field-helper">{m.builder_inputExpectationsHint()}</span>
        {#if aiGenerated && !conflicts.context}
            <span class="ai-label">({m.builder_aiGenerated()})</span>
        {/if}
        <textarea id="ch-context" class="field-textarea" class:ai-generated={fieldAiGenerated['context']} use:autosize={context} bind:value={context} oninput={() => onClearFieldAiGenerated('context')} placeholder={m.builder_contextPlaceholder()}></textarea>
        {#if conflicts.context}
            <ConflictBox field="context" conflict={conflicts.context} onResolve={onResolveConflict} />
        {/if}
    </div>

    <!-- Output Definition -->
    <div class="field">
        <div class="field-label-row">
            <label class="field-label" for="ch-output">{m.builder_outputDefinition()}</label>
            <AiWandButton loading={!!fieldAiLoading['outputDef']} onclick={() => onFieldAiFill('outputDef')} title="AI fill this field" />
        </div>
        <span class="field-helper">{m.builder_outputDefinitionHint()}</span>
        {#if aiGenerated && !conflicts.outputDef}
            <span class="ai-label">(AI-generated)</span>
        {/if}
        <textarea id="ch-output" class="field-textarea" class:ai-generated={fieldAiGenerated['outputDef']} use:autosize={outputDef} bind:value={outputDef} oninput={() => onClearFieldAiGenerated('outputDef')} placeholder={m.builder_outputPlaceholder()}></textarea>
        {#if conflicts.outputDef}
            <ConflictBox field="outputDef" conflict={conflicts.outputDef} onResolve={onResolveConflict} />
        {/if}
    </div>

    <!-- Success Criteria -->
    <div class="field">
        <label class="field-label" for="ch-success">{m.builder_successCriteria()}</label>
        <span class="field-helper">{m.builder_successCriteriaHint()}</span>
        <textarea id="ch-success" class="field-textarea" use:autosize={successCriteria} bind:value={successCriteria} placeholder={m.builder_successPlaceholder()}></textarea>
        {#if conflicts.successCriteria}
            <ConflictBox field="successCriteria" conflict={conflicts.successCriteria} onResolve={onResolveConflict} />
        {/if}
    </div>
</div>

<style>
    .advanced-fields {
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding-top: 4px;
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .field-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--color-foreground);
    }

    .field-helper {
        font-size: 11px;
        color: var(--color-muted);
    }

    .field-textarea {
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-foreground);
        font-family: inherit;
        font-size: 13px;
        padding: 8px 10px;
        outline: none;
        resize: vertical;
        transition: border-color 0.15s, box-shadow 0.15s;
    }
    .field-textarea:focus {
        border-color: var(--color-accent);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 20%, transparent);
    }
    .field-textarea::placeholder { color: var(--color-muted); }

    .field-textarea--mono {
        font-family: "JetBrains Mono", "Fira Code", monospace;
        font-size: 12px;
    }

    .field-label-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 4px;
    }

    .field-textarea.ai-generated {
        opacity: 0.85;
        font-style: italic;
    }

    .ai-label {
        font-size: 11px;
        font-style: italic;
        color: var(--color-muted);
    }

    /* .ai-wand-btn styles live in the parent ChapterEditor.svelte as :global. */
</style>
