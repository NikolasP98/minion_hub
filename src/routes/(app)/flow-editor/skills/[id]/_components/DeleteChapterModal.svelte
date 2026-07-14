<script lang="ts">
    import {
        skillEditorState, executeDeleteChapter,
    } from '$lib/state/builder/skill-editor.svelte';
    import * as m from '$lib/paraglide/messages';
</script>

{#if skillEditorState.chapterToDelete}
    <div class="confirm-overlay" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) skillEditorState.chapterToDelete = null; }} onkeydown={(e) => { if (e.key === 'Escape') skillEditorState.chapterToDelete = null; }}>
        <div class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title">
            <p class="confirm-title" id="delete-modal-title">Delete "{skillEditorState.chapterToDelete.name}"?</p>
            <p class="confirm-desc">{m.builder_deleteChapterDesc()}</p>
            <div class="confirm-actions">
                <button type="button" class="confirm-btn cancel" onclick={() => { skillEditorState.chapterToDelete = null; }}>{m.builder_keepChapter()}</button>
                <button type="button" class="confirm-btn delete" onclick={executeDeleteChapter}>{m.builder_deleteChapterBtn()}</button>
            </div>
        </div>
    </div>
{/if}

<style>
    .confirm-overlay {
        position: fixed;
        inset: 0;
        z-index: var(--layer-debug);
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(2px);
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .confirm-modal {
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        padding: var(--space-6) var(--space-6);
        max-width: 340px;
        width: 100%;
        box-shadow: var(--shadow-overlay);
    }
    .confirm-title { font-size: var(--font-size-body); font-weight: 700; color: var(--color-foreground); margin: 0 0 var(--space-2); }
    .confirm-desc { font-size: var(--font-size-caption); color: var(--color-muted); margin: 0 0 var(--space-4); line-height: 1.4; }
    .confirm-actions { display: flex; justify-content: flex-end; gap: var(--space-2); }
    .confirm-btn { font-family: inherit; font-size: var(--font-size-caption); font-weight: 600; padding: var(--space-2) var(--space-3); border-radius: var(--radius-md); cursor: pointer; transition: all var(--duration-fast) var(--ease-standard); border: none; }
    .confirm-btn.cancel { background: var(--color-bg2); color: var(--color-muted); border: 1px solid var(--color-border); }
    .confirm-btn.cancel:hover { color: var(--color-foreground); border-color: var(--color-foreground); }
    .confirm-btn.delete { background: var(--color-danger-fg); color: white; }
    .confirm-btn.delete:hover { filter: brightness(1.1); }
</style>
