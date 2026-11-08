<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import ProcedurePickerField from '$lib/components/scheduling/ProcedurePickerField.svelte';

  const products = [
    { id: 'p1', name: 'Botox 3 zones' },
    { id: 'p2', name: 'HA filler 1 ml' },
    { id: 'p3', name: 'Chemical peel' },
    { id: 'p4', name: 'Laser session' },
    { id: 'p5', name: 'Tratamiento combinado de rejuvenecimiento facial (protocolo completo)' },
  ];
  const many = Array.from({ length: 60 }, (_, i) => ({ id: `m${i}`, name: `Procedure ${i + 1}` }));

  const { Story } = defineMeta({
    title: 'Forms/ProcedurePickerField',
    component: ProcedurePickerField,
    tags: ['autodocs'],
    args: { products, value: null },
  });
</script>

<Story name="Empty">
  {#snippet template(args)}<div class="w-80"><ProcedurePickerField {...args} /></div>{/snippet}
</Story>

<Story name="Selected" args={{ value: 'p2' }}>
  {#snippet template(args)}<div class="w-80"><ProcedurePickerField {...args} /></div>{/snippet}
</Story>

<Story name="Selected, long name" args={{ value: 'p5' }}>
  {#snippet template(args)}<div class="w-64 border border-border"><ProcedurePickerField {...args} /></div>{/snippet}
</Story>

<Story name="No products" args={{ products: [] }}>
  {#snippet template(args)}<div class="w-80"><ProcedurePickerField {...args} /></div>{/snippet}
</Story>

<Story name="Sixty products" args={{ products: many, value: 'm41' }}>
  {#snippet template(args)}<div class="w-80"><ProcedurePickerField {...args} /></div>{/snippet}
</Story>

<Story name="Stale value (not in list)" args={{ value: 'gone' }}>
  {#snippet template(args)}<div class="w-80"><ProcedurePickerField {...args} /></div>{/snippet}
</Story>
