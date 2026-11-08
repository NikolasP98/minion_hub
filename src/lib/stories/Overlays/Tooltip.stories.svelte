<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Tooltip from '$lib/components/ui/Tooltip.svelte';
  import { Button } from '$lib/components/ui';

  const { Story } = defineMeta({
    title: 'Overlays/Tooltip',
    component: Tooltip,
    tags: ['autodocs'],
    parameters: { docs: { story: { inline: false, height: '200px' } } },
    argTypes: {
      placement: { control: 'select', options: ['top', 'bottom', 'left', 'right'] },
      interactive: { control: 'boolean' },
      bare: { control: 'boolean' },
      disabled: { control: 'boolean' },
      tapToOpen: { control: 'boolean' },
    },
    args: { label: 'Saves the record', placement: 'top', openDelay: 0, closeDelay: 100, interactive: false, bare: false, disabled: false, tapToOpen: false },
  });

  // Tooltips are hover-driven (no `open` prop): hover the trigger so docs show the panel.
  const hover = async ({ canvas, userEvent }) => {
    await userEvent.hover(canvas.getByTestId('tip-trigger'));
  };
</script>

<Story name="Hovered" play={hover}>
  {#snippet template(args)}
    <div class="p-16 flex justify-center">
      <Tooltip {...args}>
        <span data-testid="tip-trigger" class="text-sm underline decoration-dotted">Hover me</span>
      </Tooltip>
    </div>
  {/snippet}
</Story>

<Story name="Trigger (idle)">
  {#snippet template(args)}
    <div class="p-16 flex justify-center">
      <Tooltip {...args} openDelay={200}>
        <span class="text-sm underline decoration-dotted">Hover me</span>
      </Tooltip>
    </div>
  {/snippet}
</Story>

<Story name="Placements">
  {#snippet template(args)}
    <div class="p-16 flex gap-8 justify-center">
      {#each ['top', 'bottom', 'left', 'right'] as p (p)}
        <Tooltip {...args} placement={p} label="Placement: {p}">
          <span class="text-sm underline decoration-dotted">{p}</span>
        </Tooltip>
      {/each}
    </div>
  {/snippet}
</Story>

<Story name="Rich content" play={hover}>
  {#snippet template(args)}
    <div class="p-16 flex justify-center">
      <Tooltip {...args}>
        {#snippet content()}
          <p class="font-semibold text-foreground">Stock: 12 units</p>
          <p class="text-muted-foreground">3 reserved, 9 available</p>
        {/snippet}
        <span data-testid="tip-trigger" class="text-sm underline decoration-dotted">Hover for details</span>
      </Tooltip>
    </div>
  {/snippet}
</Story>

<Story name="Interactive panel" args={{ interactive: true, bare: true }} play={hover}>
  {#snippet template(args)}
    <div class="p-16 flex justify-center">
      <Tooltip {...args}>
        {#snippet content()}
          <div class="surface-3 rounded-[var(--radius-md)] p-3 flex items-center gap-2">
            <span class="text-sm">Appointment 10:30</span>
            <Button size="xs">Open</Button>
          </div>
        {/snippet}
        <span data-testid="tip-trigger" class="text-sm underline decoration-dotted">Hover card</span>
      </Tooltip>
    </div>
  {/snippet}
</Story>

<Story name="Long label" args={{ label: 'This tooltip label is long enough to wrap onto several lines, which the 280px max width handles by itself.' }} play={hover}>
  {#snippet template(args)}
    <div class="p-16 flex justify-center">
      <Tooltip {...args}>
        <span data-testid="tip-trigger" class="text-sm underline decoration-dotted">Long label</span>
      </Tooltip>
    </div>
  {/snippet}
</Story>

<Story name="asChild (props spread onto own element)" play={hover}>
  {#snippet template(args)}
    <div class="p-16 flex justify-center">
      <Tooltip {...args} asChild>
        {#snippet children(trigger)}
          <Button {...trigger} data-testid="tip-trigger" size="sm">Button trigger</Button>
        {/snippet}
      </Tooltip>
    </div>
  {/snippet}
</Story>

<Story name="Tap to open (touch)" args={{ tapToOpen: true, label: 'Tap toggles on coarse pointers' }}>
  {#snippet template(args)}
    <div class="p-16 flex justify-center">
      <Tooltip {...args}>
        <span class="text-sm underline decoration-dotted">Tap me</span>
      </Tooltip>
    </div>
  {/snippet}
</Story>

<Story name="Disabled" args={{ disabled: true }}>
  {#snippet template(args)}
    <div class="p-16 flex justify-center">
      <Tooltip {...args}>
        <span class="text-sm text-muted-foreground">No tooltip here</span>
      </Tooltip>
    </div>
  {/snippet}
</Story>
