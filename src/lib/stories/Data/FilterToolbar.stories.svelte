<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import FilterToolbar from '$lib/components/data-table/FilterToolbar.svelte';
  import type {
    FilterColumnMeta,
    FilterGroup,
    FilterValue,
  } from '$lib/components/data-table/filters';

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

  const { Story } = defineMeta({
    title: 'Data/FilterToolbar',
    component: FilterToolbar,
    tags: ['autodocs'],
    args: { columns },
  });
</script>

<script lang="ts">
  let empty = $state<Record<string, FilterValue>>({});
  let emptyAdvanced = $state<FilterGroup | null>(null);

  let active = $state<Record<string, FilterValue>>({
    status: { kind: 'enum', values: ['confirmed', 'pending'] },
    client: { kind: 'text', op: 'contains', text: 'Mar' },
    total: { kind: 'number', op: 'gte', min: 150, max: null },
    date: { kind: 'date', op: 'relative', rel: 'this_week', min: null, max: null },
  });
  let activeAdvanced = $state<FilterGroup | null>({
    id: 'g1',
    logic: 'or',
    items: [
      { id: 'r1', key: 'paid', value: { kind: 'boolean', op: 'unchecked' } },
      { id: 'r2', key: 'total', value: { kind: 'number', op: 'gt', min: 10000, max: null } },
    ],
  });
</script>

<Story name="Empty">
  {#snippet template(args)}
    <FilterToolbar {...args} bind:filters={empty} bind:advanced={emptyAdvanced} />
    <pre class="mt-4 text-xs text-muted-foreground">{JSON.stringify(empty, null, 2)}</pre>
  {/snippet}
</Story>

<Story name="WithFilters">
  {#snippet template(args)}
    <FilterToolbar {...args} bind:filters={active} bind:advanced={emptyAdvanced} />
    <pre class="mt-4 text-xs text-muted-foreground">{JSON.stringify(active, null, 2)}</pre>
  {/snippet}
</Story>

<Story name="WithAdvancedRules">
  {#snippet template(args)}
    <FilterToolbar {...args} bind:filters={active} bind:advanced={activeAdvanced} />
    <pre class="mt-4 text-xs text-muted-foreground">{JSON.stringify(activeAdvanced, null, 2)}</pre>
  {/snippet}
</Story>
