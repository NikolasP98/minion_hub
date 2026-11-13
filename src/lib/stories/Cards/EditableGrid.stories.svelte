<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import EditableGrid from '$lib/components/dashboard/EditableGrid.svelte';

  const items = [
    { id: 'sales', label: 'Sales today', w: 2, h: 1 },
    { id: 'tickets', label: 'Tickets', w: 1, h: 1 },
    { id: 'stock', label: 'Low stock', w: 1, h: 2 },
    { id: 'trend', label: 'Weekly trend', w: 2, h: 2 },
  ];
  const many = Array.from({ length: 12 }, (_, i) => ({
    id: `w${i}`,
    label: `Widget ${i + 1}`,
    w: 1 + (i % 2),
    h: 1,
  }));

  const { Story } = defineMeta({
    title: 'Components/Cards/EditableGrid',
    component: EditableGrid,
    tags: ['autodocs'],
    argTypes: {
      readonly: { control: 'boolean' },
      canSetDefault: { control: 'boolean' },
      cols: { control: 'number' },
    },
    args: { id: 'story-grid', items, readonly: false, canSetDefault: false, cols: 4 },
  });
</script>

{#snippet cell(id: string)}
  <article
    class="h-full p-3 border border-border rounded-[var(--radius-md)] bg-surface-1 text-foreground"
  >
    {id}
  </article>
{/snippet}

<Story name="Default">
  {#snippet template(args)}<EditableGrid {...args} {cell} />{/snippet}
</Story>

<Story name="Editing" args={{ editing: true }}>
  {#snippet template(args)}<EditableGrid {...args} {cell} />{/snippet}
</Story>

<Story name="Read only" args={{ readonly: true }}>
  {#snippet template(args)}<EditableGrid {...args} {cell} />{/snippet}
</Story>

<Story name="Admin (save as default)" args={{ canSetDefault: true, editing: true }}>
  {#snippet template(args)}<EditableGrid {...args} {cell} />{/snippet}
</Story>

<Story name="Controlled (onchange)" args={{ onchange: fn(), editing: true }}>
  {#snippet template(args)}<EditableGrid {...args} {cell} />{/snippet}
</Story>

<Story name="Many items, 6 columns" args={{ id: 'story-grid-many', items: many, cols: 6 }}>
  {#snippet template(args)}<EditableGrid {...args} {cell} />{/snippet}
</Story>

<Story name="Single item" args={{ id: 'story-grid-one', items: [items[0]] }}>
  {#snippet template(args)}<EditableGrid {...args} {cell} />{/snippet}
</Story>

<Story name="With toolbar" args={{ editing: false }}>
  {#snippet template(args)}
    <EditableGrid {...args} {cell}>
      {#snippet toolbar()}<span class="t-caption text-muted-foreground">Last 7 days</span>{/snippet}
    </EditableGrid>
  {/snippet}
</Story>

<!-- Responsive: below a 620px container the grid is one column and every card is full width. -->
<Story name="Default · Phone" globals={{ viewport: { value: 'phone', isRotated: false } }}>
  {#snippet template(args)}<EditableGrid {...args} {cell} />{/snippet}
</Story>

<Story
  name="Many items, 6 columns · Tablet"
  args={{ id: 'story-grid-many-tablet', items: many, cols: 6 }}
  globals={{ viewport: { value: 'tablet', isRotated: false } }}
>
  {#snippet template(args)}<EditableGrid {...args} {cell} />{/snippet}
</Story>
