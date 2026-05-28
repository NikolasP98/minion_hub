<script lang="ts">
    import { BookOpen, Check, Sparkles, X } from "lucide-svelte";
    import ChapterDAG from "$lib/components/builder/ChapterDAG.svelte";
    import {
        skillEditorState, skillEditorDerived,
        addChapter, addCondition,
        openConditionOrChapter,
        confirmRemoveChapter,
        connectChapters, deleteEdge, updateChapterPosition,
        acceptAllProposed, rejectAllProposed,
        acceptProposedChapter, rejectProposedChapter,
    } from '$lib/state/builder/skill-editor.svelte';
    import * as m from '$lib/paraglide/messages';

    let { sidebarOpen = $bindable() }: { sidebarOpen: boolean } = $props();
</script>

<section class="dag-canvas">
    <!-- First-visit empty state (description prompt in DAG area) -->
    {#if skillEditorState.chapters.length === 0 && !skillEditorState.description.trim()}
        <div class="first-visit-state">
            <BookOpen size={32} strokeWidth={1.2} class="text-muted/30" />
            <h3 class="first-visit-title">{m.builder_firstVisitTitle()}</h3>
            <p class="first-visit-desc">{m.builder_firstVisitDesc()}</p>
            <div class="first-visit-actions">
                <button type="button" class="first-visit-btn primary" onclick={() => { sidebarOpen = true; }}>
                    <Sparkles size={14} />
                    {m.builder_openSidebarToBegin()}
                </button>
                <button type="button" class="first-visit-btn ghost" onclick={addChapter}>
                    + {m.builder_addChapterManually()}
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
                    {m.builder_acceptAll({ count: skillEditorState.stagedProposal.chapters.length })}
                </button>
                <button class="batch-btn reject" onclick={rejectAllProposed}>
                    <X size={14} />
                    {m.builder_rejectAll()}
                </button>
            </div>
        {/if}
    {/if}
</section>

<style>
    /* DAG canvas */
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

    /* First-visit empty state */
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

    /* Proposal batch actions */
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
</style>
