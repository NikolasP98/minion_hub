<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import type { PlayFunction } from 'storybook/internal/types';
  import Tooltip from '$lib/components/ui/Tooltip.svelte';
  import { Button } from '$lib/components/ui';
  import { showModal, tooltipOnTop } from './top-layer-play';

  const { Story } = defineMeta({
    title: 'Atoms/Overlays/Tooltip',
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
    args: {
      label: 'Saves the record',
      placement: 'top',
      openDelay: 0,
      closeDelay: 100,
      interactive: false,
      bare: false,
      disabled: false,
      tapToOpen: false,
    },
  });

  const placements = ['top', 'bottom', 'left', 'right'] as const;

  // Tooltips are hover-driven (no `open` prop): hover the trigger so docs show the panel.
  const hover: PlayFunction = async ({ canvas, userEvent }) => {
    await userEvent.hover(canvas.getByTestId('tip-trigger'));
  };
</script>

<Story name="Hovered" play={hover}>
  {#snippet template({ children: _children, ...args })}
    <div class="p-16 flex justify-center">
      <Tooltip {...args}>
        <span data-testid="tip-trigger" class="text-sm underline decoration-dotted">Hover me</span>
      </Tooltip>
    </div>
  {/snippet}
</Story>

<Story name="Trigger (idle)">
  {#snippet template({ children: _children, ...args })}
    <div class="p-16 flex justify-center">
      <Tooltip {...args} openDelay={200}>
        <span class="text-sm underline decoration-dotted">Hover me</span>
      </Tooltip>
    </div>
  {/snippet}
</Story>

<Story name="Placements">
  {#snippet template({ children: _children, ...args })}
    <div class="p-16 flex gap-8 justify-center">
      {#each placements as p (p)}
        <Tooltip {...args} placement={p} label="Placement: {p}">
          <span class="text-sm underline decoration-dotted">{p}</span>
        </Tooltip>
      {/each}
    </div>
  {/snippet}
</Story>

<Story name="Rich content" play={hover}>
  {#snippet template({ children: _children, ...args })}
    <div class="p-16 flex justify-center">
      <Tooltip {...args}>
        {#snippet content()}
          <p class="font-semibold text-foreground">Stock: 12 units</p>
          <p class="text-muted-foreground">3 reserved, 9 available</p>
        {/snippet}
        <span data-testid="tip-trigger" class="text-sm underline decoration-dotted"
          >Hover for details</span
        >
      </Tooltip>
    </div>
  {/snippet}
</Story>

<Story name="Interactive panel" args={{ interactive: true, bare: true }} play={hover}>
  {#snippet template({ children: _children, ...args })}
    <div class="p-16 flex justify-center">
      <Tooltip {...args}>
        {#snippet content()}
          <div class="surface-3 rounded-[var(--radius-md)] p-3 flex items-center gap-2">
            <span class="text-sm">Appointment 10:30</span>
            <Button size="xs">Open</Button>
          </div>
        {/snippet}
        <span data-testid="tip-trigger" class="text-sm underline decoration-dotted">Hover card</span
        >
      </Tooltip>
    </div>
  {/snippet}
</Story>

<Story
  name="Long label"
  args={{
    label:
      'This tooltip label is long enough to wrap onto several lines, which the 280px max width handles by itself.',
  }}
  play={hover}
>
  {#snippet template({ children: _children, ...args })}
    <div class="p-16 flex justify-center">
      <Tooltip {...args}>
        <span data-testid="tip-trigger" class="text-sm underline decoration-dotted">Long label</span
        >
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

<Story
  name="Tap to open (touch)"
  args={{ tapToOpen: true, label: 'Tap toggles on coarse pointers' }}
>
  {#snippet template({ children: _children, ...args })}
    <div class="p-16 flex justify-center">
      <Tooltip {...args}>
        <span class="text-sm underline decoration-dotted">Tap me</span>
      </Tooltip>
    </div>
  {/snippet}
</Story>

<Story name="Disabled" args={{ disabled: true }}>
  {#snippet template({ children: _children, ...args })}
    <div class="p-16 flex justify-center">
      <Tooltip {...args}>
        <span class="text-sm text-muted-foreground">No tooltip here</span>
      </Tooltip>
    </div>
  {/snippet}
</Story>

<Story name="InsideModalDialog" play={tooltipOnTop}>
  {#snippet template()}
    <dialog
      {@attach showModal}
      data-testid="clip"
      class="m-auto surface-3 rounded-[var(--radius-lg)] p-4 text-sm text-foreground"
    >
      <p class="mb-2 text-muted-foreground">A modal drawer (top layer).</p>
      <Tooltip
        label="Paints above the dialog, past its bottom edge"
        placement="bottom"
        openDelay={0}
      >
        <span data-testid="tip-trigger" class="text-sm underline decoration-dotted">Hover me</span>
      </Tooltip>
    </dialog>
  {/snippet}
</Story>

<Story name="InsideOverflowHidden" play={tooltipOnTop}>
  {#snippet template()}
    <div class="sb-clip-stage">
      <div
        data-testid="clip"
        class="sb-clip-box rounded-[var(--radius-md)] border border-[var(--hairline)]"
      >
        <Tooltip
          label="Not clipped by the box, not covered by its sibling"
          placement="bottom"
          openDelay={0}
        >
          <span data-testid="tip-trigger" class="text-sm underline decoration-dotted">Hover me</span
          >
        </Tooltip>
      </div>
      <div aria-hidden="true" class="sb-clip-cover surface-4 p-2 text-xs text-muted-foreground">
        A higher z-index sibling over the label's area.
      </div>
    </div>
  {/snippet}
</Story>
