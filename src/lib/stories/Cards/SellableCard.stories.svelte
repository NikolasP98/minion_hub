<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import SellableCard from '$lib/components/pos/SellableCard.svelte';
  import { SELLABLE_CARD_FIELDS } from '$lib/pos/sellable-card-fields';

  const allFields = SELLABLE_CARD_FIELDS.map((f) => f.key);
  const product = {
    name: 'Hyaluronic acid filler 1 ml',
    code: 'HA-1ML',
    unitPrice: 890,
    kind: 'product',
    stockQty: 24,
    category: 'Injectables',
    active: true,
    taxonomy: { zone: 'face', line: 'aesthetic' },
    tags: [{ name: 'premium' }],
    inheritedTags: [{ name: 'injectable' }],
  };

  const { Story } = defineMeta({
    title: 'Cards/SellableCard',
    component: SellableCard,
    tags: ['autodocs'],
    argTypes: { hideEmpty: { control: 'boolean' } },
    args: { row: product, fields: allFields, hideEmpty: false },
  });
</script>

<!-- The component owns no box: the host card is simulated here. -->
<Story name="Product, all fields">
  {#snippet template(args)}
    <div class="w-56 flex flex-col gap-1 p-3 border border-border rounded-[var(--radius-md)] bg-surface-1"><SellableCard {...args} /></div>
  {/snippet}
</Story>

<Story name="Service" args={{ row: { ...product, name: 'Botox 3 zones', code: 'BTX-3', kind: 'service', stockQty: null, unitPrice: 1200, category: 'Treatments' } }}>
  {#snippet template(args)}
    <div class="w-56 flex flex-col gap-1 p-3 border border-border rounded-[var(--radius-md)] bg-surface-1"><SellableCard {...args} /></div>
  {/snippet}
</Story>

<Story name="Bundle" args={{ row: { ...product, name: 'Glow pack (3 sessions)', code: 'PK-GLOW', kind: 'bundle', stockQty: null, unitPrice: 2500 } }}>
  {#snippet template(args)}
    <div class="w-56 flex flex-col gap-1 p-3 border border-border rounded-[var(--radius-md)] bg-surface-1"><SellableCard {...args} /></div>
  {/snippet}
</Story>

<Story name="Price only" args={{ fields: ['price'] }}>
  {#snippet template(args)}
    <div class="w-56 flex flex-col gap-1 p-3 border border-border rounded-[var(--radius-md)] bg-surface-1"><SellableCard {...args} /></div>
  {/snippet}
</Story>

<Story
  name="Missing values (rows kept)"
  args={{ row: { name: 'Mystery item', code: '', unitPrice: null, kind: 'product', stockQty: null, category: null, active: true, taxonomy: { zone: null, line: null } } }}
>
  {#snippet template(args)}
    <div class="w-56 flex flex-col gap-1 p-3 border border-border rounded-[var(--radius-md)] bg-surface-1"><SellableCard {...args} /></div>
  {/snippet}
</Story>

<Story
  name="Missing values (hideEmpty)"
  args={{ hideEmpty: true, row: { name: 'Mystery item', code: '', unitPrice: null, kind: 'product', stockQty: null, category: null, active: true, taxonomy: { zone: null, line: null } } }}
>
  {#snippet template(args)}
    <div class="w-56 flex flex-col gap-1 p-3 border border-border rounded-[var(--radius-md)] bg-surface-1"><SellableCard {...args} /></div>
  {/snippet}
</Story>

<Story name="Stock tones">
  {#snippet template(args)}
    <div class="flex gap-2">
      {#each [24, 5, 0] as stockQty (stockQty)}
        <div class="w-40 flex flex-col gap-1 p-3 border border-border rounded-[var(--radius-md)] bg-surface-1">
          <SellableCard {...args} row={{ ...product, stockQty }} fields={['price', 'stock']} />
        </div>
      {/each}
    </div>
  {/snippet}
</Story>

<Story name="Inactive" args={{ row: { ...product, active: false } }}>
  {#snippet template(args)}
    <div class="w-56 flex flex-col gap-1 p-3 border border-border rounded-[var(--radius-md)] bg-surface-1"><SellableCard {...args} /></div>
  {/snippet}
</Story>

<Story
  name="Long name and large price"
  args={{
    row: {
      ...product,
      name: 'Tratamiento combinado de rejuvenecimiento facial con ácido hialurónico y bioestimuladores de colágeno (protocolo completo)',
      code: 'TRT-COMBO-REJUV-FACIAL-2026-XL',
      unitPrice: 1234567890.5,
      tags: Array.from({ length: 8 }, (_, i) => ({ name: `tag-${i + 1}` })),
    },
  }}
>
  {#snippet template(args)}
    <div class="w-56 flex flex-col gap-1 p-3 border border-border rounded-[var(--radius-md)] bg-surface-1"><SellableCard {...args} /></div>
  {/snippet}
</Story>
