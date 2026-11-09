<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import FieldsList from '$lib/components/scheduling/FieldsList.svelte';

  const fields = [
    { key: 'time', label: 'Time' },
    {
      key: 'customer',
      label: 'Customer',
      children: [
        { key: 'customer.phone', label: 'Phone' },
        { key: 'customer.tags', label: 'Tags' },
      ],
    },
    { key: 'service', label: 'Service' },
    { key: 'resource', label: 'Team member' },
    { key: 'price', label: 'Price' },
    { key: 'status', label: 'Status badge' },
    { key: 'notes', label: 'Notes' },
  ];
  const order = fields.map((f) => f.key);

  const { Story } = defineMeta({
    title: 'Forms/FieldsList',
    component: FieldsList,
    tags: ['autodocs'],
    args: {
      heading: 'Card fields',
      fields,
      order,
      hidden: new Set(),
      ontoggle: fn(),
      onmove: fn(),
    },
  });
</script>

<Story name="Default">
  {#snippet template(args)}<div class="w-64 border border-border bg-surface-1">
      <FieldsList {...args} />
    </div>{/snippet}
</Story>

<Story name="Some hidden" args={{ hidden: new Set(['price', 'notes', 'customer.tags']) }}>
  {#snippet template(args)}<div class="w-64 border border-border bg-surface-1">
      <FieldsList {...args} />
    </div>{/snippet}
</Story>

<Story name="Locked rows" args={{ lockedKeys: ['status', 'time'] }}>
  {#snippet template(args)}<div class="w-64 border border-border bg-surface-1">
      <FieldsList {...args} />
    </div>{/snippet}
</Story>

<Story
  name="Reordered"
  args={{ order: ['service', 'customer', 'time', 'price', 'resource', 'status', 'notes'] }}
>
  {#snippet template(args)}<div class="w-64 border border-border bg-surface-1">
      <FieldsList {...args} />
    </div>{/snippet}
</Story>

<Story name="Single field" args={{ fields: [fields[0]], order: ['time'] }}>
  {#snippet template(args)}<div class="w-64 border border-border bg-surface-1">
      <FieldsList {...args} />
    </div>{/snippet}
</Story>

<Story
  name="Many fields, long labels"
  args={{
    fields: Array.from({ length: 20 }, (_, i) => ({
      key: `f${i}`,
      label:
        i % 4 === 0
          ? `Field ${i + 1} with an unusually long label that does not fit the menu width`
          : `Field ${i + 1}`,
    })),
    order: Array.from({ length: 20 }, (_, i) => `f${i}`),
  }}
>
  {#snippet template(args)}<div class="w-64 border border-border bg-surface-1">
      <FieldsList {...args} />
    </div>{/snippet}
</Story>
