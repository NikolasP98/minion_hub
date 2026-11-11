<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import ColumnFilter from '$lib/components/data-table/ColumnFilter.svelte';

  const options = [
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'pending', label: 'Pending' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'no_show', label: 'No show' },
    { value: 'rescheduled', label: 'Rescheduled by the client' },
  ];

  const { Story } = defineMeta({
    title: 'Components/Data/ColumnFilter',
    component: ColumnFilter,
    tags: ['autodocs'],
    argTypes: {
      kind: { control: 'select', options: ['enum', 'text', 'number', 'date', 'boolean'] },
      align: { control: 'select', options: ['left', 'right'] },
    },
    args: { label: 'Status', options, kind: 'enum', onSelect: fn(), onValue: fn() },
  });
</script>

<Story name="Enum">
  {#snippet template(args)}
    <ColumnFilter {...args} />
  {/snippet}
</Story>

<Story name="EnumSelected" args={{ selected: new Set(['confirmed', 'pending']) }}>
  {#snippet template(args)}
    <ColumnFilter {...args} />
  {/snippet}
</Story>

<Story name="AlignRight" args={{ align: 'right', selected: new Set(['cancelled']) }}>
  {#snippet template(args)}
    <div class="flex justify-end"><ColumnFilter {...args} /></div>
  {/snippet}
</Story>

<Story
  name="Text"
  args={{ label: 'Client', kind: 'text', options: [], value: { kind: 'text', op: 'starts_with', text: 'Ma' } }}
>
  {#snippet template(args)}
    <ColumnFilter {...args} />
  {/snippet}
</Story>

<Story
  name="NumberRange"
  args={{ label: 'Total', kind: 'number', options: [], value: { kind: 'number', min: 100, max: 99999 } }}
>
  {#snippet template(args)}
    <ColumnFilter {...args} />
  {/snippet}
</Story>

<Story
  name="DateRange"
  args={{
    label: 'Date',
    kind: 'date',
    options: [],
    value: { kind: 'date', op: 'between', min: '2026-01-01', max: '2026-03-31' },
  }}
>
  {#snippet template(args)}
    <ColumnFilter {...args} />
  {/snippet}
</Story>

<Story name="Inactive" args={{ label: 'Total', kind: 'number', options: [], value: null }}>
  {#snippet template(args)}
    <ColumnFilter {...args} />
  {/snippet}
</Story>
