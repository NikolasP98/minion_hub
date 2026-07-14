<script lang="ts">
  import { Button } from '$lib/components/ui';
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
                <Button variant="ghost" type="button" class="close-btn" onclick={() => { skillEditorState.editingCondition = null; }} aria-label="Close">&times;</Button>
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
                <Button variant="ghost" type="button" class="confirm-btn cancel" onclick={() => { skillEditorState.editingCondition = null; }}>{m.common_cancel()}</Button>
                <Button variant="ghost"
                    type="button"
                    class="confirm-btn primary"
                    disabled={!skillEditorDerived.conditionValidation.valid}
                    onclick={skillEditorState.editingCondition.id ? updateCondition : saveCondition}
                >{skillEditorState.editingCondition.id ? m.builder_update() : m.builder_create()}</Button>
            </div>
        </div>
    </div>
{/if}

<style>
    .confirm-overlay {
        position: fixed;
        inset: 0;
        z-index: var(--layer-debug);
        background: color-mix(in srgb, var(--color-canvas) 50%, transparent);
        backdrop-filter: blur(2px);
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .confirm-btn { font-family: inherit; font-size: var(--font-size-caption); font-weight: 600; padding: var(--space-2) var(--space-3); border-radius: var(--radius-md); cursor: pointer; transition: all var(--duration-fast) var(--ease-standard); border: none; }
    .confirm-btn.cancel { background: var(--color-bg2); color: var(--color-muted); border: 1px solid var(--color-border); }
    .confirm-btn.cancel:hover { color: var(--color-foreground); border-color: var(--color-foreground); }
    .confirm-btn.primary { background: var(--color-accent); color: white; }
    .confirm-btn.primary:hover:not(:disabled) { filter: brightness(1.1); }
    .confirm-btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Condition modal */
    .condition-modal { background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-lg); max-width: 440px; width: 100%; box-shadow: var(--shadow-overlay); display: flex; flex-direction: column; }
    .condition-modal-header { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-3) var(--space-6); border-bottom: 1px solid var(--color-border); }
    :global(.condition-icon) { color: var(--color-warning, var(--color-warning-fg)); flex-shrink: 0; }
    .condition-modal-title { font-size: var(--font-size-body); font-weight: 700; color: var(--color-foreground); flex: 1; }
    .condition-modal-body { padding: var(--space-4) var(--space-6); display: flex; flex-direction: column; gap: var(--space-4); }
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
    .condition-modal-footer { display: flex; justify-content: flex-end; gap: var(--space-2); padding: var(--space-3) var(--space-6); border-top: 1px solid var(--color-border); }

    .close-btn {
        background: transparent;
        border: none;
        color: var(--color-muted);
        cursor: pointer;
        padding: var(--space-1);
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: var(--font-size-page-title);
        line-height: 1;
        transition: color var(--duration-fast);
    }
    .close-btn:hover { color: var(--color-foreground); }
</style>
