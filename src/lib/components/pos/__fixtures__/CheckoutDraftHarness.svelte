<script lang="ts">
  import PaymentPanel, { type PaymentRow } from '../PaymentPanel.svelte';
  import SellCart, { type CartLine } from '../SellCart.svelte';
  import { cartMoneyState, paymentRowsState, remainingMoneyState } from '../checkout-money';
  import { createTenderRefitCoordinator } from '../tender-refit.svelte';
  import { Button } from '$lib/components/ui';

  let lines = $state<CartLine[]>([
    {
      sellable: {
        productId: 'service-1',
        code: 'S1',
        name: 'Service',
        category: null,
        unitPrice: 0.335,
        active: true,
        kind: 'service',
        itemId: null,
        stockQty: null,
        hasMapping: false,
      },
      qty: '3',
      unitPrice: '0.335',
      discount: '0',
    },
  ]);
  let payments = $state<PaymentRow[]>([
    {
      id: 'cash-1',
      method: 'cash',
      amount: '1.01',
      tendered: '1.01',
      takesTendered: true,
    },
  ]);

  const cart = $derived(cartMoneyState(lines));
  const payment = $derived(paymentRowsState(payments));
  const remaining = $derived(
    cart.ok && payment.ok
      ? remainingMoneyState(cart.value.totalMinor, payment.value.paidMinor)
      : null,
  );

  createTenderRefitCoordinator<PaymentRow>({
    targetMinor: () => (cart.ok ? cart.value.totalMinor : null),
    payments: () => payments,
    replace: (fitted) => (payments = fitted as PaymentRow[]),
  });
</script>

<SellCart bind:lines settings={{ allowPriceOverride: true }} />
<Button type="button" aria-label="Submit cart" disabled={!cart.ok}>Submit cart</Button>

<PaymentPanel
  total={1.01}
  methods={[
    {
      id: 'cash',
      label: 'Cash',
      takesTendered: true,
      drawsOnCredit: false,
      requiresCreditDecision: false,
    },
  ]}
  bind:payments
/>
<Button
  type="button"
  aria-label="Submit payment"
  disabled={!payment.ok || !remaining?.ok || remaining.value.minor !== 0n}>Submit payment</Button
>
