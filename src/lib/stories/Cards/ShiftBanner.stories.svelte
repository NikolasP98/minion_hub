<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import ShiftBanner from '$lib/components/pos/ShiftBanner.svelte';

  // Driven entirely by `page.data` (loaded by the POS layout), mocked per story
  // through `parameters.sveltekit_experimental.state.page.data`.
  const methods = [
    { id: 'cash', label: 'Cash', enabled: true, takesTendered: true },
    { id: 'card', label: 'Card', enabled: true, takesTendered: false },
    { id: 'yape', label: 'Yape', enabled: true, takesTendered: false },
    { id: 'cheque', label: 'Cheque', enabled: false, takesTendered: true },
  ];
  const cashier = {
    user: { role: 'user' },
    permissions: { permissions: ['pos:edit', 'pos:view'] },
  };
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  const open = (h: number, summary: Record<string, unknown> = {}) => ({
    shift: { id: 'sh-1', openedAt: hoursAgo(h), openingFloat: { cash: 200 } },
    summary: {
      ticketCount: 14,
      voidCount: 1,
      gross: 4830.5,
      byMethod: { cash: 1830.5, card: 2400, yape: 600 },
      ...summary,
    },
  });
  const pageData = (data: Record<string, unknown>) => ({
    sveltekit_experimental: {
      state: {
        page: {
          data: { ...cashier, posSettings: { methods }, openerName: 'Lucía Fernández', ...data },
        },
      },
    },
  });

  const { Story } = defineMeta({
    title: 'Components/Cards/ShiftBanner',
    component: ShiftBanner,
    tags: ['autodocs'],
  });
</script>

<!-- The banner renders a wide box at ≥xl and a compact rail below; resize the viewport to see both. -->
<Story name="No open shift" parameters={pageData({ openShift: null })}>
  {#snippet template()}<div class="w-72"><ShiftBanner /></div>{/snippet}
</Story>

<Story name="Open shift" parameters={pageData({ openShift: open(3) })}>
  {#snippet template()}<div class="w-72"><ShiftBanner /></div>{/snippet}
</Story>

<Story name="Stale (open 20 h)" parameters={pageData({ openShift: open(20) })}>
  {#snippet template()}<div class="w-72"><ShiftBanner /></div>{/snippet}
</Story>

<Story
  name="Long shift (3 days, many tickets)"
  parameters={pageData({
    openShift: open(72, {
      ticketCount: 1284,
      gross: 1_250_000,
      byMethod: { cash: 500_000, card: 650_000, yape: 100_000 },
      unemitted: 37,
    }),
  })}
>
  {#snippet template()}<div class="w-72"><ShiftBanner /></div>{/snippet}
</Story>

<Story
  name="No income yet"
  parameters={pageData({ openShift: open(0.2, { ticketCount: 0, gross: 0, byMethod: {} }) })}
>
  {#snippet template()}<div class="w-72"><ShiftBanner /></div>{/snippet}
</Story>

<Story
  name="Colleagues open"
  parameters={pageData({
    openShift: open(2),
    openShifts: [
      { id: 'sh-2', openedAt: hoursAgo(5), openedByName: 'Marco Antonio Quispe Huamán' },
      { id: 'sh-3', openedAt: hoursAgo(1), openedByName: null },
    ],
  })}
>
  {#snippet template()}<div class="w-72"><ShiftBanner /></div>{/snippet}
</Story>

<Story
  name="Closed, colleagues open"
  parameters={pageData({
    openShift: null,
    openShifts: [{ id: 'sh-2', openedAt: hoursAgo(5), openedByName: 'Marco Quispe' }],
  })}
>
  {#snippet template()}<div class="w-72"><ShiftBanner /></div>{/snippet}
</Story>

<Story
  name="Viewer (no pos:edit)"
  parameters={pageData({ openShift: open(3), permissions: { permissions: ['pos:view'] } })}
>
  {#snippet template()}<div class="w-72"><ShiftBanner /></div>{/snippet}
</Story>

<Story name="Opener unknown" parameters={pageData({ openShift: open(1), openerName: null })}>
  {#snippet template()}<div class="w-72"><ShiftBanner /></div>{/snippet}
</Story>

<!-- Responsive: the wide box only renders at ≥xl (1280px); phone and tablet show the compact rail. -->
<Story
  name="Open shift · Phone"
  parameters={pageData({ openShift: open(3) })}
  globals={{ viewport: { value: 'phone', isRotated: false } }}
>
  {#snippet template()}<div class="w-full"><ShiftBanner /></div>{/snippet}
</Story>

<Story
  name="Open shift · Tablet"
  parameters={pageData({ openShift: open(3) })}
  globals={{ viewport: { value: 'tablet', isRotated: false } }}
>
  {#snippet template()}<div class="w-full"><ShiftBanner /></div>{/snippet}
</Story>
