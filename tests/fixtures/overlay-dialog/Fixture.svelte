<script lang="ts">
  import { ui } from '$lib/state/ui/ui.svelte';
  import { skillEditorState } from '$lib/state/builder/skill-editor.svelte';
  import HostsOverlay from '$lib/components/hosts/HostsOverlay.svelte';
  import DeleteConfirmModal from '$lib/components/builder/_builder-hub/DeleteConfirmModal.svelte';
  import RegistryAgentSheet from '$lib/components/builder/_builder-hub/RegistryAgentSheet.svelte';
  import SkillCreateWizard from '$lib/components/builder/SkillCreateWizard.svelte';
  import ExportDialog from '$lib/components/data-table/ExportDialog.svelte';
  import ConditionModal from '../../../src/routes/(app)/flow-editor/skills/[id]/_components/ConditionModal.svelte';
  import DeleteChapterModal from '../../../src/routes/(app)/flow-editor/skills/[id]/_components/DeleteChapterModal.svelte';

  let del = $state(false);
  let sheet = $state(false);
  let wizard = $state(false);
  let exportOpen = $state(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = skillEditorState as any;
</script>

<main>
  <h1>Overlay dialog contract fixture</h1>
  <button id="open-hosts" onclick={() => (ui.overlayOpen = true)}>Hosts</button>
  <button id="open-delete" onclick={() => (del = true)}>Delete confirm</button>
  <button id="open-sheet" onclick={() => (sheet = true)}>Registry sheet</button>
  <button id="open-wizard" onclick={() => (wizard = true)}>Skill wizard</button>
  <button id="open-export" onclick={() => (exportOpen = true)}>Export</button>
  <button id="open-chapter" onclick={() => (editor.chapterToDelete = { id: 'c1', name: 'Intro' })}
    >Delete chapter</button
  >
  <button id="open-condition" onclick={() => (editor.editingCondition = { id: null })}
    >Condition</button
  >
  <button id="background">Background action</button>
</main>

{#if ui.overlayOpen}
  <HostsOverlay />
{/if}
{#if del}
  <DeleteConfirmModal
    type="skill"
    name="Draft"
    onCancel={() => (del = false)}
    onConfirm={() => (del = false)}
  />
{/if}
{#if sheet}
  <RegistryAgentSheet
    agent={{
      id: 'a1',
      name: 'Registry agent',
      description: 'Fixture agent',
      categories: ['ops'],
      tags: ['t'],
      source: 'fixture',
    }}
    onClose={() => (sheet = false)}
  />
{/if}
{#if wizard}
  <SkillCreateWizard onComplete={() => (wizard = false)} onClose={() => (wizard = false)} />
{/if}
<ExportDialog
  bind:open={exportOpen}
  columns={[
    { key: 'a', label: 'Alpha', default: true },
    { key: 'b', label: 'Beta', default: false },
  ]}
  count={2}
  onexport={() => {}}
/>
<DeleteChapterModal />
<ConditionModal />
