<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import FilterAddMenu from '$lib/components/data-table/FilterAddMenu.svelte';
  import type { FilterColumnMeta } from '$lib/components/data-table/filters';

  const columns: FilterColumnMeta[] = [
    { key: 'status', label: 'Status', kind: 'enum', options: [{ value: 'a', label: 'Active' }] },
    { key: 'client', label: 'Client', kind: 'text' },
    { key: 'total', label: 'Total', kind: 'number' },
    { key: 'date', label: 'Date', kind: 'date' },
    { key: 'paid', label: 'Paid', kind: 'boolean' },
    { key: 'notes', label: 'Internal notes and follow-up remarks', kind: 'text' },
  ];

  const { Story } = defineMeta({
    title: 'Components/Data/FilterAddMenu',
    component: FilterAddMenu,
    tags: ['autodocs'],
    argTypes: { open: { control: 'boolean' }, active: { control: 'boolean' } },
    args: { columns, onPick: fn(), onAdvanced: fn(), open: false, active: false },
  });
</script>

<Story name="Default">
  {#snippet template(args)}
    <FilterAddMenu {...args} />
  {/snippet}
</Story>

<Story name="Open" args={{ open: true }}>
  {#snippet template(args)}
    <FilterAddMenu {...args} />
  {/snippet}
</Story>

<Story name="Active" args={{ active: true }}>
  {#snippet template(args)}
    <FilterAddMenu {...args} />
  {/snippet}
</Story>

<Story name="NoAdvanced" args={{ open: true, onAdvanced: undefined }}>
  {#snippet template(args)}
    <FilterAddMenu {...args} />
  {/snippet}
</Story>

<Story name="ManyColumns" args={{ open: true, columns: Array.from({ length: 30 }, (_, i) => ({ key: `c${i}`, label: `Column ${i + 1}`, kind: 'text' as const })) }}>
  {#snippet template(args)}
    <FilterAddMenu {...args} />
  {/snippet}
</Story>
