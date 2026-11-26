<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import DraggableWindow from '$lib/components/ui/foundations/DraggableWindow.svelte';
  import { Button } from '$lib/components/ui';

  // A floating, non-modal window: it takes focus when it opens and gives it back on close.
  const { Story } = defineMeta({
    title: 'Atoms/Overlays/DraggableWindow',
    component: DraggableWindow,
    tags: ['autodocs'],
    parameters: { docs: { story: { inline: false, height: '420px' } } },
  });
</script>

<script lang="ts">
  let open = $state(false);
</script>

<Story name="Trigger">
  {#snippet template()}
    <Button size="sm" onclick={() => (open = true)}>Open window</Button>
    <Button size="sm" variant="ghost">Another control</Button>
    <DraggableWindow
      {open}
      title="Agent trace"
      keyboardInstructions="Use Alt plus the arrow keys to move this window."
      resizeLabel="Resize agent trace"
      onclose={() => (open = false)}
    >
      <p class="text-sm text-foreground">Trace body</p>
    </DraggableWindow>
  {/snippet}
</Story>
