<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import SectionProseEditor from '$lib/components/agents/SectionProseEditor.svelte';
  import AgentCreateWizard from '$lib/components/builder/AgentCreateWizard.svelte';
  import AgentCreatorWizard from '$lib/components/marketplace/AgentCreatorWizard.svelte';
  import { Button } from '$lib/components/ui';

  // Three modals that draw their own surface inside the shared dialog (`bare`). Without a
  // gateway their bodies show loading or error states; the stories exist for the dialog
  // behaviour: open, focus, Tab, Escape, click outside, focus return.
  const { Story } = defineMeta({
    title: 'Components/Overlays/AgentModals',
    tags: ['autodocs'],
    parameters: { docs: { story: { inline: false, height: '520px' } } },
  });
</script>

<script lang="ts">
  let proseOpen = $state(false);
  let builderOpen = $state(false);
  let marketOpen = $state(false);
  let last = $state('—');
</script>

<Story name="Prose editor">
  {#snippet template()}
    <Button size="sm" onclick={() => (proseOpen = true)}>Edit prose</Button>
    <p data-last>Open: {proseOpen}</p>
    <SectionProseEditor
      bind:open={proseOpen}
      agentId="agent-1"
      layer="identity"
      sectionId="soul"
      sectionLabel="Soul"
    />
  {/snippet}
</Story>

<Story name="New agent wizard">
  {#snippet template()}
    <Button size="sm" onclick={() => (builderOpen = true)}>New agent</Button>
    <p data-last>Last: {last}</p>
    {#if builderOpen}
      <AgentCreateWizard
        onComplete={(id) => {
          last = `created ${id}`;
          builderOpen = false;
        }}
        onClose={() => {
          last = 'closed';
          builderOpen = false;
        }}
      />
    {/if}
  {/snippet}
</Story>

<Story name="Marketplace agent wizard">
  {#snippet template()}
    <Button size="sm" onclick={() => (marketOpen = true)}>Create marketplace agent</Button>
    <p data-last>Last: {last}</p>
    {#if marketOpen}
      <AgentCreatorWizard
        onClose={() => {
          last = 'closed';
          marketOpen = false;
        }}
      />
    {/if}
  {/snippet}
</Story>
