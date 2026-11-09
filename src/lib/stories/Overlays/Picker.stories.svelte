<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import Picker from '$lib/components/ui/Picker.svelte';
  import { Button, Input } from '$lib/components/ui';

  const rows = Array.from({ length: 18 }, (_, i) => ({
    id: `p-${i + 1}`,
    name:
      ['Keratin treatment', 'Haircut', 'Beard trim', 'Hair colour', 'Manicure', 'Pedicure'][i % 6] +
      (i >= 6 ? ` ${Math.floor(i / 6) + 1}` : ''),
    sku: `SKU-${String(1000 + i)}`,
    price: ((i + 1) * 17.5).toFixed(2),
    category: ['Hair', 'Hair', 'Beard', 'Hair', 'Nails', 'Nails'][i % 6],
  }));

  const columns = [
    { key: 'name', label: 'Name', emphasis: 'primary', searchable: true, priority: 1 },
    { key: 'sku', label: 'SKU', searchable: true, priority: 2 },
    { key: 'category', label: 'Category', priority: 3, defaultHidden: true },
    { key: 'price', label: 'Price', align: 'right', priority: 4, value: (r) => `S/ ${r.price}` },
  ];

  const { Story } = defineMeta({
    title: 'Overlays/Picker',
    component: Picker,
    tags: ['autodocs'],
    parameters: { docs: { story: { inline: false, height: '600px' } } },
    argTypes: {
      selectionMode: { control: 'select', options: ['single', 'multiple'] },
      duplicatePolicy: { control: 'select', options: ['allow', 'prevent'] },
      columnsConfigurable: { control: 'boolean' },
    },
    args: {
      open: true,
      title: 'Add a service',
      columns,
      rows,
      getRowId: (r) => r.id,
      onPick: fn(),
      onclose: fn(),
      selectionMode: 'single',
      columnsConfigurable: false,
    },
  });
</script>

<script>
  let triggerOpen = $state(false);
  let picked = $state(new Set(['p-2', 'p-5']));
</script>

{#snippet createForm(ctx)}
  <div class="space-y-3 p-1">
    <Input label="Name" value={ctx.query} oninput={() => ctx.setDirty(true)} />
    <div class="flex gap-2 justify-end">
      <Button variant="ghost" size="sm" onclick={ctx.oncancel}>Cancel</Button>
      <Button
        size="sm"
        onclick={() =>
          ctx.oncreated({
            id: `new-${Date.now()}`,
            name: ctx.query || 'New service',
            sku: 'SKU-NEW',
            price: '0.00',
            category: 'Hair',
          })}>Create</Button
      >
    </div>
  </div>
{/snippet}

<Story name="Open (single)">
  {#snippet template(args)}
    <Picker {...args} />
  {/snippet}
</Story>

<Story
  name="Multiple with picked rows"
  args={{ selectionMode: 'multiple', subtitle: 'Picked rows are blocked (no onUnpick)' }}
>
  {#snippet template(args)}
    <Picker {...args} pickedIds={new Set(['p-1', 'p-3'])} />
  {/snippet}
</Story>

<Story
  name="Multiple with remove toggles (onUnpick)"
  args={{ selectionMode: 'multiple', subtitle: 'Picked rows can be removed from here' }}
>
  {#snippet template(args)}
    <Picker
      {...args}
      pickedIds={picked}
      onPick={(r) => (picked = new Set([...picked, r.id]))}
      onUnpick={(r) => (picked = new Set([...picked].filter((id) => id !== r.id)))}
    />
  {/snippet}
</Story>

<Story name="Empty" args={{ rows: [], emptyLabel: 'No services yet' }}>
  {#snippet template(args)}
    <Picker {...args} />
  {/snippet}
</Story>

<Story
  name="Loading (async never resolves)"
  args={{ rows: undefined, loadRows: () => new Promise(() => {}) }}
>
  {#snippet template(args)}
    <Picker {...args} />
  {/snippet}
</Story>

<Story
  name="Load error"
  args={{ rows: undefined, loadRows: () => Promise.reject(new Error('Network down')) }}
>
  {#snippet template(args)}
    <Picker {...args} />
  {/snippet}
</Story>

<Story
  name="Async source with server total"
  args={{
    rows: undefined,
    loadRows: async (q) => ({
      rows: rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase())).slice(0, 5),
      total: 1240,
    }),
  }}
>
  {#snippet template(args)}
    <Picker {...args} />
  {/snippet}
</Story>

<Story name="Initial search" args={{ initialSearch: 'hair' }}>
  {#snippet template(args)}
    <Picker {...args} />
  {/snippet}
</Story>

<Story name="Columns configurable" args={{ columnsConfigurable: true }}>
  {#snippet template(args)}
    <Picker {...args} />
  {/snippet}
</Story>

<Story name="Disabled rows with reason">
  {#snippet template(args)}
    <Picker
      {...args}
      isRowDisabled={(r) => r.category === 'Nails'}
      rowDisabledReason={(r) =>
        r.category === 'Nails' ? 'Nail services need a different room' : undefined}
    />
  {/snippet}
</Story>

<Story name="With create tab">
  {#snippet template(args)}
    <Picker
      {...args}
      create={{
        label: 'New service',
        tabLabel: 'Create',
        description: 'Quick-add from the search text.',
        form: createForm,
      }}
    />
  {/snippet}
</Story>

<Story name="Trigger" args={{ open: false }}>
  {#snippet template(args)}
    <Button onclick={() => (triggerOpen = true)}>Open picker</Button>
    <Picker {...args} bind:open={triggerOpen} />
  {/snippet}
</Story>

<!-- Responsive: below 768px the toolbar wraps and the search takes a full row; the keyboard hint hides on coarse pointers. -->
<Story name="Open (single) · Phone" globals={{ viewport: { value: 'phone', isRotated: false } }}>
  {#snippet template(args)}
    <Picker {...args} />
  {/snippet}
</Story>
