<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import ExportDialog from '$lib/components/crm/ExportDialog.svelte';

  const columns = [
    { key: 'name', label: 'Name', default: true },
    { key: 'doc', label: 'Document', default: true },
    { key: 'phone', label: 'Phone', default: true },
    { key: 'email', label: 'Email', default: false },
    { key: 'tags', label: 'Tags', default: false },
    { key: 'lastVisit', label: 'Last visit', default: true },
  ];

  const { Story } = defineMeta({
    title: 'Forms/ExportDialog',
    component: ExportDialog,
    tags: ['autodocs'],
    argTypes: { open: { control: 'boolean' }, count: { control: 'number' } },
    args: { open: true, columns, count: 1284, onexport: fn() },
  });
</script>

<Story name="Open">
  {#snippet template(args)}<ExportDialog {...args} />{/snippet}
</Story>

<Story name="Closed" args={{ open: false }}>
  {#snippet template(args)}<p class="text-muted-foreground t-caption">
      Dialog is closed (toggle the `open` control).
    </p>
    <ExportDialog {...args} />{/snippet}
</Story>

<Story name="CSV only" args={{ formats: ['csv'] }}>
  {#snippet template(args)}<ExportDialog {...args} />{/snippet}
</Story>

<Story
  name="No defaults selected"
  args={{ columns: columns.map((c) => ({ ...c, default: false })) }}
>
  {#snippet template(args)}<ExportDialog {...args} />{/snippet}
</Story>

<Story name="Zero rows" args={{ count: 0 }}>
  {#snippet template(args)}<ExportDialog {...args} />{/snippet}
</Story>

<Story name="Large count" args={{ count: 1_000_000_000 }}>
  {#snippet template(args)}<ExportDialog {...args} />{/snippet}
</Story>

<Story
  name="Thirty columns"
  args={{
    columns: Array.from({ length: 30 }, (_, i) => ({
      key: `c${i}`,
      label: i % 5 === 0 ? `Column ${i + 1} with a rather long header label` : `Column ${i + 1}`,
      default: i % 2 === 0,
    })),
  }}
>
  {#snippet template(args)}<ExportDialog {...args} />{/snippet}
</Story>
