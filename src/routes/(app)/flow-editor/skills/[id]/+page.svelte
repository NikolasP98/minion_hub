<script lang="ts">
    import { page } from "$app/state";
    import ValidationPanel from "$lib/components/builder/ValidationPanel.svelte";
    import DryRunPanel from "$lib/components/builder/DryRunPanel.svelte";
    import ChapterEditor from "$lib/components/builder/ChapterEditor.svelte";
    import { conn } from "$lib/state/gateway";
    import {
        skillEditorState, skillEditorDerived,
        initSkillEditor, cleanupSkillEditor, loadGatewayTools, scheduleSave,
        saveChapterEdits,
        fetchGhostSuggestions,
    } from '$lib/state/builder/skill-editor.svelte';
    import * as m from '$lib/paraglide/messages';

    import EditorToolbar from './_components/EditorToolbar.svelte';
    import EditorSidebar from './_components/EditorSidebar.svelte';
    import DagCanvas from './_components/DagCanvas.svelte';
    import DeleteChapterModal from './_components/DeleteChapterModal.svelte';
    import ConditionModal from './_components/ConditionModal.svelte';

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

<EditorToolbar bind:showDryRun />

<!-- Main layout: sidebar + canvas + optional panels -->
<div class="flex-1 min-h-0 flex">
    {#if skillEditorState.loading}
        <div class="flex-1 flex items-center justify-center">
            <span class="text-muted text-sm">{m.common_loading()}</span>
        </div>
    {:else}
        <EditorSidebar bind:sidebarOpen />

        <DagCanvas bind:sidebarOpen />

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
        {#if skillEditorState.showValidation && !skillEditorState.editingChapter && !showDryRun}
            <ValidationPanel />
        {/if}

        <!-- Right: Dry run panel (conditional) -->
        {#if showDryRun && !skillEditorState.editingChapter}
            <DryRunPanel />
        {/if}
    {/if}
</div>

<DeleteChapterModal />
<ConditionModal />
