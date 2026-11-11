<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Popover from '$lib/components/ui/Popover.svelte';

  const { Story } = defineMeta({
    title: 'Atoms/Overlays/Popover',
    component: Popover,
    tags: ['autodocs'],
    parameters: { docs: { story: { inline: false, height: '260px' } } },
    argTypes: {
      placement: { control: 'select', options: ['top', 'bottom', 'left', 'right', 'bottom-end'] },
      bare: { control: 'boolean' },
      disabled: { control: 'boolean' },
      viewportContained: { control: 'boolean' },
    },
    args: { placement: 'bottom', bare: false, disabled: false, viewportContained: false },
  });

  const placements = ['top', 'bottom', 'left', 'right', 'bottom-end'] as const;

  const triggerCls =
    'inline-flex items-center gap-1 px-3 h-[var(--control-height-sm)] rounded-[var(--radius-md)] surface-3 text-sm text-foreground';
</script>

<Story name="Open">
  {#snippet template({ children: _children, ...args })}
    <div class="p-8">
      <Popover {...args} open={true}>
        {#snippet trigger()}<span class={triggerCls}>Filters</span>{/snippet}
        <div class="p-2 text-sm w-56">
          <p class="font-medium text-foreground">Status</p>
          <p class="text-muted-foreground">Any panel content goes here.</p>
        </div>
      </Popover>
    </div>
  {/snippet}
</Story>

<Story name="Trigger (closed)">
  {#snippet template({ children: _children, ...args })}
    <div class="p-8">
      <Popover {...args}>
        {#snippet trigger()}<span class={triggerCls}>Click me</span>{/snippet}
        <div class="p-2 text-sm">Opened by the trigger.</div>
      </Popover>
    </div>
  {/snippet}
</Story>

<Story name="Placements">
  {#snippet template()}
    <div class="flex flex-wrap gap-6 p-16 justify-center">
      {#each placements as p (p)}
        <Popover placement={p}>
          {#snippet trigger()}<span class={triggerCls}>{p}</span>{/snippet}
          <div class="p-2 text-sm">Placement: {p}</div>
        </Popover>
      {/each}
    </div>
  {/snippet}
</Story>

<Story name="Bare" args={{ bare: true }}>
  {#snippet template({ children: _children, ...args })}
    <div class="p-8">
      <Popover {...args} open={true}>
        {#snippet trigger()}<span class={triggerCls}>Bare panel</span>{/snippet}
        <div class="surface-4 rounded-[var(--radius-lg)] p-4 text-sm shadow-lg">
          Child brings its own surface.
        </div>
      </Popover>
    </div>
  {/snippet}
</Story>

<Story name="Icon-only trigger (label)">
  {#snippet template({ children: _children, ...args })}
    <div class="p-8">
      <Popover {...args} label="More options" open={true}>
        {#snippet trigger()}<span class={triggerCls} aria-hidden="true">...</span>{/snippet}
        <div class="p-2 text-sm">The button is named by `label`.</div>
      </Popover>
    </div>
  {/snippet}
</Story>

<Story name="Disabled" args={{ disabled: true }}>
  {#snippet template({ children: _children, ...args })}
    <div class="p-8">
      <Popover {...args}>
        {#snippet trigger()}<span class="{triggerCls} opacity-50">Disabled</span>{/snippet}
        <div class="p-2 text-sm">Never shows.</div>
      </Popover>
    </div>
  {/snippet}
</Story>

<Story name="Viewport contained (wide panel)" args={{ viewportContained: true }}>
  {#snippet template({ children: _children, ...args })}
    <div class="p-8">
      <Popover {...args} open={true}>
        {#snippet trigger()}<span class={triggerCls}>Wide panel</span>{/snippet}
        <div class="p-3 text-sm w-[1400px]">
          Panel content wider than most viewports; it shrinks and scrolls instead of overflowing.
        </div>
      </Popover>
    </div>
  {/snippet}
</Story>
