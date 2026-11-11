<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import ResourcePickerField from '$lib/components/scheduling/ResourcePickerField.svelte';

  const resources = [
    { id: 'r1', name: 'Lucía Fernández', kind: 'staff', email: 'lucia@example.com' },
    { id: 'r2', name: 'Marco Quispe', kind: 'staff', email: 'marco@example.com' },
    { id: 'r3', name: 'Ana Torres', kind: 'staff', email: null },
    { id: 'r4', name: 'On vacation', kind: 'staff', email: 'away@example.com', active: false },
    { id: 'r5', name: 'Room 1', kind: 'room' },
    {
      id: 'r6',
      name: 'Maximiliano Alejandro de la Cruz Villanueva-Echeverría',
      kind: 'staff',
      email: 'max@example.com',
    },
  ];

  const { Story } = defineMeta({
    title: 'Components/Forms/ResourcePickerField',
    component: ResourcePickerField,
    tags: ['autodocs'],
    args: { resources, value: [] },
  });
</script>

<Story name="Empty">
  {#snippet template(args)}<div class="w-80"><ResourcePickerField {...args} /></div>{/snippet}
</Story>

<Story name="One selected" args={{ value: ['r1'] }}>
  {#snippet template(args)}<div class="w-80"><ResourcePickerField {...args} /></div>{/snippet}
</Story>

<Story name="Several selected" args={{ value: ['r1', 'r2', 'r3'] }}>
  {#snippet template(args)}<div class="w-80"><ResourcePickerField {...args} /></div>{/snippet}
</Story>

<Story name="Inactive member still assigned" args={{ value: ['r1', 'r4'] }}>
  {#snippet template(args)}<div class="w-80"><ResourcePickerField {...args} /></div>{/snippet}
</Story>

<Story name="Long name" args={{ value: ['r6'] }}>
  {#snippet template(args)}<div class="w-64 border border-border">
      <ResourcePickerField {...args} />
    </div>{/snippet}
</Story>

<Story name="No staff (rooms only)" args={{ resources: [resources[4]] }}>
  {#snippet template(args)}<div class="w-80"><ResourcePickerField {...args} /></div>{/snippet}
</Story>

<Story
  name="Forty members, twenty selected"
  args={{
    resources: Array.from({ length: 40 }, (_, i) => ({
      id: `m${i}`,
      name: `Member ${i + 1}`,
      kind: 'staff',
      email: `m${i}@example.com`,
    })),
    value: Array.from({ length: 20 }, (_, i) => `m${i}`),
  }}
>
  {#snippet template(args)}<div class="w-80 border border-border">
      <ResourcePickerField {...args} />
    </div>{/snippet}
</Story>
