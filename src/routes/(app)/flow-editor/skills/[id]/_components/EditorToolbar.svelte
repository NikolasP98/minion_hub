<script lang="ts">
    import { ArrowLeft, BookOpen, Loader2, Check, Upload, Circle, AlertTriangle, XCircle, CheckCircle2, RotateCcw, Wrench, X, FlaskConical } from "lucide-svelte";
    import {
        skillEditorState, skillEditorDerived,
        scheduleSave, handlePublishClick, clearDryRun,
    } from '$lib/state/builder/skill-editor.svelte';
    import * as m from '$lib/paraglide/messages';
    import { createBackNav } from '$lib/nav/back-nav.svelte';

    const back = createBackNav('/flow-editor', () => 'Flows');

    let { showDryRun = $bindable() }: { showDryRun: boolean } = $props();
</script>

<div class="editor-toolbar">
    <div class="flex items-center gap-3 min-w-0">
        <button type="button" onclick={back.go} class="back-link" title="Back to Flows">
            <ArrowLeft size={16} />
        </button>

        <div class="h-5 w-px bg-border/60 shrink-0"></div>

        <div class="flex items-center gap-2 min-w-0">
            <BookOpen size={16} class="text-accent shrink-0" />
            <span class="text-sm font-semibold text-foreground truncate">
                {skillEditorState.name}
            </span>
            <span class="status-badge {skillEditorState.status}">
                {skillEditorState.status}
            </span>
        </div>
    </div>

    <div class="flex items-center gap-2">
        <!-- Save status -->
        <span class="save-indicator" title={skillEditorState.saving ? m.builder_saving() : skillEditorState.dirty ? m.builder_unsavedChanges() : m.builder_saved()}>
            {#if skillEditorState.saving}
                <Loader2 size={12} class="loading-spinner" />
                <span>{m.builder_saving()}</span>
            {:else if skillEditorState.dirty}
                <Circle size={8} class="dirty-dot" />
                <span>{m.builder_unsaved()}</span>
            {:else}
                <Check size={12} class="saved-check" />
                <span>{m.builder_saved()}</span>
            {/if}
        </span>

        <div class="h-4 w-px bg-border/60"></div>

        <label class="max-cycles-control" title={m.builder_maxCycleIterations()}>
            <RotateCcw size={12} class="max-cycles-icon" />
            <input
                type="number"
                min="1"
                max="20"
                class="max-cycles-input"
                value={skillEditorState.maxCycles}
                oninput={(e) => { skillEditorState.maxCycles = Math.max(1, parseInt((e.target as HTMLInputElement).value) || 1); scheduleSave(); }}
            />
        </label>

        <div class="h-4 w-px bg-border/60"></div>

        <button
            type="button"
            class="toolbar-btn {showDryRun ? 'active' : ''}"
            title={m.builder_testRunSkill()}
            onclick={() => { showDryRun = !showDryRun; if (!showDryRun) clearDryRun(); }}
        >
            <FlaskConical size={14} />
            <span class="hidden sm:inline">{m.builder_test()}</span>
        </button>

        <button
            type="button"
            class="toolbar-btn validation-btn {skillEditorDerived.worstLevel}"
            title={skillEditorDerived.validationTooltip}
            onclick={() => { skillEditorState.showValidation = !skillEditorState.showValidation; }}
        >
            {#if skillEditorDerived.worstLevel === 'error'}
                <XCircle size={14} />
            {:else if skillEditorDerived.worstLevel === 'warning'}
                <AlertTriangle size={14} />
            {:else}
                <CheckCircle2 size={14} />
            {/if}
            <span class="hidden sm:inline">{m.builder_validationTitle()}</span>
        </button>
        <button
            type="button"
            class="toolbar-btn {skillEditorState.status === 'published' ? 'published' : 'primary'}"
            onclick={handlePublishClick}
            disabled={skillEditorDerived.validationCounts.errors > 0 || skillEditorState.publishing}
            title={skillEditorDerived.validationCounts.errors > 0
                ? m.builder_fixErrorsBeforePublish({ count: skillEditorDerived.validationCounts.errors })
                : skillEditorState.status === 'published' ? m.builder_republish() : m.builder_publish()}
        >
            {#if skillEditorState.publishing}
                <Loader2 size={14} class="loading-spinner" />
            {:else}
                <Upload size={14} />
            {/if}
            <span class="hidden sm:inline">{skillEditorState.publishing ? m.builder_publishing() : skillEditorState.status === 'published' ? m.builder_republish() : m.builder_publish()}</span>
        </button>
    </div>
</div>

<style>
    .editor-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 2.75rem;
        padding: 0 var(--space-3);
        background: var(--color-bg2);
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
    }

    .back-link {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        border-radius: var(--radius-md);
        color: var(--color-muted);
        transition: all var(--duration-fast) var(--ease-standard);
        background: none;
        border: none;
        cursor: pointer;
    }
    .back-link:hover { color: var(--color-foreground); background: var(--color-bg3); }

    .status-badge {
        display: inline-flex;
        align-items: center;
        padding: var(--space-0-5) var(--space-2);
        border-radius: var(--radius-full);
        font-size: var(--font-size-telemetry);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        flex-shrink: 0;
    }
    .status-badge.draft {
        color: var(--color-warning);
        background: color-mix(in srgb, var(--color-warning) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-warning) 25%, transparent);
    }
    .status-badge.published {
        color: var(--color-success);
        background: color-mix(in srgb, var(--color-success) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-success) 25%, transparent);
    }

    .toolbar-btn {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-2);
        border-radius: var(--radius-md);
        font-size: var(--font-size-caption);
        font-weight: 500;
        border: none;
        cursor: pointer;
        transition: all var(--duration-fast) var(--ease-standard);
        font-family: inherit;
    }
    .toolbar-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .toolbar-btn.active { color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 12%, transparent); border: 1px solid color-mix(in srgb, var(--color-accent) 25%, transparent); }
    .toolbar-btn.primary { color: white; background: var(--color-accent); }
    .toolbar-btn.primary:hover { filter: brightness(1.1); }
    .toolbar-btn.published {
        color: var(--color-success, var(--color-success-fg));
        background: color-mix(in srgb, var(--color-success, var(--color-success-fg)) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-success, var(--color-success-fg)) 25%, transparent);
    }
    .toolbar-btn.published:hover { background: color-mix(in srgb, var(--color-success, var(--color-success-fg)) 20%, transparent); }

    .save-indicator {
        display: flex;
        align-items: center;
        gap: var(--space-1);
        font-size: var(--font-size-caption);
        color: var(--color-muted);
        white-space: nowrap;
        padding: var(--space-1) var(--space-2);
        border-radius: var(--radius-md);
        user-select: none;
    }
    :global(.dirty-dot) { color: var(--color-warning, var(--color-warning-fg)); fill: var(--color-warning, var(--color-warning-fg)); }
    :global(.saved-check) { color: var(--color-success, var(--color-success-fg)); }
    :global(.loading-spinner) { color: var(--color-muted); animation: spin 1s linear infinite; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

    .validation-btn.error { color: var(--color-danger-fg); border-color: var(--color-danger-border); background: var(--color-danger-surface); }
    .validation-btn.error:hover { background: var(--color-danger-surface); }
    .validation-btn.warning { color: var(--color-warning, var(--color-warning-fg)); border-color: color-mix(in srgb, var(--color-warning, var(--color-warning-fg)) 30%, var(--color-border)); background: color-mix(in srgb, var(--color-warning, var(--color-warning-fg)) 8%, transparent); }
    .validation-btn.warning:hover { background: color-mix(in srgb, var(--color-warning, var(--color-warning-fg)) 15%, transparent); }
    .validation-btn.ok { color: var(--color-success, var(--color-success-fg)); border-color: color-mix(in srgb, var(--color-success, var(--color-success-fg)) 30%, var(--color-border)); background: color-mix(in srgb, var(--color-success, var(--color-success-fg)) 8%, transparent); }
    .validation-btn.ok:hover { background: color-mix(in srgb, var(--color-success, var(--color-success-fg)) 15%, transparent); }

    .max-cycles-control { display: flex; align-items: center; gap: var(--space-1); cursor: default; color: var(--color-muted); font-size: var(--font-size-caption); }
    .max-cycles-icon { opacity: 0.7; flex-shrink: 0; }
    .max-cycles-input { width: 2.5rem; padding: var(--space-1) var(--space-1); font-size: var(--font-size-caption); font-family: inherit; text-align: center; background: var(--color-bg2); border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-foreground); appearance: textfield; -moz-appearance: textfield; }
    .max-cycles-input::-webkit-inner-spin-button, .max-cycles-input::-webkit-outer-spin-button { -webkit-appearance: none; }
    .max-cycles-input:focus { outline: none; border-color: var(--color-accent); }
</style>
