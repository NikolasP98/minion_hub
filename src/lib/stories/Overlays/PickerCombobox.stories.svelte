<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import type { PlayFunction } from 'storybook/internal/types';
  import PickerCombobox from '$lib/components/ui/PickerCombobox.svelte';

  const items = [
    { id: 'u1', name: 'Andrea Quispe', role: 'Stylist' },
    { id: 'u2', name: 'Bruno Paredes', role: 'Barber' },
    { id: 'u3', name: 'Carla Mendoza', role: 'Receptionist' },
    { id: 'u4', name: 'Diego Torres', role: 'Stylist' },
    { id: 'u5', name: 'Elena Rojas', role: 'Manager' },
  ];

  type Person = (typeof items)[number];

  const { Story } = defineMeta({
    title: 'Atoms/Inputs/PickerCombobox',
    component: PickerCombobox,
    tags: ['autodocs'],
    parameters: { docs: { story: { inline: false, height: '360px' } } },
    argTypes: { disabled: { control: 'boolean' } },
    args: {
      id: 'sb-picker-combobox',
      items,
      // PickerCombobox is generic; props are inferred with T = unknown here.
      itemToValue: (i) => (i as Person).id,
      itemToString: (i) => (i as Person).name,
      label: 'Assignee',
      placeholder: 'Type a name',
      pickerTitle: 'Pick a team member',
      pickerLabel: 'Open the full picker',
      columns: [
        { key: 'name', label: 'Name', emphasis: 'primary', searchable: true },
        { key: 'role', label: 'Role', searchable: true },
      ],
      disabled: false,
      onchange: fn(),
    },
  });

  const openPicker: PlayFunction = async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Open the full picker' }));
  };
</script>

<Story name="Default">
  {#snippet template(args)}
    <div class="max-w-sm"><PickerCombobox {...args} /></div>
  {/snippet}
</Story>

<Story name="Preselected" args={{ id: 'sb-picker-combobox-value', value: 'u3' }}>
  {#snippet template(args)}
    <div class="max-w-sm"><PickerCombobox {...args} /></div>
  {/snippet}
</Story>

<Story name="Picker window open" args={{ id: 'sb-picker-combobox-open' }} play={openPicker}>
  {#snippet template(args)}
    <div class="max-w-sm"><PickerCombobox {...args} /></div>
  {/snippet}
</Story>

<Story name="Disabled" args={{ id: 'sb-picker-combobox-disabled', disabled: true }}>
  {#snippet template(args)}
    <div class="max-w-sm"><PickerCombobox {...args} /></div>
  {/snippet}
</Story>

<Story
  name="Empty items"
  args={{ id: 'sb-picker-combobox-empty', items: [], emptyLabel: 'No one matches' }}
  play={openPicker}
>
  {#snippet template(args)}
    <div class="max-w-sm"><PickerCombobox {...args} /></div>
  {/snippet}
</Story>
