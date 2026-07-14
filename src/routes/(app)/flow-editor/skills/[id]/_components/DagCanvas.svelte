<script lang="ts">
  import { Button } from '$lib/components/ui';
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
                <Button variant="ghost" type="button" class="first-visit-btn primary" onclick={() => { sidebarOpen = true; }}>
                    <Sparkles size={14} />
                    {m.builder_openSidebarToBegin()}
                </Button>
                <Button variant="ghost" type="button" class="first-visit-btn ghost" onclick={addChapter}>
                    + {m.builder_addChapterManually()}
                </Button>
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
                <Button variant="ghost" class="batch-btn accept" onclick={acceptAllProposed}>
                    <Check size={14} />
                    {m.builder_acceptAll({ count: skillEditorState.stagedProposal.chapters.length })}
                </Button>
                <Button variant="ghost" class="batch-btn reject" onclick={rejectAllProposed}>
                    <X size={14} />
                    {m.builder_rejectAll()}
                </Button>
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
        gap: var(--space-3);
        padding: var(--space-8);
        text-align: center;
    }
    .first-visit-title {
        font-size: var(--font-size-page-title);
        font-weight: 600;
        color: var(--color-foreground);
        margin: 0;
    }
    .first-visit-desc {
        font-size: var(--font-size-caption);
        color: var(--color-muted);
        max-width: 24rem;
        line-height: 1.5;
        margin: 0;
    }
    .first-visit-actions { display: flex; gap: var(--space-2); margin-top: var(--space-2); }
    .first-visit-actions :global(.first-visit-btn) {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-3);
        font-size: var(--font-size-caption);
        font-weight: 600;
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: all var(--duration-fast) var(--ease-standard);
        font-family: inherit;
        border: none;
    }
    .first-visit-actions :global(.first-visit-btn.primary) { background: var(--color-accent); color: white; }
    .first-visit-actions :global(.first-visit-btn.primary):hover { filter: brightness(1.15); }
    .first-visit-actions :global(.first-visit-btn.ghost) {
        background: transparent;
        color: var(--color-muted);
        border: 1px solid var(--color-border);
    }
    .first-visit-actions :global(.first-visit-btn.ghost):hover { color: var(--color-foreground); border-color: var(--color-foreground); }

    /* Proposal batch actions */
    .proposal-batch-actions {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        z-index: var(--layer-sticky);
        display: flex;
        gap: var(--space-2);
    }
    .proposal-batch-actions :global(.batch-btn) {
        display: flex; align-items: center; gap: var(--space-2);
        padding: var(--space-2) var(--space-3);
        font-size: var(--font-size-caption); font-weight: 600;
        border: none; border-radius: var(--radius-md);
        cursor: pointer; transition: all var(--duration-fast) var(--ease-standard);
        font-family: inherit;
    }
    .proposal-batch-actions :global(.batch-btn.accept) { color: white; background: var(--color-success, var(--color-success-fg)); }
    .proposal-batch-actions :global(.batch-btn.accept):hover { filter: brightness(1.1); }
    .proposal-batch-actions :global(.batch-btn.reject) {
        color: var(--color-danger-fg);
        background: var(--color-danger-surface);
        border: 1px solid var(--color-danger-border);
    }
    .proposal-batch-actions :global(.batch-btn.reject):hover { background: var(--color-danger-surface); }
</style>
