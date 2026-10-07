<script lang="ts">
  import { Button } from '$lib/components/ui';
  import { Dialog } from '$lib/components/ui/foundations';
import { GitBranch, XCircle, CheckCircle2 } from "lucide-svelte";
    import {
        skillEditorState, skillEditorDerived,
        saveCondition, updateCondition,
    } from '$lib/state/builder/skill-editor.svelte';
    import * as m from '$lib/paraglide/messages';

    function close() { skillEditorState.editingCondition = null; }
    const isEdit = $derived(Boolean(skillEditorState.editingCondition?.id));
</script>

<!-- HC-028: the shared native <dialog> contract owns modality, Escape (also
     from the inputs), backdrop dismissal, scroll lock and focus return. -->
{#if skillEditorState.editingCondition}
    <Dialog open={true} labelledBy="condition-modal-title" size="md" onclose={close}>
        {#snippet header()}
            <div class="condition-modal-header">
                <GitBranch size={16} class="condition-icon" />
                <span class="condition-modal-title" id="condition-modal-title">{isEdit ? m.builder_editCondition() : m.builder_newCondition()}</span>
            </div>
        {/snippet}
        <div class="condition-modal-body">
            <div class="condition-field">
                <label class="condition-label" for="cond-name">{m.builder_conditionLabel()}</label>
                <input id="cond-name" type="text" class="condition-input" bind:value={skillEditorState.conditionName} placeholder={m.builder_conditionNamePlaceholder()} />
            </div>
            <div class="condition-field">
                <label class="condition-label" for="cond-text">{m.builder_conditionText()} <span class="required">*</span></label>
                <span class="condition-helper">{m.builder_conditionHelper()}</span>
                <input
                    id="cond-text"
                    type="text"
                    class="condition-input"
                    class:invalid={skillEditorState.conditionText.trim().length > 0 && !skillEditorDerived.conditionValidation.valid}
                    class:valid-input={skillEditorDerived.conditionValidation.valid}
                    bind:value={skillEditorState.conditionText}
                    placeholder={m.builder_conditionPlaceholder()}
                />
                {#if skillEditorState.conditionText.trim().length > 0 && !skillEditorDerived.conditionValidation.valid}
                    <span class="condition-error">
                        <XCircle size={12} />
                        {skillEditorDerived.conditionValidation.reason}
                    </span>
                {:else if skillEditorDerived.conditionValidation.valid}
                    <span class="condition-valid">
                        <CheckCircle2 size={12} />
                        {m.builder_validBinaryCondition()}
                    </span>
                {/if}
            </div>
        </div>
        {#snippet footer()}
            <Button variant="ghost" type="button" class="confirm-btn cancel" onclick={close}>{m.common_cancel()}</Button>
            <Button variant="ghost"
                type="button"
                class="confirm-btn primary"
                disabled={!skillEditorDerived.conditionValidation.valid}
                onclick={isEdit ? updateCondition : saveCondition}
            >{isEdit ? m.builder_update() : m.builder_create()}</Button>
        {/snippet}
    </Dialog>
{/if}

<style>
    :global(.confirm-btn) { font-family: inherit; font-size: var(--font-size-caption); font-weight: 600; padding: var(--space-2) var(--space-3); border-radius: var(--radius-md); cursor: pointer; transition: all var(--duration-fast) var(--ease-standard); border: none; }
    :global(.confirm-btn.cancel) { background: var(--color-bg2); color: var(--color-muted); border: 1px solid var(--color-border); }
    :global(.confirm-btn.cancel):hover { color: var(--color-foreground); border-color: var(--color-foreground); }
    :global(.confirm-btn.primary) { background: var(--color-accent); color: white; }
    :global(.confirm-btn.primary):hover:not(:disabled) { filter: brightness(1.1); }
    :global(.confirm-btn.primary):disabled { opacity: 0.5; cursor: not-allowed; }

    /* Condition modal */
    .condition-modal-header { display: flex; align-items: center; gap: var(--space-2); }
    :global(.condition-icon) { color: var(--color-warning, var(--color-warning-fg)); flex-shrink: 0; }
    .condition-modal-title { font-size: var(--font-size-body); font-weight: 700; color: var(--color-foreground); flex: 1; }
    .condition-modal-body { display: flex; flex-direction: column; gap: var(--space-4); }
    .condition-field { display: flex; flex-direction: column; gap: var(--space-1); }
    .condition-label { font-size: var(--font-size-caption); font-weight: 600; color: var(--color-foreground); }
    .required { color: var(--color-accent); }
    .condition-helper { font-size: var(--font-size-caption); color: var(--color-muted); }
    .condition-input { background: var(--color-bg2); border: 1px solid var(--color-border); border-radius: var(--radius-md); color: var(--color-foreground); font-family: inherit; font-size: var(--font-size-body); padding: var(--space-2) var(--space-2); outline: none; transition: border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard); }
    .condition-input:focus { border-color: var(--color-accent); box-shadow: var(--shadow-elevation-1); }
    .condition-input.invalid { border-color: var(--color-danger-border); }
    .condition-input.invalid:focus { box-shadow: var(--shadow-elevation-1); }
    .condition-input.valid-input { border-color: var(--color-success, var(--color-success-fg)); }
    .condition-error { display: flex; align-items: center; gap: var(--space-1); font-size: var(--font-size-caption); color: var(--color-danger-fg); }
    .condition-valid { display: flex; align-items: center; gap: var(--space-1); font-size: var(--font-size-caption); color: var(--color-success, var(--color-success-fg)); }
</style>
