<script lang="ts">
    import { page } from "$app/state";
    import { ArrowLeft, BookOpen, Loader2, Check, Upload, Circle, AlertTriangle, XCircle, CheckCircle2, Sparkles, GitBranch, RotateCcw, ChevronLeft, ChevronRight, Wrench, X } from "lucide-svelte";
    import ValidationPanel from "$lib/components/builder/ValidationPanel.svelte";
    import { conn } from "$lib/state/gateway";
    import { getToolInfo } from "$lib/data/tool-manifest";
    import ChapterEditor from "$lib/components/builder/ChapterEditor.svelte";
    import ChapterDAG from "$lib/components/builder/ChapterDAG.svelte";
    import EmojiPicker from "$lib/components/builder/EmojiPicker.svelte";
    import {
        skillEditorState, skillEditorDerived,
        initSkillEditor, cleanupSkillEditor, loadGatewayTools, scheduleSave,
        publishSkill, buildSkillWithAI, addChapter, addCondition,
        saveCondition, updateCondition, openConditionOrChapter,
        confirmRemoveChapter, executeDeleteChapter, openChapterEditor,
        saveChapterEdits, connectChapters, deleteEdge, updateChapterPosition,
        handlePublishClick,
        acceptAllProposed, rejectAllProposed,
        acceptProposedChapter, rejectProposedChapter,
        fetchGhostSuggestions, generateGhostChapter,
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

    // Trigger ghost suggestions when description changes (AI-02)
    $effect(() => {
        void skillEditorState.description;
        if (!skillEditorState.loading) fetchGhostSuggestions();
    });

    // ── Sidebar collapse state ────────────────────────────────────────
    let sidebarOpen = $state(true);
</script>

<!-- ── Toolbar ─────────────────────────────────────────────────────── -->
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
        <!-- Save status -->
        <span class="save-indicator" title={skillEditorState.saving ? 'Saving...' : skillEditorState.dirty ? 'Unsaved changes' : 'Saved'}>
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

        <label class="max-cycles-control" title="Maximum cycle iterations">
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
            <span class="hidden sm:inline">Validation</span>
        </button>
        <button
            type="button"
            class="toolbar-btn {skillEditorState.status === 'published' ? 'published' : 'primary'}"
            onclick={handlePublishClick}
            disabled={skillEditorDerived.validationCounts.errors > 0 || skillEditorState.publishing}
            title={skillEditorDerived.validationCounts.errors > 0
                ? `Fix ${skillEditorDerived.validationCounts.errors} error${skillEditorDerived.validationCounts.errors !== 1 ? 's' : ''} before publishing`
                : skillEditorState.status === 'published' ? 'Republish' : 'Publish'}
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

<!-- ── Main layout: sidebar + canvas + optional panels ─────────────── -->
<div class="flex-1 min-h-0 flex">

    {#if skillEditorState.loading}
        <div class="flex-1 flex items-center justify-center">
            <span class="text-muted text-sm">Loading...</span>
        </div>
    {:else}

        <!-- Left sidebar (collapsible) -->
        {#if sidebarOpen}
            <aside class="editor-sidebar">
                <div class="sidebar-content">
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

                    <!-- Ghost chapter suggestions (AI-02) -->
                    {#if skillEditorState.ghostSuggestions.length > 0 || skillEditorState.ghostLoading}
                        <div class="ghost-suggestions">
                            {#if skillEditorState.ghostLoading}
                                <div class="ghost-loading">
                                    <Loader2 size={12} class="loading-spinner" />
                                    <span>Suggesting chapters...</span>
                                </div>
                            {/if}
                            {#each skillEditorState.ghostSuggestions as suggestion (suggestion.name)}
                                <button
                                    class="ghost-pill"
                                    onclick={() => generateGhostChapter(suggestion.name)}
                                    disabled={skillEditorState.aiBuilding}
                                    title={suggestion.description || 'Click to generate this chapter'}
                                >
                                    <Sparkles size={10} />
                                    <span>{suggestion.name}</span>
                                </button>
                            {/each}
                        </div>
                    {/if}

                    <!-- AI Build button -->
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
                                    <span>Building pipeline...</span>
                                {:else}
                                    <Sparkles size={14} />
                                    <span>Build with AI</span>
                                {/if}
                            </button>
                            {#if skillEditorState.aiBuildError}
                                <span class="ai-assist-error">{skillEditorState.aiBuildError}</span>
                            {/if}
                        </div>
                    {/if}

                    <!-- Tool Pool -->
                    <div class="tool-pool-section">
                        <h3 class="section-label">
                            <Wrench size={12} class="inline-block mr-1 opacity-50" />
                            Tool Pool <span class="pool-count">{skillEditorDerived.poolToolIds.length}</span>
                        </h3>
                        {#if skillEditorDerived.poolToolIds.length === 0}
                            <p class="pool-empty-text">
                                Tools appear here as you build chapters
                            </p>
                        {:else}
                            <div class="pool-chips">
                                {#each skillEditorDerived.poolToolIds as toolId (toolId)}
                                    {@const info = getToolInfo(toolId)}
                                    <div class="pool-chip" title={info.description}>
                                        <span class="pool-chip-icon">{info.icon}</span>
                                        <span class="pool-chip-name">{info.name}</span>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </div>
                </div>

                <!-- Sidebar collapse button -->
                <button
                    class="sidebar-collapse-btn"
                    onclick={() => (sidebarOpen = false)}
                    title="Collapse sidebar"
                >
                    <ChevronLeft size={14} />
                </button>
            </aside>
        {:else}
            <!-- Collapsed sidebar: expand button -->
            <button
                class="sidebar-expand-btn"
                onclick={() => (sidebarOpen = true)}
                title="Show sidebar"
            >
                <ChevronRight size={14} />
            </button>
        {/if}

        <!-- Center: DAG canvas (flex-1) -->
        <section class="dag-canvas">
            <!-- First-visit empty state (description prompt in DAG area) -->
            {#if skillEditorState.chapters.length === 0 && !skillEditorState.description.trim()}
                <div class="first-visit-state">
                    <BookOpen size={32} strokeWidth={1.2} class="text-muted/30" />
                    <h3 class="first-visit-title">Describe your skill to get started</h3>
                    <p class="first-visit-desc">Write a description in the sidebar, then use AI to generate your chapter pipeline — or add chapters manually.</p>
                    <div class="first-visit-actions">
                        <button type="button" class="first-visit-btn primary" onclick={() => { sidebarOpen = true; }}>
                            <Sparkles size={14} />
                            Open sidebar to begin
                        </button>
                        <button type="button" class="first-visit-btn ghost" onclick={addChapter}>
                            + Add chapter manually
                        </button>
                    </div>
                </div>
            {:else}
                <ChapterDAG
                    chapters={skillEditorState.chapters}
                    edges={skillEditorState.chapterEdges}
                    validationFindings={skillEditorDerived.validationFindings}
                    stagedProposal={skillEditorState.stagedProposal}
                    onAcceptProposed={acceptProposedChapter}
                    onRejectProposed={rejectProposedChapter}
                    onChapterClick={openConditionOrChapter}
                    onChapterPositionChange={updateChapterPosition}
                    onAddChapter={addChapter}
                    onAddCondition={addCondition}
                    onDeleteChapter={(ch) => confirmRemoveChapter(ch)}
                    onConnect={connectChapters}
                    onDeleteEdge={deleteEdge}
                />
                {#if skillEditorState.stagedProposal}
                    <div class="proposal-batch-actions">
                        <button class="batch-btn accept" onclick={acceptAllProposed}>
                            <Check size={14} />
                            Accept All ({skillEditorState.stagedProposal.chapters.length})
                        </button>
                        <button class="batch-btn reject" onclick={rejectAllProposed}>
                            <X size={14} />
                            Reject All
                        </button>
                    </div>
                {/if}
            {/if}
        </section>

        <!-- Right: Chapter editor drawer (conditional) -->
        {#if skillEditorState.editingChapter}
            <ChapterEditor
                chapter={skillEditorState.editingChapter}
                availableToolIds={skillEditorDerived.allToolIds}
                chapterToolIds={skillEditorState.editingChapterToolIds}
                suggestedToolIds={skillEditorState.suggestedToolMap[skillEditorState.editingChapter.id] ?? []}
                skillName={skillEditorState.name}
                skillDescription={skillEditorState.description}
                onSave={saveChapterEdits}
                onClose={() => { skillEditorState.editingChapter = null; }}
            />
        {/if}

        <!-- Right: Validation panel (conditional) -->
        {#if skillEditorState.showValidation && !skillEditorState.editingChapter}
            <ValidationPanel />
        {/if}
    {/if}
</div>

<!-- ── Delete confirmation modal ───────────────────────────────────── -->
{#if skillEditorState.chapterToDelete}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="confirm-overlay" onclick={(e) => { if (e.target === e.currentTarget) skillEditorState.chapterToDelete = null; }} onkeydown={(e) => { if (e.key === 'Escape') skillEditorState.chapterToDelete = null; }}>
        <div class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title">
            <p class="confirm-title" id="delete-modal-title">Delete "{skillEditorState.chapterToDelete.name}"?</p>
            <p class="confirm-desc">This chapter and its configuration will be permanently removed.</p>
            <div class="confirm-actions">
                <button type="button" class="confirm-btn cancel" onclick={() => { skillEditorState.chapterToDelete = null; }}>Keep Chapter</button>
                <button type="button" class="confirm-btn delete" onclick={executeDeleteChapter}>Delete Chapter</button>
            </div>
        </div>
    </div>
{/if}

<!-- ── Condition modal ─────────────────────────────────────────────── -->
{#if skillEditorState.editingCondition}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="confirm-overlay" onclick={(e) => { if (e.target === e.currentTarget) { skillEditorState.editingCondition = null; } }} onkeydown={(e) => { if (e.key === 'Escape') { skillEditorState.editingCondition = null; } }}>
        <div class="condition-modal" role="dialog" aria-modal="true" aria-labelledby="condition-modal-title">
            <div class="condition-modal-header">
                <GitBranch size={16} class="condition-icon" />
                <span class="condition-modal-title" id="condition-modal-title">{skillEditorState.editingCondition.id ? 'Edit Condition' : 'New Condition'}</span>
                <button type="button" class="close-btn" onclick={() => { skillEditorState.editingCondition = null; }} aria-label="Close">&times;</button>
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
                        class:invalid={skillEditorState.conditionText.trim().length > 0 && !skillEditorDerived.conditionValidation.valid}
                        class:valid-input={skillEditorDerived.conditionValidation.valid}
                        bind:value={skillEditorState.conditionText}
                        placeholder="Is the user authenticated?"
                    />
                    {#if skillEditorState.conditionText.trim().length > 0 && !skillEditorDerived.conditionValidation.valid}
                        <span class="condition-error">
                            <XCircle size={12} />
                            {skillEditorDerived.conditionValidation.reason}
                        </span>
                    {:else if skillEditorDerived.conditionValidation.valid}
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
                    disabled={!skillEditorDerived.conditionValidation.valid}
                    onclick={skillEditorState.editingCondition.id ? updateCondition : saveCondition}
                >{skillEditorState.editingCondition.id ? 'Update' : 'Create'}</button>
            </div>
        </div>
    </div>
{/if}

<style>
    /* ── Toolbar ──────────────────────────────────────────────────────── */
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
    .back-link:hover { color: var(--color-foreground); background: var(--color-bg3); }

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
    .toolbar-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .toolbar-btn.primary { color: white; background: var(--color-accent); }
    .toolbar-btn.primary:hover { filter: brightness(1.1); }
    .toolbar-btn.published {
        color: var(--color-success, #22c55e);
        background: color-mix(in srgb, var(--color-success, #22c55e) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-success, #22c55e) 25%, transparent);
    }
    .toolbar-btn.published:hover { background: color-mix(in srgb, var(--color-success, #22c55e) 20%, transparent); }

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
    :global(.dirty-dot) { color: var(--color-warning, #f59e0b); fill: var(--color-warning, #f59e0b); }
    :global(.saved-check) { color: var(--color-success, #22c55e); }
    :global(.loading-spinner) { color: var(--color-muted); animation: spin 1s linear infinite; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

    .validation-btn.error { color: var(--color-error, #ef4444); border-color: color-mix(in srgb, var(--color-error, #ef4444) 30%, var(--color-border)); background: color-mix(in srgb, var(--color-error, #ef4444) 8%, transparent); }
    .validation-btn.error:hover { background: color-mix(in srgb, var(--color-error, #ef4444) 15%, transparent); }
    .validation-btn.warning { color: var(--color-warning, #f59e0b); border-color: color-mix(in srgb, var(--color-warning, #f59e0b) 30%, var(--color-border)); background: color-mix(in srgb, var(--color-warning, #f59e0b) 8%, transparent); }
    .validation-btn.warning:hover { background: color-mix(in srgb, var(--color-warning, #f59e0b) 15%, transparent); }
    .validation-btn.ok { color: var(--color-success, #22c55e); border-color: color-mix(in srgb, var(--color-success, #22c55e) 30%, var(--color-border)); background: color-mix(in srgb, var(--color-success, #22c55e) 8%, transparent); }
    .validation-btn.ok:hover { background: color-mix(in srgb, var(--color-success, #22c55e) 15%, transparent); }

    .max-cycles-control { display: flex; align-items: center; gap: 0.25rem; cursor: default; color: var(--color-muted); font-size: 0.7rem; }
    .max-cycles-icon { opacity: 0.7; flex-shrink: 0; }
    .max-cycles-input { width: 2.5rem; padding: 0.2rem 0.3rem; font-size: 0.7rem; font-family: inherit; text-align: center; background: var(--color-bg2); border: 1px solid var(--color-border); border-radius: 0.25rem; color: var(--color-foreground); appearance: textfield; -moz-appearance: textfield; }
    .max-cycles-input::-webkit-inner-spin-button, .max-cycles-input::-webkit-outer-spin-button { -webkit-appearance: none; }
    .max-cycles-input:focus { outline: none; border-color: var(--color-accent); }

    /* ── Left sidebar ──────────────────────────────────────────────────── */
    .editor-sidebar {
        width: 280px;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        border-right: 1px solid var(--color-border);
        background: var(--color-bg);
        position: relative;
    }

    .sidebar-content {
        flex: 1;
        overflow-y: auto;
        padding: 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 0.875rem;
    }

    .sidebar-collapse-btn {
        position: absolute;
        bottom: 0.75rem;
        right: -12px;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        color: var(--color-muted);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 5;
        transition: all 0.15s;
    }
    .sidebar-collapse-btn:hover { color: var(--color-foreground); border-color: var(--color-accent); }

    .sidebar-expand-btn {
        width: 24px;
        flex-shrink: 0;
        background: var(--color-bg);
        border: none;
        border-right: 1px solid var(--color-border);
        color: var(--color-muted);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
    }
    .sidebar-expand-btn:hover { color: var(--color-foreground); background: var(--color-bg2); }

    .name-row { display: flex; align-items: center; gap: 0.75rem; }
    .name-input {
        flex: 1;
        width: 100%;
        font-size: 1rem;
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
    .name-input:focus { border-bottom-color: var(--color-accent); }
    .name-input::placeholder { color: var(--color-muted); }

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
    .desc-input:focus { border-color: var(--color-accent); }
    .desc-input::placeholder { color: var(--color-muted); }

    .ai-assist-section { display: flex; flex-direction: column; gap: 0.375rem; }
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
    .ai-assist-btn:hover:not(:disabled) { filter: brightness(1.15); }
    .ai-assist-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .ai-assist-error { font-size: 0.6875rem; color: var(--color-error, #ef4444); }

    /* ── Tool Pool ─────────────────────────────────────────────────────── */
    .tool-pool-section {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        margin-top: 0.25rem;
    }
    .section-label {
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-muted);
        display: flex;
        align-items: center;
    }
    .pool-count {
        font-size: 0.5625rem;
        color: var(--color-muted);
        background: var(--color-bg3);
        padding: 0.0625rem 0.375rem;
        border-radius: 9999px;
        margin-left: 0.25rem;
        font-weight: 500;
    }
    .pool-empty-text {
        font-size: 0.6875rem;
        color: var(--color-muted);
        opacity: 0.6;
        margin: 0;
    }
    .pool-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }
    .pool-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 8px;
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        font-size: 11px;
    }
    .pool-chip-icon { font-size: 12px; }
    .pool-chip-name { color: var(--color-foreground); font-weight: 500; }

    /* ── DAG canvas ────────────────────────────────────────────────────── */
    .dag-canvas {
        flex: 1;
        min-width: 0;
        min-height: 0;
        position: relative;
        display: flex;
        flex-direction: row;
        background: color-mix(in srgb, var(--color-bg2) 30%, var(--color-bg));
    }
    .dag-canvas > :global(:first-child) {
        flex: 1;
        min-width: 0;
    }

    /* ── First-visit empty state ──────────────────────────────────────── */
    .first-visit-state {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        padding: 2rem;
        text-align: center;
    }
    .first-visit-title {
        font-size: 0.9375rem;
        font-weight: 600;
        color: var(--color-foreground);
        margin: 0;
    }
    .first-visit-desc {
        font-size: 0.75rem;
        color: var(--color-muted);
        max-width: 24rem;
        line-height: 1.5;
        margin: 0;
    }
    .first-visit-actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
    .first-visit-btn {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.5rem 0.875rem;
        font-size: 0.75rem;
        font-weight: 600;
        border-radius: 0.375rem;
        cursor: pointer;
        transition: all 0.15s ease;
        font-family: inherit;
        border: none;
    }
    .first-visit-btn.primary { background: var(--color-accent); color: white; }
    .first-visit-btn.primary:hover { filter: brightness(1.15); }
    .first-visit-btn.ghost {
        background: transparent;
        color: var(--color-muted);
        border: 1px solid var(--color-border);
    }
    .first-visit-btn.ghost:hover { color: var(--color-foreground); border-color: var(--color-foreground); }

    /* ── Ghost chapter suggestions (AI-02) ──────────────────────────────── */
    .ghost-suggestions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.375rem;
        padding: 0.25rem 0;
    }
    .ghost-loading {
        display: flex; align-items: center; gap: 0.375rem;
        font-size: 0.6875rem; color: var(--color-muted); opacity: 0.6; width: 100%;
    }
    .ghost-pill {
        display: inline-flex; align-items: center; gap: 0.25rem;
        padding: 0.25rem 0.625rem;
        font-size: 0.6875rem; font-weight: 500; font-family: inherit;
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 4%, transparent);
        border: 1px dashed color-mix(in srgb, var(--color-accent) 25%, transparent);
        border-radius: 9999px;
        cursor: pointer; opacity: 0.55;
        transition: all 0.2s ease;
    }
    .ghost-pill:hover:not(:disabled) {
        opacity: 0.85;
        background: color-mix(in srgb, var(--color-accent) 10%, transparent);
        border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
    }
    .ghost-pill:disabled { cursor: not-allowed; opacity: 0.3; }

    /* ── Proposal batch actions ──────────────────────────────────────────── */
    .proposal-batch-actions {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        z-index: 6;
        display: flex;
        gap: 0.375rem;
    }
    .batch-btn {
        display: flex; align-items: center; gap: 0.375rem;
        padding: 0.375rem 0.75rem;
        font-size: 0.7rem; font-weight: 600;
        border: none; border-radius: 0.375rem;
        cursor: pointer; transition: all 0.15s;
        font-family: inherit;
    }
    .batch-btn.accept { color: white; background: var(--color-success, #22c55e); }
    .batch-btn.accept:hover { filter: brightness(1.1); }
    .batch-btn.reject {
        color: var(--color-error, #ef4444);
        background: color-mix(in srgb, var(--color-error, #ef4444) 10%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-error, #ef4444) 25%, transparent);
    }
    .batch-btn.reject:hover { background: color-mix(in srgb, var(--color-error, #ef4444) 18%, transparent); }

    /* ── Modals ─────────────────────────────────────────────────────────── */
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
    .confirm-title { font-size: 0.875rem; font-weight: 700; color: var(--color-foreground); margin: 0 0 0.375rem; }
    .confirm-desc { font-size: 0.75rem; color: var(--color-muted); margin: 0 0 1rem; line-height: 1.4; }
    .confirm-actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
    .confirm-btn { font-family: inherit; font-size: 0.75rem; font-weight: 600; padding: 0.375rem 0.875rem; border-radius: 0.375rem; cursor: pointer; transition: all 0.15s ease; border: none; }
    .confirm-btn.cancel { background: var(--color-bg2); color: var(--color-muted); border: 1px solid var(--color-border); }
    .confirm-btn.cancel:hover { color: var(--color-foreground); border-color: var(--color-foreground); }
    .confirm-btn.delete { background: var(--color-error, #ef4444); color: white; }
    .confirm-btn.delete:hover { filter: brightness(1.1); }
    .confirm-btn.primary { background: var(--color-accent); color: white; }
    .confirm-btn.primary:hover:not(:disabled) { filter: brightness(1.1); }
    .confirm-btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }

    /* ── Condition modal ───────────────────────────────────────────────── */
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
