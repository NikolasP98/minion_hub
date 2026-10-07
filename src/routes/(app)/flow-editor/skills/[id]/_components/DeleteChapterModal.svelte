<script lang="ts">
  import { Button } from '$lib/components/ui';
  import { Dialog } from '$lib/components/ui/foundations';
  import { skillEditorState, executeDeleteChapter } from '$lib/state/builder/skill-editor.svelte';
  import * as m from '$lib/paraglide/messages';
</script>

<!-- HC-028: the shared native <dialog> contract owns modality, Escape,
     backdrop dismissal, scroll lock and focus return. -->
{#if skillEditorState.chapterToDelete}
  <Dialog
    open={true}
    title={`Delete "${skillEditorState.chapterToDelete.name}"?`}
    size="sm"
    onclose={() => {
      skillEditorState.chapterToDelete = null;
    }}
  >
    <p class="confirm-desc">{m.builder_deleteChapterDesc()}</p>
    {#snippet footer()}
      <Button
        variant="ghost"
        type="button"
        class="confirm-btn cancel"
        onclick={() => {
          skillEditorState.chapterToDelete = null;
        }}>{m.builder_keepChapter()}</Button
      >
      <Button
        variant="ghost"
        type="button"
        class="confirm-btn delete"
        onclick={executeDeleteChapter}>{m.builder_deleteChapterBtn()}</Button
      >
    {/snippet}
  </Dialog>
{/if}

<style>
  .confirm-desc {
    font-size: var(--font-size-caption);
    color: var(--color-muted);
    margin: 0;
    line-height: 1.4;
  }
  :global(.confirm-btn) {
    font-family: inherit;
    font-size: var(--font-size-caption);
    font-weight: 600;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-standard);
    border: none;
  }
  :global(.confirm-btn.cancel) {
    background: var(--color-bg2);
    color: var(--color-muted);
    border: 1px solid var(--color-border);
  }
  :global(.confirm-btn.cancel):hover {
    color: var(--color-foreground);
    border-color: var(--color-foreground);
  }
  :global(.confirm-btn.delete) {
    background: var(--color-danger-fg);
    color: white;
  }
  :global(.confirm-btn.delete):hover {
    filter: brightness(1.1);
  }
</style>
