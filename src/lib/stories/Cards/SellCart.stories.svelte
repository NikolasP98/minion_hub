<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import SellCart from '$lib/components/pos/SellCart.svelte';

  const sellable = (i, over = {}) => ({
    productId: `p${i}`,
    code: `SKU-${100 + i}`,
    name: [
      'Botox 3 zones',
      'HA filler 1 ml',
      'Chemical peel',
      'Laser session',
      'Consultation',
      'Sunscreen SPF50',
    ][i % 6],
    category: 'Treatments',
    unitPrice: [1200, 890, 350, 600, 150, 95][i % 6],
    active: true,
    kind: i % 6 === 5 ? 'product' : 'service',
    stockQty: i % 6 === 5 ? 12 : null,
    hasMapping: true,
    ...over,
  });
  const line = (i, over = {}) => ({
    sellable: sellable(i),
    qty: '1',
    unitPrice: String(sellable(i).unitPrice),
    discount: '0',
    ...over,
  });
  const lines = (n) => Array.from({ length: n }, (_, i) => line(i));

  const { Story } = defineMeta({
    title: 'Cards/SellCart',
    component: SellCart,
    tags: ['autodocs'],
    argTypes: { readOnly: { control: 'boolean' } },
    args: { settings: { allowPriceOverride: true }, readOnly: false },
  });
</script>

<Story name="Empty" args={{ lines: [] }}>
  {#snippet template(args)}<div class="w-80"><SellCart {...args} /></div>{/snippet}
</Story>

<Story name="Few lines" args={{ lines: lines(3) }}>
  {#snippet template(args)}<div class="w-80"><SellCart {...args} /></div>{/snippet}
</Story>

<Story name="Many lines" args={{ lines: lines(15) }}>
  {#snippet template(args)}<div class="w-80"><SellCart {...args} /></div>{/snippet}
</Story>

<Story
  name="With discount"
  args={{ lines: [line(0, { discount: '100' }), line(1, { qty: '2', discount: '50.5' }), line(2)] }}
>
  {#snippet template(args)}<div class="w-80"><SellCart {...args} /></div>{/snippet}
</Story>

<Story
  name="Large totals"
  args={{
    lines: [
      line(0, { qty: '999', unitPrice: '1234567.89' }),
      line(1, { qty: '1', unitPrice: '999999999' }),
    ],
  }}
>
  {#snippet template(args)}<div class="w-80"><SellCart {...args} /></div>{/snippet}
</Story>

<Story
  name="Missing price (blocks checkout)"
  args={{
    lines: [line(0, { unitPrice: null, sellable: sellable(0, { unitPrice: null }) }), line(1)],
  }}
>
  {#snippet template(args)}<div class="w-80"><SellCart {...args} /></div>{/snippet}
</Story>

<Story
  name="Invalid drafts"
  args={{
    lines: [line(0, { qty: 'abc' }), line(1, { discount: '-5' }), line(2, { unitPrice: '1,2,3' })],
  }}
>
  {#snippet template(args)}<div class="w-80"><SellCart {...args} /></div>{/snippet}
</Story>

<Story
  name="Package and plan lines"
  args={{
    lines: [
      line(0, { redemptionId: 'red-1', unitPrice: '0' }),
      line(0, { bookingId: 'bk-7' }),
      line(1, { planId: 'plan-3', unitPrice: '300' }),
    ],
  }}
>
  {#snippet template(args)}<div class="w-80"><SellCart {...args} /></div>{/snippet}
</Story>

<Story
  name="Read only (payment summary)"
  args={{ readOnly: true, lines: [line(0, { qty: '2' }), line(1, { discount: '40' }), line(2)] }}
>
  {#snippet template(args)}<div class="w-80"><SellCart {...args} /></div>{/snippet}
</Story>

<Story
  name="Price locked (no override)"
  args={{ settings: { allowPriceOverride: false }, lines: lines(2) }}
>
  {#snippet template(args)}<div class="w-80"><SellCart {...args} /></div>{/snippet}
</Story>

<Story
  name="Long names"
  args={{
    lines: [
      line(0, {
        sellable: sellable(0, {
          name: 'Tratamiento combinado de rejuvenecimiento facial con ácido hialurónico y bioestimuladores (protocolo completo)',
        }),
      }),
    ],
  }}
>
  {#snippet template(args)}<div class="w-80"><SellCart {...args} /></div>{/snippet}
</Story>

<!-- Responsive: the cart fills its host; names truncate, totals stay on one line. -->
<Story
  name="Many lines · Phone"
  args={{ lines: lines(15) }}
  globals={{ viewport: { value: 'phone', isRotated: false } }}
>
  {#snippet template(args)}<div class="w-full"><SellCart {...args} /></div>{/snippet}
</Story>
