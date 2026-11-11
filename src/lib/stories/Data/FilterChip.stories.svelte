<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import FilterChip from '$lib/components/data-table/FilterChip.svelte';

  const statusOptions = [
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'pending', label: 'Pending' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'no_show', label: 'No show' },
  ];

  const { Story } = defineMeta({
    title: 'Components/Data/FilterChip',
    component: FilterChip,
    tags: ['autodocs'],
    argTypes: {
      kind: { control: 'select', options: ['enum', 'text', 'number', 'date', 'boolean'] },
      open: { control: 'boolean' },
    },
    args: {
      label: 'Status',
      kind: 'enum',
      options: statusOptions,
      value: { kind: 'enum', values: ['confirmed', 'pending'] },
      onValue: fn(),
      onRemove: fn(),
      open: false,
    },
  });
</script>

<Story name="Enum">
  {#snippet template(args)}
    <FilterChip {...args} />
  {/snippet}
</Story>

<Story name="EnumEmpty" args={{ value: { kind: 'enum', values: [] } }}>
  {#snippet template(args)}
    <FilterChip {...args} />
  {/snippet}
</Story>

<Story name="EnumOpen" args={{ open: true }}>
  {#snippet template(args)}
    <FilterChip {...args} />
  {/snippet}
</Story>

<Story
  name="Text"
  args={{
    label: 'Client',
    kind: 'text',
    options: [],
    value: { kind: 'text', op: 'contains', text: 'Martinez' },
  }}
>
  {#snippet template(args)}
    <FilterChip {...args} />
  {/snippet}
</Story>

<Story
  name="NumberRange"
  args={{
    label: 'Total',
    kind: 'number',
    options: [],
    value: { kind: 'number', op: 'between', min: 1500, max: 125000 },
  }}
>
  {#snippet template(args)}
    <FilterChip {...args} />
  {/snippet}
</Story>

<Story
  name="DateRelative"
  args={{
    label: 'Date',
    kind: 'date',
    options: [],
    value: { kind: 'date', op: 'relative', rel: 'past_month', min: null, max: null },
  }}
>
  {#snippet template(args)}
    <FilterChip {...args} />
  {/snippet}
</Story>

<Story
  name="Boolean"
  args={{ label: 'Paid', kind: 'boolean', options: [], value: { kind: 'boolean', op: 'unchecked' } }}
>
  {#snippet template(args)}
    <FilterChip {...args} />
  {/snippet}
</Story>

<Story
  name="LongLabel"
  args={{
    label: 'Secondary responsible staff member for the follow-up appointment',
    value: { kind: 'enum', values: ['confirmed', 'pending', 'cancelled', 'no_show'] },
  }}
>
  {#snippet template(args)}
    <div style="max-width: 20rem"><FilterChip {...args} /></div>
  {/snippet}
</Story>
