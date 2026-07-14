<script lang="ts">
  import { page } from '$app/state';
  import ValidationPanel from '$lib/components/builder/ValidationPanel.svelte';
  import DryRunPanel from '$lib/components/builder/DryRunPanel.svelte';
  import ChapterEditor from '$lib/components/builder/ChapterEditor.svelte';
  import { conn } from '$lib/state/gateway';
  import {
    skillEditorState,
    skillEditorDerived,
    initSkillEditor,
    cleanupSkillEditor,
    loadGatewayTools,
    scheduleSave,
    saveChapterEdits,
    fetchGhostSuggestions,
  } from '$lib/state/builder/skill-editor.svelte';
  import EditorToolbar from './_components/EditorToolbar.svelte';
  import EditorSidebar from './_components/EditorSidebar.svelte';
  import DagCanvas from './_components/DagCanvas.svelte';
  import DeleteChapterModal from './_components/DeleteChapterModal.svelte';
  import ConditionModal from './_components/ConditionModal.svelte';
  import AsyncBoundary from '$lib/components/ui/foundations/AsyncBoundary.svelte';
  import PageBody from '$lib/components/ui/foundations/PageBody.svelte';
  import PageShell from '$lib/components/ui/foundations/PageShell.svelte';

  let showDryRun = $state(false);
  let sidebarOpen = $state(true);

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
</script>

<PageShell archetype="workspace" scroll="none" variant="canvas">
  <EditorToolbar bind:showDryRun />

  <PageBody padding="none" scroll="none" class="skill-editor-body">
    <AsyncBoundary
      state={skillEditorState.loading ? { kind: 'loading' } : { kind: 'ready' }}
      class="skill-editor-boundary"
    >
      <div class="skill-stage">
        <EditorSidebar bind:sidebarOpen />

        <DagCanvas bind:sidebarOpen />

        {#if skillEditorState.editingChapter}
          <ChapterEditor
            chapter={skillEditorState.editingChapter}
            availableToolIds={skillEditorDerived.allToolIds}
            chapterToolIds={skillEditorState.editingChapterToolIds}
            suggestedToolIds={skillEditorState.suggestedToolMap[
              skillEditorState.editingChapter.id
            ] ?? []}
            skillName={skillEditorState.name}
            skillDescription={skillEditorState.description}
            onSave={saveChapterEdits}
            onClose={() => {
              skillEditorState.editingChapter = null;
            }}
          />
        {/if}

        {#if skillEditorState.showValidation && !skillEditorState.editingChapter && !showDryRun}
          <ValidationPanel />
        {/if}

        {#if showDryRun && !skillEditorState.editingChapter}
          <DryRunPanel />
        {/if}
      </div>
    </AsyncBoundary>
  </PageBody>

  <DeleteChapterModal />
  <ConditionModal />
</PageShell>

<style>
  :global(.skill-editor-body),
  :global(.skill-editor-boundary),
  .skill-stage {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex: 1;
  }

  .skill-stage {
    position: relative;
    overflow: hidden;
  }

  @media (max-width: 767.98px) {
    .skill-stage :global(.editor-sidebar),
    .skill-stage :global(.chapter-drawer),
    .skill-stage :global(.validation-panel),
    .skill-stage :global(.dry-run-panel) {
      position: absolute;
      inset: 0;
      width: 100%;
      z-index: var(--layer-popover);
    }
  }
</style>
