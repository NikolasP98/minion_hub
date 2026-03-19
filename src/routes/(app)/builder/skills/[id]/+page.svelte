<script lang="ts">
    import { page } from "$app/state";
    import { ArrowLeft, BookOpen, Loader2, Check, Upload, Circle, AlertTriangle, XCircle, CheckCircle2, Sparkles, GitBranch, RotateCcw } from "lucide-svelte";
    import { conn } from "$lib/state/gateway";
    import { getToolInfo } from "$lib/data/tool-manifest";
    import ChapterEditor from "$lib/components/builder/ChapterEditor.svelte";
    import ChapterDAG from "$lib/components/builder/ChapterDAG.svelte";
    import EmojiPicker from "$lib/components/builder/EmojiPicker.svelte";
    import {
        skillEditorState,
        validationFindings, validationCounts, worstLevel, conditionValidation,
        poolToolIds, allToolIds, validationTooltip,
        initSkillEditor, cleanupSkillEditor, loadGatewayTools, scheduleSave,
        publishSkill, buildSkillWithAI, addChapter, addCondition,
        saveCondition, updateCondition, openConditionOrChapter,
        confirmRemoveChapter, executeDeleteChapter, openChapterEditor,
        saveChapterEdits, connectChapters, deleteEdge, updateChapterPosition,
    } from '$lib/state/builder/skill-editor.svelte';

    const skillId = $derived(page.params.id);

    $effect(() => {
        const id = skillId ?? '';
        initSkillEditor(id);
        return () => cleanupSkillEditor();
    });

    // Reload tools when gateway reconnects
    $effect(() => {
        if (conn.connected) loadGatewayTools();
    });

    // Auto-save on field changes
    $effect(() => {
        void skillEditorState.name;
        void skillEditorState.description;
        void skillEditorState.emoji;
        if (!skillEditorState.loading) scheduleSave();
    });
</script>

<!-- ── Skill Editor Toolbar ─────────────────────────────────────── -->
    <div class="editor-toolbar">
        <div class="flex items-center gap-3 min-w-0">
            <a href="/builder" class="back-link" title="Back to Builder">
                <ArrowLeft size={16} />
            </a>

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
            <!-- Save status indicator -->
            <span class="save-indicator" title={skillEditorState.saving ? 'Saving changes...' : skillEditorState.dirty ? 'Unsaved changes' : 'All changes saved'}>
                {#if skillEditorState.saving}
                    <Loader2 size={12} class="loading-spinner" />
                    <span>Saving...</span>
                {:else if skillEditorState.dirty}
                    <Circle size={8} class="dirty-dot" />
                    <span>Unsaved</span>
                {:else}
                    <Check size={12} class="saved-check" />
                    <span>Saved</span>
                {/if}
            </span>

            <div class="h-4 w-px bg-border/60"></div>

            <label class="max-cycles-control" title="Maximum cycle iterations allowed at runtime">
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
                class="toolbar-btn validation-btn {worstLevel}"
                title={validationTooltip}
                onclick={() => { skillEditorState.showValidation = !skillEditorState.showValidation; }}
            >
                {#if worstLevel === 'error'}
                    <XCircle size={14} />
                {:else if worstLevel === 'warning'}
                    <AlertTriangle size={14} />
                {:else}
                    <CheckCircle2 size={14} />
                {/if}
                <span class="hidden sm:inline">Validation</span>
            </button>
            <button
                type="button"
                class="toolbar-btn {skillEditorState.status === 'published' ? 'published' : 'primary'}"
                onclick={publishSkill}
                disabled={skillEditorState.publishing}
                title={skillEditorState.status === 'published' ? 'Republish with latest changes' : 'Publish to shared space'}
            >
                {#if skillEditorState.publishing}
                    <Loader2 size={14} class="loading-spinner" />
                {:else}
                    <Upload size={14} />
                {/if}
                <span class="hidden sm:inline">{skillEditorState.publishing ? 'Publishing...' : skillEditorState.status === 'published' ? 'Republish' : 'Publish'}</span>
            </button>
        </div>
    </div>

    {#if skillEditorState.publishError}
        <div class="publish-error">
            <XCircle size={14} />
            <span>{skillEditorState.publishError}</span>
            <button type="button" class="publish-error-dismiss" onclick={() => skillEditorState.publishError = null}>&times;</button>
        </div>
    {/if}

    <!-- ── Three-Column Book Layout ─────────────────────────────────── -->
    <div class="flex-1 min-h-0 flex">

        <!-- The "Open Book" spread -->
        <div class="book-spread">

            <!-- Book Left Page: Metadata -->
            <section class="book-page book-page-left">
                {#if skillEditorState.loading}
                    <div class="flex items-center justify-center h-full">
                        <span class="text-muted text-sm">Loading...</span>
                    </div>
                {:else}
                    <div class="page-content">
                        <!-- Emoji + Name -->
                        <div class="name-row">
                            <EmojiPicker value={skillEditorState.emoji} onSelect={(e) => { skillEditorState.emoji = e; }} />
                            <input
                                type="text"
                                class="name-input"
                                bind:value={skillEditorState.name}
                                placeholder="Skill name"
                            />
                        </div>

                        <!-- Description -->
                        <textarea
                            class="desc-input"
                            bind:value={skillEditorState.description}
                            placeholder="Describe what this skill does..."
                            rows="3"
                        ></textarea>

                        <!-- AI Assist: Build entire skill from description -->
                        {#if skillEditorState.description.trim().length >= 10}
                            <div class="ai-assist-section">
                                <button
                                    type="button"
                                    class="ai-assist-btn"
                                    onclick={buildSkillWithAI}
                                    disabled={skillEditorState.aiBuilding}
                                >
                                    {#if skillEditorState.aiBuilding}
                                        <Loader2 size={14} class="loading-spinner" />
                                        <span>Building skill pipeline...</span>
                                    {:else}
                                        <Sparkles size={14} />
                                        <span>Build chapters with AI</span>
                                    {/if}
                                </button>
                                {#if skillEditorState.aiBuildError}
                                    <span class="ai-assist-error">{skillEditorState.aiBuildError}</span>
                                {/if}
                            </div>
                        {/if}

                        <!-- Tool Pool (read-only, aggregated from chapters) -->
                        <div class="tool-pool-section">
                            <h3 class="section-label">Tool Pool <span class="pool-count">{poolToolIds.length}</span></h3>
                            <p class="section-sublabel">
                                Tools used across chapters
                            </p>
                            <div
                                class="tool-pool-drop"
                                class:has-tools={poolToolIds.length > 0}
                                role="list"
                            >
                                {#if poolToolIds.length === 0}
                                    <span class="pool-empty-text">
                                        No tools assigned in any chapter yet
                                    </span>
                                {:else}
                                    {#each poolToolIds as toolId (toolId)}
                                        {@const info = getToolInfo(toolId)}
                                        <div class="pool-card" role="listitem">
                                            <div class="pool-card-top">
                                                <span class="pool-card-icon">{info.icon}</span>
                                                <div class="pool-card-text">
                                                    <span class="pool-card-name">{info.name}</span>
                                                    <span class="pool-card-cat">{info.category}</span>
                                                </div>
                                            </div>
                                            <p class="pool-card-desc">{info.description}</p>
                                        </div>
                                    {/each}
                                {/if}
                            </div>
                        </div>
                    </div>
                {/if}
            </section>

            <!-- Book Spine Divider -->
            <div class="book-spine"></div>

            <!-- Book Right Page: DAG / Subprocesses -->
            <section class="book-page book-page-right dag-page">
                <ChapterDAG
                    chapters={skillEditorState.chapters}
                    edges={skillEditorState.chapterEdges}
                    onChapterClick={openConditionOrChapter}
                    onChapterPositionChange={updateChapterPosition}
                    onAddChapter={addChapter}
                    onAddCondition={addCondition}
                    onDeleteChapter={(ch) => confirmRemoveChapter(ch)}
                    onConnect={connectChapters}
                    onDeleteEdge={deleteEdge}
                />
            </section>

        </div>
    </div>

{#if skillEditorState.chapterToDelete}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="confirm-overlay" role="dialog" aria-modal="true" onclick={(e) => { if (e.target === e.currentTarget) skillEditorState.chapterToDelete = null; }} onkeydown={(e) => { if (e.key === 'Escape') skillEditorState.chapterToDelete = null; }}>
        <div class="confirm-modal">
            <p class="confirm-title">Delete "{skillEditorState.chapterToDelete.name}"?</p>
            <p class="confirm-desc">This chapter and its configuration will be permanently removed.</p>
            <div class="confirm-actions">
                <button type="button" class="confirm-btn cancel" onclick={() => { skillEditorState.chapterToDelete = null; }}>Cancel</button>
                <button type="button" class="confirm-btn delete" onclick={executeDeleteChapter}>Delete</button>
            </div>
        </div>
    </div>
{/if}

{#if skillEditorState.editingChapter}
    <ChapterEditor
        chapter={skillEditorState.editingChapter}
        availableToolIds={allToolIds}
        chapterToolIds={skillEditorState.editingChapterToolIds}
        skillName={skillEditorState.name}
        skillDescription={skillEditorState.description}
        onSave={saveChapterEdits}
        onClose={() => { skillEditorState.editingChapter = null; }}
    />
{/if}

{#if skillEditorState.showValidation}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="confirm-overlay" role="dialog" aria-modal="true" onclick={(e) => { if (e.target === e.currentTarget) skillEditorState.showValidation = false; }} onkeydown={(e) => { if (e.key === 'Escape') skillEditorState.showValidation = false; }}>
        <div class="validation-modal">
            <div class="validation-header">
                <span class="validation-title">Skill Validation</span>
                <button type="button" class="close-btn" onclick={() => { skillEditorState.showValidation = false; }} aria-label="Close">×</button>
            </div>
            <div class="validation-body">
                {#each validationFindings as finding}
                    <div class="validation-row {finding.level}">
                        {#if finding.level === 'error'}
                            <XCircle size={14} class="validation-icon error" />
                        {:else if finding.level === 'warning'}
                            <AlertTriangle size={14} class="validation-icon warning" />
                        {:else}
                            <CheckCircle2 size={14} class="validation-icon ok" />
                        {/if}
                        <span>{finding.message}</span>
                    </div>
                {/each}
            </div>
            <div class="validation-footer">
                <span class="validation-summary">
                    {validationCounts.errors} error{validationCounts.errors !== 1 ? 's' : ''},
                    {validationCounts.warnings} warning{validationCounts.warnings !== 1 ? 's' : ''},
                    {validationCounts.ok} ok
                </span>
                <button type="button" class="confirm-btn cancel" onclick={() => { skillEditorState.showValidation = false; }}>Close</button>
            </div>
        </div>
    </div>
{/if}

{#if skillEditorState.editingCondition}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="confirm-overlay" role="dialog" aria-modal="true" onclick={(e) => { if (e.target === e.currentTarget) { skillEditorState.editingCondition = null; } }} onkeydown={(e) => { if (e.key === 'Escape') { skillEditorState.editingCondition = null; } }}>
        <div class="condition-modal">
            <div class="condition-modal-header">
                <GitBranch size={16} class="condition-icon" />
                <span class="condition-modal-title">{skillEditorState.editingCondition.id ? 'Edit Condition' : 'New Condition'}</span>
                <button type="button" class="close-btn" onclick={() => { skillEditorState.editingCondition = null; }} aria-label="Close">×</button>
            </div>
            <div class="condition-modal-body">
                <div class="condition-field">
                    <label class="condition-label" for="cond-name">Label</label>
                    <input id="cond-name" type="text" class="condition-input" bind:value={skillEditorState.conditionName} placeholder="e.g. Sufficient Data?" />
                </div>
                <div class="condition-field">
                    <label class="condition-label" for="cond-text">Condition <span class="required">*</span></label>
                    <span class="condition-helper">Binary yes/no question the agent evaluates at runtime</span>
                    <input
                        id="cond-text"
                        type="text"
                        class="condition-input"
                        class:invalid={skillEditorState.conditionText.trim().length > 0 && !conditionValidation.valid}
                        class:valid-input={conditionValidation.valid}
                        bind:value={skillEditorState.conditionText}
                        placeholder="Is the user authenticated?"
                    />
                    {#if skillEditorState.conditionText.trim().length > 0 && !conditionValidation.valid}
                        <span class="condition-error">
                            <XCircle size={12} />
                            {conditionValidation.reason}
                        </span>
                    {:else if conditionValidation.valid}
                        <span class="condition-valid">
                            <CheckCircle2 size={12} />
                            Valid binary condition
                        </span>
                    {/if}
                </div>
            </div>
            <div class="condition-modal-footer">
                <button type="button" class="confirm-btn cancel" onclick={() => { skillEditorState.editingCondition = null; }}>Cancel</button>
                <button
                    type="button"
                    class="confirm-btn primary"
                    disabled={!conditionValidation.valid}
                    onclick={skillEditorState.editingCondition.id ? updateCondition : saveCondition}
                >{skillEditorState.editingCondition.id ? 'Update' : 'Create'}</button>
            </div>
        </div>
    </div>
{/if}

<style>
    /* ── Publish Error Banner ────────────────────────────────────────── */
    .publish-error {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        background: color-mix(in srgb, var(--color-error) 12%, transparent);
        border-bottom: 1px solid color-mix(in srgb, var(--color-error) 30%, transparent);
        color: var(--color-error);
        font-size: 0.8125rem;
    }
    .publish-error span { flex: 1; }
    .publish-error-dismiss {
        background: none;
        border: none;
        color: var(--color-error);
        cursor: pointer;
        font-size: 1rem;
        padding: 0 0.25rem;
        opacity: 0.7;
    }
    .publish-error-dismiss:hover { opacity: 1; }

    /* ── Editor Toolbar ──────────────────────────────────────────────── */
    .editor-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 2.75rem;
        padding: 0 0.75rem;
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
        border-radius: 0.375rem;
        color: var(--color-muted);
        transition: all 0.15s ease;
    }

    .back-link:hover {
        color: var(--color-foreground);
        background: var(--color-bg3);
    }

    .status-badge {
        display: inline-flex;
        align-items: center;
        padding: 0.125rem 0.5rem;
        border-radius: 9999px;
        font-size: 0.625rem;
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
        gap: 0.375rem;
        padding: 0.375rem 0.625rem;
        border-radius: 0.375rem;
        font-size: 0.75rem;
        font-weight: 500;
        border: none;
        cursor: pointer;
        transition: all 0.15s ease;
        font-family: inherit;
    }

    .toolbar-btn.secondary {
        color: var(--color-muted);
        background: transparent;
        border: 1px solid var(--color-border);
    }

    .toolbar-btn.secondary:hover {
        color: var(--color-foreground);
        background: var(--color-bg3);
    }

    .toolbar-btn.primary {
        color: white;
        background: var(--color-accent);
    }

    .toolbar-btn.primary:hover {
        filter: brightness(1.1);
    }

    .toolbar-btn.published {
        color: var(--color-success, #22c55e);
        background: color-mix(in srgb, var(--color-success, #22c55e) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-success, #22c55e) 25%, transparent);
    }

    .toolbar-btn.published:hover {
        background: color-mix(in srgb, var(--color-success, #22c55e) 20%, transparent);
    }

    /* ── Save Indicator ────────────────────────────────────────────── */
    .save-indicator {
        display: flex;
        align-items: center;
        gap: 0.3125rem;
        font-size: 0.6875rem;
        color: var(--color-muted);
        white-space: nowrap;
        padding: 0.25rem 0.5rem;
        border-radius: 0.375rem;
        user-select: none;
    }

    :global(.dirty-dot) {
        color: var(--color-warning, #f59e0b);
        fill: var(--color-warning, #f59e0b);
    }

    :global(.saved-check) {
        color: var(--color-success, #22c55e);
    }

    :global(.loading-spinner) {
        color: var(--color-muted);
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    /* ── Book Spread ─────────────────────────────────────────────────── */
    .book-spread {
        flex: 1;
        display: flex;
        min-width: 0;
    }

    .book-page {
        flex: 1;
        overflow-y: auto;
        min-width: 0;
    }

    .book-page-left {
        background: var(--color-bg);
    }

    .book-page-right {
        background: color-mix(in srgb, var(--color-bg2) 30%, var(--color-bg));
    }

    .dag-page {
        padding: 0;
        position: relative;
    }

    .book-spine {
        width: 1px;
        background: var(--color-border);
        flex-shrink: 0;
        position: relative;
    }

    .book-spine::before {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        left: -3px;
        right: -3px;
        background: linear-gradient(
            to right,
            transparent,
            color-mix(in srgb, var(--color-border) 20%, transparent) 40%,
            color-mix(in srgb, var(--color-border) 40%, transparent) 50%,
            color-mix(in srgb, var(--color-border) 20%, transparent) 60%,
            transparent
        );
        pointer-events: none;
    }

    .page-content {
        padding: 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    /* ── Emoji Picker ────────────────────────────────────────────────── */
    .emoji-picker {
        width: 3.5rem;
        height: 3.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 0.75rem;
        border: 2px dashed var(--color-border);
        background: var(--color-bg2);
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .emoji-picker:hover {
        border-color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 6%, transparent);
    }

    .emoji-display {
        font-size: 1.75rem;
        line-height: 1;
    }

    /* ── Name Row ───────────────────────────────────────────────────── */
    .name-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    .name-input {
        flex: 1;
        width: 100%;
        font-size: 1.25rem;
        font-weight: 700;
        color: var(--color-foreground);
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        padding: 0.25rem 0;
        outline: none;
        font-family: inherit;
        transition: border-color 0.15s ease;
    }

    .name-input:focus {
        border-bottom-color: var(--color-accent);
    }

    .name-input::placeholder {
        color: var(--color-muted);
    }

    /* ── Description Textarea ────────────────────────────────────────── */
    .desc-input {
        width: 100%;
        font-size: 0.8125rem;
        color: var(--color-foreground);
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 0.5rem;
        padding: 0.625rem 0.75rem;
        outline: none;
        resize: vertical;
        font-family: inherit;
        line-height: 1.5;
        transition: border-color 0.15s ease;
    }

    .desc-input:focus {
        border-color: var(--color-accent);
    }

    .desc-input::placeholder {
        color: var(--color-muted);
    }

    /* ── Tool Pool Section ───────────────────────────────────────────── */
    .section-label {
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-muted);
    }

    .section-sublabel {
        font-size: 0.6875rem;
        color: var(--color-muted-foreground);
        margin-top: -0.5rem;
    }

    .tool-pool-section {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-top: 0.5rem;
    }

    .pool-count {
        font-size: 0.5625rem;
        color: var(--color-muted);
        background: var(--color-bg3);
        padding: 0.0625rem 0.375rem;
        border-radius: 9999px;
        margin-left: 0.25rem;
        font-weight: 500;
        vertical-align: middle;
    }

    .tool-pool-drop {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        min-height: 3.5rem;
        border: 2px dashed var(--color-border);
        border-radius: 0.5rem;
        padding: 0.625rem;
        transition: all 0.15s ease;
    }

    .tool-pool-drop.has-tools {
        border-style: solid;
        border-color: var(--color-border);
    }

    .pool-empty-text {
        font-size: 0.6875rem;
        color: var(--color-muted);
        width: 100%;
        text-align: center;
    }

    .pool-card {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        padding: 0.5rem 0.625rem;
        border-radius: 0.5rem;
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        transition: all 0.1s ease;
        width: 100%;
    }

    .pool-card:hover {
        border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
    }

    .pool-card-top {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .pool-card-icon {
        font-size: 1rem;
        line-height: 1;
        flex-shrink: 0;
    }

    .pool-card-text {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: baseline;
        gap: 0.375rem;
    }

    .pool-card-name {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--color-foreground);
        white-space: nowrap;
    }

    .pool-card-cat {
        font-size: 0.5625rem;
        color: var(--color-muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        opacity: 0.7;
    }

    .pool-card-desc {
        font-size: 0.625rem;
        color: var(--color-muted);
        line-height: 1.35;
        margin: 0;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
    }

    /* ── Chapters / DAG (Right Page) ─────────────────────────────────── */
    .chapters-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 12rem;
        border: 2px dashed var(--color-border);
        border-radius: 0.5rem;
        padding: 1.5rem;
        margin-top: 0.5rem;
    }

    .add-chapter-btn {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        margin-top: 1rem;
        padding: 0.375rem 0.75rem;
        border-radius: 0.5rem;
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 10%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-accent) 25%, transparent);
        cursor: pointer;
        transition: all 0.15s ease;
        font-family: inherit;
    }

    .add-chapter-btn:hover {
        background: color-mix(in srgb, var(--color-accent) 18%, transparent);
        border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
    }

    /* (Chapter cards replaced by ChapterDAG canvas) */

    /* ── Delete Confirmation Modal ─────────────────────────────────── */
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

    .confirm-modal {
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 0.75rem;
        padding: 1.25rem 1.5rem;
        max-width: 340px;
        width: 100%;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
    }

    .confirm-title {
        font-size: 0.875rem;
        font-weight: 700;
        color: var(--color-foreground);
        margin: 0 0 0.375rem;
    }

    .confirm-desc {
        font-size: 0.75rem;
        color: var(--color-muted);
        margin: 0 0 1rem;
        line-height: 1.4;
    }

    .confirm-actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
    }

    .confirm-btn {
        font-family: inherit;
        font-size: 0.75rem;
        font-weight: 600;
        padding: 0.375rem 0.875rem;
        border-radius: 0.375rem;
        cursor: pointer;
        transition: all 0.15s ease;
        border: none;
    }

    .confirm-btn.cancel {
        background: var(--color-bg2);
        color: var(--color-muted);
        border: 1px solid var(--color-border);
    }

    .confirm-btn.cancel:hover {
        color: var(--color-foreground);
        border-color: var(--color-foreground);
    }

    .confirm-btn.delete {
        background: var(--color-error, #ef4444);
        color: white;
    }

    .confirm-btn.delete:hover {
        filter: brightness(1.1);
    }

    /* ── Validation Button ───────────────────────────────────────────── */
    .validation-btn.error {
        color: var(--color-error, #ef4444);
        border-color: color-mix(in srgb, var(--color-error, #ef4444) 30%, var(--color-border));
        background: color-mix(in srgb, var(--color-error, #ef4444) 8%, transparent);
    }

    .validation-btn.error:hover {
        background: color-mix(in srgb, var(--color-error, #ef4444) 15%, transparent);
    }

    .validation-btn.warning {
        color: var(--color-warning, #f59e0b);
        border-color: color-mix(in srgb, var(--color-warning, #f59e0b) 30%, var(--color-border));
        background: color-mix(in srgb, var(--color-warning, #f59e0b) 8%, transparent);
    }

    .validation-btn.warning:hover {
        background: color-mix(in srgb, var(--color-warning, #f59e0b) 15%, transparent);
    }

    .validation-btn.ok {
        color: var(--color-success, #22c55e);
        border-color: color-mix(in srgb, var(--color-success, #22c55e) 30%, var(--color-border));
        background: color-mix(in srgb, var(--color-success, #22c55e) 8%, transparent);
    }

    .validation-btn.ok:hover {
        background: color-mix(in srgb, var(--color-success, #22c55e) 15%, transparent);
    }

    /* ── Max Cycles Control ──────────────────────────────────────────── */
    .max-cycles-control {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        cursor: default;
        color: var(--color-muted);
        font-size: 0.7rem;
    }

    .max-cycles-icon {
        opacity: 0.7;
        flex-shrink: 0;
    }

    .max-cycles-input {
        width: 2.5rem;
        padding: 0.2rem 0.3rem;
        font-size: 0.7rem;
        font-family: inherit;
        text-align: center;
        background: var(--color-bg2, #1a1a2e);
        border: 1px solid var(--color-border);
        border-radius: 0.25rem;
        color: var(--color-foreground);
        appearance: textfield;
        -moz-appearance: textfield;
    }

    .max-cycles-input::-webkit-inner-spin-button,
    .max-cycles-input::-webkit-outer-spin-button {
        -webkit-appearance: none;
    }

    .max-cycles-input:focus {
        outline: none;
        border-color: var(--color-accent);
    }

    /* ── Validation Modal ────────────────────────────────────────────── */
    .validation-modal {
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 0.75rem;
        max-width: 420px;
        width: 100%;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
        display: flex;
        flex-direction: column;
    }

    .validation-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.875rem 1.25rem;
        border-bottom: 1px solid var(--color-border);
    }

    .validation-title {
        font-size: 0.875rem;
        font-weight: 700;
        color: var(--color-foreground);
    }

    .close-btn {
        background: none;
        border: none;
        color: var(--color-muted);
        cursor: pointer;
        font-size: 1.125rem;
        line-height: 1;
        padding: 0.25rem;
        border-radius: 0.25rem;
        transition: color 0.15s ease;
    }

    .close-btn:hover {
        color: var(--color-foreground);
    }

    .validation-body {
        padding: 0.75rem 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        max-height: 50vh;
        overflow-y: auto;
    }

    .validation-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.375rem 0.5rem;
        border-radius: 0.375rem;
        font-size: 0.75rem;
        color: var(--color-foreground);
    }

    .validation-row.error {
        background: color-mix(in srgb, var(--color-error, #ef4444) 8%, transparent);
    }

    .validation-row.warning {
        background: color-mix(in srgb, var(--color-warning, #f59e0b) 8%, transparent);
    }

    .validation-row.ok {
        background: color-mix(in srgb, var(--color-success, #22c55e) 6%, transparent);
        color: var(--color-muted);
    }

    :global(.validation-icon.error) {
        color: var(--color-error, #ef4444);
        flex-shrink: 0;
    }

    :global(.validation-icon.warning) {
        color: var(--color-warning, #f59e0b);
        flex-shrink: 0;
    }

    :global(.validation-icon.ok) {
        color: var(--color-success, #22c55e);
        flex-shrink: 0;
    }

    .validation-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.75rem 1.25rem;
        border-top: 1px solid var(--color-border);
    }

    .validation-summary {
        font-size: 0.6875rem;
        color: var(--color-muted);
    }

    /* ── AI Assist Button ────────────────────────────────────────────── */
    .ai-assist-section {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
    }

    .ai-assist-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.5rem 0.875rem;
        font-size: 0.75rem;
        font-weight: 600;
        color: white;
        background: var(--color-accent);
        border: none;
        border-radius: 0.375rem;
        cursor: pointer;
        transition: all 0.15s ease;
        font-family: inherit;
        align-self: flex-start;
    }

    .ai-assist-btn:hover:not(:disabled) {
        filter: brightness(1.15);
    }

    .ai-assist-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .ai-assist-error {
        font-size: 0.6875rem;
        color: var(--color-error, #ef4444);
    }

    /* ── Condition Modal ─────────────────────────────────────────────── */
    .condition-modal {
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 0.75rem;
        max-width: 440px;
        width: 100%;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
        display: flex;
        flex-direction: column;
    }

    .condition-modal-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.875rem 1.25rem;
        border-bottom: 1px solid var(--color-border);
    }

    :global(.condition-icon) {
        color: var(--color-warning, #f59e0b);
        flex-shrink: 0;
    }

    .condition-modal-title {
        font-size: 0.875rem;
        font-weight: 700;
        color: var(--color-foreground);
        flex: 1;
    }

    .condition-modal-body {
        padding: 1rem 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .condition-field {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .condition-label {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--color-foreground);
    }

    .required {
        color: var(--color-accent);
    }

    .condition-helper {
        font-size: 0.6875rem;
        color: var(--color-muted);
    }

    .condition-input {
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 0.375rem;
        color: var(--color-foreground);
        font-family: inherit;
        font-size: 0.8125rem;
        padding: 0.5rem 0.625rem;
        outline: none;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }

    .condition-input:focus {
        border-color: var(--color-accent);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 20%, transparent);
    }

    .condition-input.invalid {
        border-color: var(--color-error, #ef4444);
    }

    .condition-input.invalid:focus {
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-error, #ef4444) 20%, transparent);
    }

    .condition-input.valid-input {
        border-color: var(--color-success, #22c55e);
    }

    .condition-error {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        font-size: 0.6875rem;
        color: var(--color-error, #ef4444);
    }

    .condition-valid {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        font-size: 0.6875rem;
        color: var(--color-success, #22c55e);
    }

    .condition-modal-footer {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
        padding: 0.75rem 1.25rem;
        border-top: 1px solid var(--color-border);
    }

    .confirm-btn.primary {
        background: var(--color-accent);
        color: white;
    }

    .confirm-btn.primary:hover:not(:disabled) {
        filter: brightness(1.1);
    }

    .confirm-btn.primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
</style>
