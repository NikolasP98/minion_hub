<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import { CreditCard, Scissors, CalendarX, Palette, Eye, Copy, Trash2 } from 'lucide-svelte';
  import ContextMenu, { type ContextMenuItem } from '$lib/components/ui/ContextMenu.svelte';

  const items = [
    { id: 'charge', label: 'Charge', icon: CreditCard },
    { id: 'copy', label: 'Copy link', icon: Copy },
    { id: 'archive', label: 'Archive', icon: Trash2, disabled: true },
    { id: 'unschedule', label: 'Unschedule', icon: CalendarX, danger: true },
  ];

  const withSubmenu = [
    { id: 'charge', label: 'Charge', icon: CreditCard },
    {
      id: 'split',
      label: 'Split',
      icon: Scissors,
      children: [
        { id: 'split-all', label: 'Split everything' },
        { id: 'split-one', label: 'Split this service only' },
      ],
    },
    { id: 'unschedule', label: 'Unschedule', icon: CalendarX, danger: true },
  ];

  const choices: ContextMenuItem[] = [
    {
      id: 'color-service',
      label: 'Colour by service',
      icon: Palette,
      selection: 'radio',
      checked: true,
    },
    {
      id: 'color-staff',
      label: 'Colour by staff',
      icon: Palette,
      selection: 'radio',
      checked: false,
    },
    { id: 'show-price', label: 'Show price', icon: Eye, selection: 'checkbox', checked: true },
    { id: 'show-notes', label: 'Show notes', icon: Eye, selection: 'checkbox', checked: false },
  ];

  const { Story } = defineMeta({
    title: 'Atoms/Overlays/ContextMenu',
    component: ContextMenu,
    tags: ['autodocs'],
    parameters: { docs: { story: { inline: false, height: '280px' } } },
    args: { x: 24, y: 24, items, label: 'Appointment actions', onselect: fn(), onclose: fn() },
  });
</script>

<script lang="ts">
  // The host owns open/closed: it mounts the menu only while a point is set.
  let at = $state<{ x: number; y: number } | null>(null);
</script>

<Story name="Open">
  {#snippet template(args)}
    <ContextMenu {...args} />
  {/snippet}
</Story>

<Story name="With submenu" args={{ items: withSubmenu }}>
  {#snippet template(args)}
    <ContextMenu {...args} />
  {/snippet}
</Story>

<Story name="Choice rows (radio + checkbox)" args={{ items: choices, label: 'View options' }}>
  {#snippet template(args)}
    <ContextMenu {...args} />
  {/snippet}
</Story>

<Story name="Near the viewport edge (clamped)" args={{ x: 4000, y: 4000 }}>
  {#snippet template(args)}
    <ContextMenu {...args} />
  {/snippet}
</Story>

<Story name="Trigger (right-click the area)">
  {#snippet template(args)}
    <div
      role="presentation"
      class="h-56 flex items-center justify-center rounded-[var(--radius-md)] border border-dashed border-border text-sm text-muted-foreground select-none"
      oncontextmenu={(e) => {
        e.preventDefault();
        at = { x: e.clientX, y: e.clientY };
      }}
    >
      Right-click here
    </div>
    {#if at}
      <ContextMenu {...args} {...at} onclose={() => (at = null)} onselect={() => (at = null)} />
    {/if}
  {/snippet}
</Story>
