<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import ExportDialog from '$lib/components/data-table/ExportDialog.svelte';
  import { Button } from '$lib/components/ui';

  const columns = [
    { key: 'code', label: 'Code', default: true },
    { key: 'name', label: 'Name', default: true },
    { key: 'status', label: 'Status', default: true },
    { key: 'qty', label: 'Quantity on hand', default: true },
    { key: 'amount', label: 'Amount', default: true },
    { key: 'createdAt', label: 'Created', default: false },
    { key: 'note', label: 'Internal note (hidden by default)', default: false },
  ];

  const { Story } = defineMeta({
    title: 'Data/ExportDialog',
    component: ExportDialog,
    tags: ['autodocs'],
    argTypes: { count: { control: 'number' } },
    args: { open: true, columns, count: 1284, formats: ['csv', 'xlsx'], onexport: fn() },
  });
</script>

<script lang="ts">
  let open = $state(false);
</script>

<Story name="Open">
  {#snippet template(args)}
    <ExportDialog {...args} />
  {/snippet}
</Story>

<Story name="CsvOnly" args={{ formats: ['csv'], count: 12 }}>
  {#snippet template(args)}
    <ExportDialog {...args} />
  {/snippet}
</Story>

<Story name="ManyColumns" args={{ columns: Array.from({ length: 40 }, (_, i) => ({ key: `c${i}`, label: `Column ${i + 1}`, default: i % 3 !== 0 })), count: 250000 }}>
  {#snippet template(args)}
    <ExportDialog {...args} />
  {/snippet}
</Story>

<Story name="Trigger" args={{ open: false }}>
  {#snippet template(args)}
    <Button onclick={() => (open = true)}>Export…</Button>
    <ExportDialog {...args} bind:open />
  {/snippet}
</Story>
