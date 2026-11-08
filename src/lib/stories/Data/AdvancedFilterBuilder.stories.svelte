<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import AdvancedFilterBuilder from '$lib/components/data-table/AdvancedFilterBuilder.svelte';
  import type { FilterColumnMeta, FilterGroup } from '$lib/components/data-table/filters';

  const columns: FilterColumnMeta[] = [
    {
      key: 'status',
      label: 'Status',
      kind: 'enum',
      options: [
        { value: 'confirmed', label: 'Confirmed' },
        { value: 'pending', label: 'Pending' },
        { value: 'cancelled', label: 'Cancelled' },
      ],
    },
    { key: 'client', label: 'Client', kind: 'text' },
    { key: 'total', label: 'Total', kind: 'number' },
    { key: 'date', label: 'Date', kind: 'date' },
    { key: 'paid', label: 'Paid', kind: 'boolean' },
  ];

  const emptyGroup: FilterGroup = { id: 'g0', logic: 'and', items: [] };
  const flatGroup: FilterGroup = {
    id: 'g1',
    logic: 'and',
    items: [
      { id: 'r1', key: 'status', value: { kind: 'enum', op: 'is', values: ['confirmed'] } },
      { id: 'r2', key: 'total', value: { kind: 'number', op: 'gte', min: 500, max: null } },
      { id: 'r3', key: 'client', value: { kind: 'text', op: 'contains', text: 'Garcia' } },
    ],
  };
  const nestedGroup: FilterGroup = {
    id: 'g2',
    logic: 'or',
    items: [
      { id: 'r4', key: 'paid', value: { kind: 'boolean', op: 'unchecked' } },
      {
        id: 'g3',
        logic: 'and',
        items: [
          { id: 'r5', key: 'date', value: { kind: 'date', op: 'relative', rel: 'past_week', min: null, max: null } },
          { id: 'r6', key: 'status', value: { kind: 'enum', op: 'is_not', values: ['cancelled'] } },
          {
            id: 'g4',
            logic: 'or',
            items: [
              { id: 'r7', key: 'total', value: { kind: 'number', op: 'between', min: 0, max: 99 } },
              { id: 'r8', key: 'client', value: { kind: 'text', op: 'is_empty', text: '' } },
            ],
          },
        ],
      },
    ],
  };

  const { Story } = defineMeta({
    title: 'Data/AdvancedFilterBuilder',
    component: AdvancedFilterBuilder,
    tags: ['autodocs'],
    args: { columns, onChange: fn(), onDelete: fn() },
  });
</script>

<script lang="ts">
  let live = $state<FilterGroup>(structuredClone(flatGroup));
</script>

<Story name="EmptyGroup" args={{ group: emptyGroup }}>
  {#snippet template(args)}
    <div style="max-width: 40rem"><AdvancedFilterBuilder {...args} /></div>
  {/snippet}
</Story>

<Story name="FlatRules" args={{ group: flatGroup }}>
  {#snippet template(args)}
    <div style="max-width: 40rem"><AdvancedFilterBuilder {...args} /></div>
  {/snippet}
</Story>

<Story name="NestedGroups" args={{ group: nestedGroup }}>
  {#snippet template(args)}
    <div style="max-width: 40rem"><AdvancedFilterBuilder {...args} /></div>
  {/snippet}
</Story>

<Story name="Interactive">
  {#snippet template(args)}
    <div style="max-width: 40rem">
      <AdvancedFilterBuilder {...args} group={live} onChange={(next) => (live = next)} />
    </div>
    <pre class="mt-4 text-xs text-muted-foreground">{JSON.stringify(live, null, 2)}</pre>
  {/snippet}
</Story>
