<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import ServicePickerField from '$lib/components/scheduling/ServicePickerField.svelte';

  const services = [
    { id: 's1', title: 'Consultation', length: 30 },
    { id: 's2', title: 'Botox 3 zones', length: 45 },
    { id: 's3', title: 'HA filler 1 ml', length: 60 },
    { id: 's4', title: 'Retired peel', length: 40, active: false },
    {
      id: 's5',
      title: 'Tratamiento combinado de rejuvenecimiento facial (protocolo completo)',
      length: 180,
    },
    { id: 's6', title: 'No length set' },
  ];

  const { Story } = defineMeta({
    title: 'Components/Forms/ServicePickerField',
    component: ServicePickerField,
    tags: ['autodocs'],
    args: { services, value: '', onchange: fn() },
  });
</script>

<Story name="Empty">
  {#snippet template(args)}<div class="w-80"><ServicePickerField {...args} /></div>{/snippet}
</Story>

<Story name="Selected" args={{ value: 's2' }}>
  {#snippet template(args)}<div class="w-80"><ServicePickerField {...args} /></div>{/snippet}
</Story>

<Story name="Selected inactive service (still resolves)" args={{ value: 's4' }}>
  {#snippet template(args)}<div class="w-80"><ServicePickerField {...args} /></div>{/snippet}
</Story>

<Story name="Selected, long title" args={{ value: 's5' }}>
  {#snippet template(args)}<div class="w-64 border border-border">
      <ServicePickerField {...args} />
    </div>{/snippet}
</Story>

<Story name="No services" args={{ services: [] }}>
  {#snippet template(args)}<div class="w-80"><ServicePickerField {...args} /></div>{/snippet}
</Story>

<Story
  name="Sixty services"
  args={{
    services: Array.from({ length: 60 }, (_, i) => ({
      id: `m${i}`,
      title: `Service ${i + 1}`,
      length: 15 * (1 + (i % 8)),
    })),
  }}
>
  {#snippet template(args)}<div class="w-80"><ServicePickerField {...args} /></div>{/snippet}
</Story>
