<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import ColorSourcePicker, {
    type ColorSourceOption,
  } from '$lib/components/scheduling/ColorSourcePicker.svelte';

  const options: ColorSourceOption[] = [
    {
      value: 'status',
      label: 'Status',
      source: 'status',
      values: [
        { name: 'Confirmed', color: 'var(--color-info-border)' },
        { name: 'Pending', color: 'var(--color-warning-border)' },
        { name: 'Completed', color: 'var(--color-success-border)' },
        { name: 'No-show', color: 'var(--color-danger-border)' },
      ],
    },
    {
      value: 'staff',
      label: 'Staff',
      source: 'staff',
      values: [
        { name: 'Ana Quispe', color: 'var(--color-info-border)' },
        { name: 'Luis Fernández de la Torre', color: 'var(--color-success-border)' },
        { name: 'Mar', color: 'var(--color-border-strong)' },
      ],
    },
    {
      value: 'tags',
      label: 'Tags',
      source: 'tags',
      values: Array.from({ length: 14 }, (_, i) => ({
        name: `Tag ${i + 1}`,
        color: i % 2 ? 'var(--color-warning-border)' : 'var(--color-info-border)',
      })),
    },
    { value: 'category', label: 'Category', source: 'category', values: [] },
    { value: 'none', label: 'None', source: 'none', values: [] },
  ];

  const { Story } = defineMeta({
    title: 'Components/Calendar/ColorSourcePicker',
    component: ColorSourcePicker,
    tags: ['autodocs'],
    argTypes: { value: { control: 'select', options: options.map((o) => o.value) } },
    args: { label: 'Block colour', value: 'status', options, onchange: fn() },
  });
</script>

<Story name="Status selected" />
<Story name="Staff selected" args={{ value: 'staff', label: 'Sliver colour' }} />
<Story name="Many values (capped preview)" args={{ value: 'tags' }} />
<Story name="None" args={{ value: 'none' }} />
<Story name="Single option" args={{ options: options.slice(0, 1) }} />
