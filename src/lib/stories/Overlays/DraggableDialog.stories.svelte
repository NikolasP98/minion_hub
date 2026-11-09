<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import DraggableDialog from '$lib/components/ui/DraggableDialog.svelte';
  import { Button } from '$lib/components/ui';

  const { Story } = defineMeta({
    title: 'Overlays/DraggableDialog',
    component: DraggableDialog,
    tags: ['autodocs'],
    parameters: { docs: { story: { inline: false, height: '480px' } } },
    argTypes: { fullscreen: { control: 'boolean' }, resizable: { control: 'boolean' } },
    args: {
      title: 'Agent: PANIK',
      z: 1,
      fullscreen: false,
      x: 32,
      y: 32,
      width: 'min(560px,90vw)',
      height: 'min(360px,80vh)',
      resizable: false,
      onfocus: fn(),
      onclose: fn(),
      ontogglefullscreen: fn(),
      onmove: fn(),
    },
  });
</script>

<script>
  // Interactive window: the host owns position/fullscreen, the dialog reports.
  let win = $state({ open: false, x: 48, y: 48, fullscreen: false });
</script>

<Story name="Open">
  {#snippet template(args)}
    <DraggableDialog {...args}>
      <div class="p-4 text-sm text-muted-foreground">Drag me by the title bar.</div>
    </DraggableDialog>
  {/snippet}
</Story>

<Story name="Fullscreen" args={{ fullscreen: true }}>
  {#snippet template(args)}
    <DraggableDialog {...args}>
      <div class="p-4 text-sm text-muted-foreground">Fills the viewport; no drag.</div>
    </DraggableDialog>
  {/snippet}
</Story>

<Story name="Resizable" args={{ resizable: true, title: 'Flow canvas' }}>
  {#snippet template(args)}
    <DraggableDialog {...args}>
      <div class="p-4 text-sm text-muted-foreground">Native corner grip resizes this window.</div>
    </DraggableDialog>
  {/snippet}
</Story>

<Story
  name="Long title"
  args={{ title: 'A very long window title that truncates once it runs out of room in the bar' }}
>
  {#snippet template(args)}
    <DraggableDialog {...args}>
      <div class="p-4 text-sm">Title truncates.</div>
    </DraggableDialog>
  {/snippet}
</Story>

<Story name="Stacked windows">
  {#snippet template(args)}
    <DraggableDialog {...args} title="Window A" z={1} x={24} y={24}>
      <div class="p-4 text-sm">Behind</div>
    </DraggableDialog>
    <DraggableDialog {...args} title="Window B" z={2} x={120} y={96}>
      <div class="p-4 text-sm">In front (higher z)</div>
    </DraggableDialog>
  {/snippet}
</Story>

<Story name="Trigger">
  {#snippet template()}
    <Button onclick={() => (win.open = true)}>Open window</Button>
    {#if win.open}
      <DraggableDialog
        title="Interactive window"
        z={1}
        x={win.x}
        y={win.y}
        fullscreen={win.fullscreen}
        onfocus={() => {}}
        onclose={() => (win.open = false)}
        ontogglefullscreen={() => (win.fullscreen = !win.fullscreen)}
        onmove={(x, y) => {
          win.x = x;
          win.y = y;
        }}
      >
        <div class="p-4 text-sm">Drag, maximise, close.</div>
      </DraggableDialog>
    {/if}
  {/snippet}
</Story>

<!-- Responsive: the default width is min(760px, 92vw), so the window shrinks to 92vw on a phone. -->
<Story name="Open · Phone" globals={{ viewport: { value: 'phone', isRotated: false } }}>
  {#snippet template(args)}
    <DraggableDialog {...args}>
      <div class="p-4 text-sm text-muted-foreground">92vw wide on a phone.</div>
    </DraggableDialog>
  {/snippet}
</Story>
