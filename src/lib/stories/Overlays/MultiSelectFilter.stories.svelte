<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import MultiSelectFilter from '$lib/components/ui/MultiSelectFilter.svelte';

  const options = [
    { value: 'draft', label: 'Draft', color: 'var(--color-muted-foreground)', count: 12 },
    { value: 'confirmed', label: 'Confirmed', color: 'var(--color-accent)', count: 48 },
    { value: 'paid', label: 'Paid', color: 'var(--color-success)', count: 131 },
    { value: 'cancelled', label: 'Cancelled', color: 'var(--color-destructive)', count: 7 },
    { value: 'no-show', label: 'No-show', color: 'var(--color-warning)', count: 3 },
  ];
  const plain = options.map(({ value, label }) => ({ value, label }));

  const { Story } = defineMeta({
    title: 'Overlays/MultiSelectFilter',
    component: MultiSelectFilter,
    tags: ['autodocs'],
    parameters: { docs: { story: { inline: false, height: '280px' } } },
    args: { label: 'Status', options, allLabel: 'All statuses' },
  });

  const open = async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getAllByRole('button')[0]);
  };
</script>

<script>
  // Presentational: selection lives in the parent.
  let selected = $state(new Set(['confirmed', 'paid']));
  function toggle(v) {
    selected = new Set(selected.has(v) ? [...selected].filter((x) => x !== v) : [...selected, v]);
  }
</script>

<Story name="Nothing selected">
  {#snippet template(args)}
    <MultiSelectFilter {...args} selected={new Set()} onToggle={() => {}} onClear={() => {}} />
  {/snippet}
</Story>

<Story name="Selected (interactive)">
  {#snippet template(args)}
    <MultiSelectFilter
      {...args}
      {selected}
      onToggle={toggle}
      onClear={() => (selected = new Set())}
    />
  {/snippet}
</Story>

<Story name="Open" play={open}>
  {#snippet template(args)}
    <MultiSelectFilter
      {...args}
      {selected}
      onToggle={toggle}
      onClear={() => (selected = new Set())}
    />
  {/snippet}
</Story>

<Story name="No colours or counts" args={{ options: plain }}>
  {#snippet template(args)}
    <MultiSelectFilter
      {...args}
      selected={new Set(['draft'])}
      onToggle={() => {}}
      onClear={() => {}}
    />
  {/snippet}
</Story>

<Story name="Everything selected (many pills)">
  {#snippet template(args)}
    <MultiSelectFilter
      {...args}
      selected={new Set(options.map((o) => o.value))}
      onToggle={() => {}}
      onClear={() => {}}
    />
  {/snippet}
</Story>

<Story
  name="Long labels"
  args={{
    label: 'Payment method',
    options: [
      { value: 'a', label: 'Bank transfer (BCP, interbank, same day)' },
      { value: 'b', label: 'Card via POS terminal with 3 instalments' },
    ],
  }}
>
  {#snippet template(args)}
    <MultiSelectFilter
      {...args}
      selected={new Set(['a', 'b'])}
      onToggle={() => {}}
      onClear={() => {}}
    />
  {/snippet}
</Story>

<!-- Responsive: options grow to the 44px touch height below 768px. -->
<Story name="Open · Phone" play={open} globals={{ viewport: { value: 'phone', isRotated: false } }}>
  {#snippet template(args)}
    <MultiSelectFilter
      {...args}
      {selected}
      onToggle={toggle}
      onClear={() => (selected = new Set())}
    />
  {/snippet}
</Story>
