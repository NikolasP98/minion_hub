<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import SegmentedControl from '$lib/components/ui/SegmentedControl.svelte';
  import { Calendar, List, LayoutGrid } from 'lucide-svelte';

  const items = [
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month', disabled: true, title: 'Upgrade to unlock' },
  ];
  const views = [
    { value: 'list', label: 'List', icon: List },
    { value: 'grid', label: 'Grid', icon: LayoutGrid },
    { value: 'calendar', label: 'Calendar', icon: Calendar },
  ];

  const { Story } = defineMeta({
    title: 'Hub/SegmentedControl',
    component: SegmentedControl,
    tags: ['autodocs'],
    argTypes: {
      size: { control: 'select', options: ['sm', 'md'] },
      value: { control: 'select', options: items.map((i) => i.value) },
      iconOnly: { control: 'boolean' },
    },
    args: { items, value: 'day', size: 'sm', iconOnly: false, 'aria-label': 'Range' },
  });
</script>

<Story name="Default">
  {#snippet template(args)}
    <SegmentedControl {...args} />
  {/snippet}
</Story>

<Story name="Medium" args={{ size: 'md', value: 'week' }}>
  {#snippet template(args)}
    <SegmentedControl {...args} />
  {/snippet}
</Story>

<Story
  name="Icon only"
  args={{ items: views, value: 'list', iconOnly: true, 'aria-label': 'View' }}
>
  {#snippet template(args)}
    <SegmentedControl {...args} />
  {/snippet}
</Story>
