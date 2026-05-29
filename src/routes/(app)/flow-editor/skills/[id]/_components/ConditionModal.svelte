<script lang="ts">
    import { GitBranch, XCircle, CheckCircle2 } from "lucide-svelte";
    import {
        skillEditorState, skillEditorDerived,
        saveCondition, updateCondition,
    } from '$lib/state/builder/skill-editor.svelte';
    import * as m from '$lib/paraglide/messages';
</script>

{#if skillEditorState.editingCondition}
    <div class="confirm-overlay" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) { skillEditorState.editingCondition = null; } }} onkeydown={(e) => { if (e.key === 'Escape') { skillEditorState.editingCondition = null; } }}>
        <div class="condition-modal" role="dialog" aria-modal="true" aria-labelledby="condition-modal-title">
            <div class="condition-modal-header">
                <GitBranch size={16} class="condition-icon" />
                <span class="condition-modal-title" id="condition-modal-title">{skillEditorState.editingCondition.id ? m.builder_editCondition() : m.builder_newCondition()}</span>
                <button type="button" class="close-btn" onclick={() => { skillEditorState.editingCondition = null; }} aria-label="Close">&times;</button>
            </div>
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
            <div class="condition-modal-footer">
                <button type="button" class="confirm-btn cancel" onclick={() => { skillEditorState.editingCondition = null; }}>{m.common_cancel()}</button>
                <button
                    type="button"
                    class="confirm-btn primary"
                    disabled={!skillEditorDerived.conditionValidation.valid}
                    onclick={skillEditorState.editingCondition.id ? updateCondition : saveCondition}
                >{skillEditorState.editingCondition.id ? m.builder_update() : m.builder_create()}</button>
            </div>
        </div>
    </div>
{/if}

<style>
    .confirm-overlay {
        position: fixed;
        inset: 0;
        z-index: 1100;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(2px);
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .confirm-btn { font-family: inherit; font-size: 0.75rem; font-weight: 600; padding: 0.375rem 0.875rem; border-radius: 0.375rem; cursor: pointer; transition: all 0.15s ease; border: none; }
    .confirm-btn.cancel { background: var(--color-bg2); color: var(--color-muted); border: 1px solid var(--color-border); }
    .confirm-btn.cancel:hover { color: var(--color-foreground); border-color: var(--color-foreground); }
    .confirm-btn.primary { background: var(--color-accent); color: white; }
    .confirm-btn.primary:hover:not(:disabled) { filter: brightness(1.1); }
    .confirm-btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Condition modal */
    .condition-modal { background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 0.75rem; max-width: 440px; width: 100%; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4); display: flex; flex-direction: column; }
    .condition-modal-header { display: flex; align-items: center; gap: 0.5rem; padding: 0.875rem 1.25rem; border-bottom: 1px solid var(--color-border); }
    :global(.condition-icon) { color: var(--color-warning, #f59e0b); flex-shrink: 0; }
    .condition-modal-title { font-size: 0.875rem; font-weight: 700; color: var(--color-foreground); flex: 1; }
    .condition-modal-body { padding: 1rem 1.25rem; display: flex; flex-direction: column; gap: 1rem; }
    .condition-field { display: flex; flex-direction: column; gap: 0.25rem; }
    .condition-label { font-size: 0.75rem; font-weight: 600; color: var(--color-foreground); }
    .required { color: var(--color-accent); }
    .condition-helper { font-size: 0.6875rem; color: var(--color-muted); }
    .condition-input { background: var(--color-bg2); border: 1px solid var(--color-border); border-radius: 0.375rem; color: var(--color-foreground); font-family: inherit; font-size: 0.8125rem; padding: 0.5rem 0.625rem; outline: none; transition: border-color 0.15s ease, box-shadow 0.15s ease; }
    .condition-input:focus { border-color: var(--color-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 20%, transparent); }
    .condition-input.invalid { border-color: var(--color-error, #ef4444); }
    .condition-input.invalid:focus { box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-error, #ef4444) 20%, transparent); }
    .condition-input.valid-input { border-color: var(--color-success, #22c55e); }
    .condition-error { display: flex; align-items: center; gap: 0.25rem; font-size: 0.6875rem; color: var(--color-error, #ef4444); }
    .condition-valid { display: flex; align-items: center; gap: 0.25rem; font-size: 0.6875rem; color: var(--color-success, #22c55e); }
    .condition-modal-footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.75rem 1.25rem; border-top: 1px solid var(--color-border); }

    .close-btn {
        background: transparent;
        border: none;
        color: var(--color-muted);
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.125rem;
        line-height: 1;
        transition: color 0.15s;
    }
    .close-btn:hover { color: var(--color-foreground); }
</style>
