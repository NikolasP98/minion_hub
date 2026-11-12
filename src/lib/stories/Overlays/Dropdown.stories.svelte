<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import { Copy, Pencil, Trash2, ExternalLink, Archive } from 'lucide-svelte';
  import type { PlayFunction } from 'storybook/internal/types';
  import Dropdown from '$lib/components/ui/Dropdown.svelte';

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
