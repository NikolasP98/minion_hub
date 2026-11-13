<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import GroupByPicker from '$lib/components/data-table/GroupByPicker.svelte';

  const options = [
    { value: 'status', label: 'Status' },
    { value: 'staff', label: 'Staff member' },
    { value: 'category', label: 'Product category' },
    { value: 'zone', label: 'Warehouse zone (secondary location)' },
  ];

  const { Story } = defineMeta({
    title: 'Components/Data/GroupByPicker',
    component: GroupByPicker,
    tags: ['autodocs'],
    argTypes: { value: { control: 'select', options: ['', ...options.map((o) => o.value)] } },
    args: { options, value: '', onChange: fn() },
  });
</script>

<script lang="ts">
  let picked = $state('staff');
</script>

<Story name="Idle">
  {#snippet template(args)}
    <GroupByPicker {...args} />
  {/snippet}
</Story>

<Story name="Picked" args={{ value: 'status' }}>
  {#snippet template(args)}
    <GroupByPicker {...args} />
  {/snippet}
</Story>

<Story name="LongLabel" args={{ value: 'zone' }}>
  {#snippet template(args)}
    <GroupByPicker {...args} />
  {/snippet}
</Story>

<Story name="WithNoneLabel" args={{ value: 'category', noneLabel: 'No grouping' }}>
  {#snippet template(args)}
    <GroupByPicker {...args} />
  {/snippet}
</Story>

<Story name="Interactive">
  {#snippet template(args)}
    <GroupByPicker {...args} value={picked} onChange={(v) => (picked = v)} noneLabel="None" />
    <p class="mt-3 text-xs text-muted-foreground">value = "{picked}"</p>
  {/snippet}
</Story>
