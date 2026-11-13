<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import type { PlayFunction } from 'storybook/internal/types';
  import Combobox from '$lib/components/ui/Combobox.svelte';
  import { comboboxOnTop, showModal } from './top-layer-play';

  const items = [
    { id: 'lima', name: 'Lima', region: 'Coast' },
    { id: 'arequipa', name: 'Arequipa', region: 'Highlands' },
    { id: 'cusco', name: 'Cusco', region: 'Highlands' },
    { id: 'trujillo', name: 'Trujillo', region: 'Coast' },
    { id: 'iquitos', name: 'Iquitos', region: 'Jungle' },
    { id: 'piura', name: 'Piura', region: 'Coast' },
    { id: 'huancayo', name: 'Huancayo', region: 'Highlands' },
    { id: 'tacna', name: 'Tacna', region: 'Coast' },
  ];

  type City = (typeof items)[number];

  const { Story } = defineMeta({
    title: 'Atoms/Inputs/Combobox',
    component: Combobox,
    tags: ['autodocs'],
    parameters: { docs: { story: { inline: false, height: '320px' } } },
    argTypes: { disabled: { control: 'boolean' } },
    args: {
      id: 'sb-combobox',
      items,
      // Combobox is generic; its props are inferred with T = unknown here.
      itemToValue: (i) => (i as City).id,
      itemToString: (i) => (i as City).name,
      placeholder: 'Search a city',
      label: 'City',
      disabled: false,
      onValueChange: fn(),
    },
  });

  // Click the chevron so the list is open for docs.
  const open: PlayFunction = async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getAllByRole('button')[0]);
  };
  const noMatch: PlayFunction = async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole('combobox'), 'zzz');
  };
</script>

<Story name="Default">
  {#snippet template(args)}
    <div class="max-w-xs"><Combobox {...args} /></div>
  {/snippet}
</Story>

<Story name="Open" args={{ id: 'sb-combobox-open' }} play={open}>
  {#snippet template(args)}
    <div class="max-w-xs"><Combobox {...args} /></div>
  {/snippet}
</Story>

<Story name="Preselected" args={{ id: 'sb-combobox-value', value: 'cusco' }}>
  {#snippet template(args)}
    <div class="max-w-xs"><Combobox {...args} /></div>
  {/snippet}
</Story>

<Story name="No label" args={{ id: 'sb-combobox-nolabel', label: undefined }}>
  {#snippet template(args)}
    <div class="max-w-xs"><Combobox {...args} /></div>
  {/snippet}
</Story>

<Story name="No matches" args={{ id: 'sb-combobox-nomatch' }} play={noMatch}>
  {#snippet template(args)}
    <div class="max-w-xs"><Combobox {...args} /></div>
  {/snippet}
</Story>

<Story name="Disabled" args={{ id: 'sb-combobox-disabled', disabled: true, value: 'lima' }}>
  {#snippet template(args)}
    <div class="max-w-xs"><Combobox {...args} /></div>
  {/snippet}
</Story>

<Story name="Empty item list" args={{ id: 'sb-combobox-empty', items: [] }} play={open}>
  {#snippet template(args)}
    <div class="max-w-xs"><Combobox {...args} /></div>
  {/snippet}
</Story>

<Story name="Custom item" args={{ id: 'sb-combobox-custom' }} play={open}>
  {#snippet template(args)}
    <div class="max-w-xs">
      <Combobox {...args}>
        {#snippet item({ item, selected, itemTextProps })}
          {@const city = item as City}
          <span
            {...itemTextProps}
            class="flex w-full items-center justify-between gap-3 px-2 py-1 text-sm {selected
              ? 'text-accent'
              : 'text-foreground'}"
          >
            <span>{city.name}</span>
            <span class="text-xs text-muted-foreground">{city.region}</span>
          </span>
        {/snippet}
      </Combobox>
    </div>
  {/snippet}
</Story>

<Story name="InsideModalDialog" play={comboboxOnTop}>
  {#snippet template()}
    <dialog
      {@attach showModal}
      data-testid="clip"
      class="m-auto w-72 surface-3 rounded-[var(--radius-lg)] p-4 text-sm text-foreground"
    >
      <Combobox
        id="sb-combobox-dialog"
        {items}
        itemToValue={(i) => i.id}
        itemToString={(i) => i.name}
        label="City"
        placeholder="Search a city"
      />
    </dialog>
  {/snippet}
</Story>

<Story name="InsideOverflowHidden" play={comboboxOnTop}>
  {#snippet template()}
    <div class="sb-clip-stage">
      <div data-testid="clip" class="sb-clip-box w-64">
        <Combobox
          id="sb-combobox-clipped"
          {items}
          itemToValue={(i) => i.id}
          itemToString={(i) => i.name}
          label="City"
          placeholder="Search a city"
        />
      </div>
      <div aria-hidden="true" class="sb-clip-cover surface-4 p-2 text-xs text-muted-foreground">
        A higher z-index sibling over the list's area.
      </div>
    </div>
  {/snippet}
</Story>
