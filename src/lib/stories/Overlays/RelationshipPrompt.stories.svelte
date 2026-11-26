<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import RelationshipPrompt from '$lib/components/workshop/RelationshipPrompt.svelte';
  import { Button } from '$lib/components/ui';

  // The workshop's "name this link" prompt: a small modal card anchored where the link was
  // drawn, with the canvas still fully visible behind it (clear backdrop).
  const { Story } = defineMeta({
    title: 'Components/Overlays/RelationshipPrompt',
    component: RelationshipPrompt,
    tags: ['autodocs'],
    parameters: { docs: { story: { inline: false, height: '360px' } } },
  });
</script>

<script lang="ts">
  let open = $state(false);
  let last = $state('—');
</script>

<Story name="Open">
  {#snippet template()}
    <p class="text-sm text-foreground">Canvas content stays visible behind the prompt.</p>
    <RelationshipPrompt
      fromName="Scout"
      toName="Writer"
      x={260}
      y={180}
      onSubmit={() => {}}
      onCancel={() => {}}
    />
  {/snippet}
</Story>

<Story name="Trigger">
  {#snippet template()}
    <Button size="sm" onclick={() => (open = true)}>Link Scout to Writer</Button>
    <p data-last>Last: {last}</p>
    {#if open}
      <RelationshipPrompt
        fromName="Scout"
        toName="Writer"
        x={260}
        y={200}
        onSubmit={(label) => {
          last = `linked as ${label}`;
          open = false;
        }}
        onCancel={() => {
          last = 'cancelled';
          open = false;
        }}
      />
    {/if}
  {/snippet}
</Story>
