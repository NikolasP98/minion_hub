<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import { Copy, Pencil, Trash2, ExternalLink, Archive } from 'lucide-svelte';
  import type { PlayFunction } from 'storybook/internal/types';
  import Dropdown from '$lib/components/ui/Dropdown.svelte';
  import Popover from '$lib/components/ui/Popover.svelte';
  import {
    dropdownInDialog,
    dropdownNestedInDialog,
    dropdownOnTop,
    showModal,
  } from './top-layer-play';

  const items = [
    { value: 'edit', label: 'Edit', icon: Pencil },
    { value: 'duplicate', label: 'Duplicate', icon: Copy },
    { value: 'open', label: 'Open in new tab', icon: ExternalLink, href: '#open' },
    { value: 'archive', label: 'Archive', icon: Archive, disabled: true },
    { value: 'div', label: '', divider: true },
    { value: 'delete', label: 'Delete', icon: Trash2, danger: true },
  ];

  const { Story } = defineMeta({
    title: 'Atoms/Overlays/Dropdown',
    component: Dropdown,
    tags: ['autodocs'],
    parameters: { docs: { story: { inline: false, height: '300px' } } },
    argTypes: { placement: { control: 'select', options: ['top', 'bottom', 'left', 'right'] } },
    args: { items, placement: 'bottom', onSelect: fn() },
  });

  const triggerCls =
    'inline-flex items-center gap-1 px-3 h-[var(--control-height-sm)] rounded-[var(--radius-md)] surface-3 text-sm text-foreground';

  // Zag menus have no `open` prop: click the trigger so docs show the panel.
  const open: PlayFunction = async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getAllByRole('button')[0]);
  };
</script>

<Story name="Open" play={open}>
  {#snippet template(args)}
    <div class="p-6">
      <Dropdown {...args}>
        {#snippet trigger()}<span class={triggerCls}>Actions</span>{/snippet}
      </Dropdown>
    </div>
  {/snippet}
</Story>

<Story name="Trigger (closed)">
  {#snippet template(args)}
    <div class="p-6">
      <Dropdown {...args}>
        {#snippet trigger()}<span class={triggerCls}>Actions</span>{/snippet}
      </Dropdown>
    </div>
  {/snippet}
</Story>

<Story name="Placement top" args={{ placement: 'top' }} play={open}>
  {#snippet template(args)}
    <div class="p-6 pt-56">
      <Dropdown {...args}>
        {#snippet trigger()}<span class={triggerCls}>Opens upward</span>{/snippet}
      </Dropdown>
    </div>
  {/snippet}
</Story>

<Story
  name="Plain labels (no icons)"
  args={{
    items: [
      { value: 'a', label: 'First' },
      { value: 'b', label: 'Second' },
      { value: 'c', label: 'Third' },
    ],
  }}
  play={open}
>
  {#snippet template(args)}
    <div class="p-6">
      <Dropdown {...args}>
        {#snippet trigger()}<span class={triggerCls}>Pick</span>{/snippet}
      </Dropdown>
    </div>
  {/snippet}
</Story>

<Story
  name="Many items"
  args={{
    items: Array.from({ length: 25 }, (_, i) => ({
      value: `opt-${i + 1}`,
      label: `Option ${i + 1}`,
    })),
  }}
  play={open}
>
  {#snippet template(args)}
    <div class="p-6">
      <Dropdown {...args} class="max-h-64 overflow-y-auto">
        {#snippet trigger()}<span class={triggerCls}>25 options</span>{/snippet}
      </Dropdown>
    </div>
  {/snippet}
</Story>

<Story name="Custom item renderer" play={open}>
  {#snippet template(args)}
    <div class="p-6">
      <Dropdown {...args}>
        {#snippet trigger()}<span class={triggerCls}>Custom rows</span>{/snippet}
        {#snippet item({ item, highlighted })}
          <span class="flex-1 flex items-center justify-between gap-4">
            <span>{item.label}</span>
            <kbd class="text-[length:var(--font-size-telemetry)] font-mono text-muted-foreground"
              >{highlighted ? 'enter' : ''}</kbd
            >
          </span>
        {/snippet}
      </Dropdown>
    </div>
  {/snippet}
</Story>

<Story name="InsideModalDialog" play={dropdownInDialog}>
  {#snippet template()}
    <dialog
      {@attach showModal}
      data-testid="clip"
      class="m-auto surface-3 rounded-[var(--radius-lg)] p-4 text-sm text-foreground"
    >
      <p class="mb-2 text-muted-foreground">A modal drawer (top layer).</p>
      <Dropdown {items}>
        {#snippet trigger()}<span class={triggerCls}>Actions</span>{/snippet}
      </Dropdown>
    </dialog>
  {/snippet}
</Story>

<Story name="InsideOverflowHidden" play={dropdownOnTop}>
  {#snippet template()}
    <div class="sb-clip-stage">
      <div
        data-testid="clip"
        class="sb-clip-box rounded-[var(--radius-md)] border border-[var(--hairline)]"
      >
        <Dropdown {items}>
          {#snippet trigger()}<span class={triggerCls}>Actions</span>{/snippet}
        </Dropdown>
      </div>
      <div aria-hidden="true" class="sb-clip-cover surface-4 p-2 text-xs text-muted-foreground">
        A higher z-index sibling over the menu's area.
      </div>
    </div>
  {/snippet}
</Story>

<Story name="NestedInDialog" play={dropdownNestedInDialog}>
  {#snippet template()}
    <dialog
      {@attach showModal}
      class="m-auto surface-3 rounded-[var(--radius-lg)] p-4 text-sm text-foreground"
    >
      <Popover>
        {#snippet trigger()}<span class={triggerCls}>Filter</span>{/snippet}
        <div class="p-2 w-64 h-56 flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <Dropdown {items}>
              {#snippet trigger()}<span class={triggerCls}>More</span>{/snippet}
            </Dropdown>
            <span class="font-medium text-foreground">Status is Open</span>
          </div>
          <p class="text-muted-foreground">The menu opens over this panel.</p>
        </div>
      </Popover>
    </dialog>
  {/snippet}
</Story>
