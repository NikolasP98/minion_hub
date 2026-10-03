<script module lang="ts">
  import { CheckoutMoneyDraftError, checkoutLineState, type MoneyDraft } from './checkout-money';

  // Narrow local mirror of pos.service.ts SellableRow — client components don't
  // import $server/* runtime modules (same convention as ShiftBanner.svelte).
  export interface SellCartSellable {
    productId: string;
    code: string;
    name: string;
    category: string | null;
    unitPrice: number | null;
    active: boolean;
    /** Mirrors SellableRow.kind — 'bundle' rides in the cart as ONE priced
     *  line; expanding it into its children happens at stock-issue time, not
     *  here (a bundle's price is its own, not the sum of its parts). */
    kind: 'product' | 'service' | 'bundle';
    itemId: string | null;
    stockQty: number | null;
    hasMapping: boolean;
  }

  export interface CartLine {
    sellable: SellCartSellable;
    qty: MoneyDraft;
    unitPrice: MoneyDraft | null;
    discount: MoneyDraft;
    /** Set when the line rings up a completed appointment (POS "Cobrar" handoff). */
    bookingId?: string | null;
    /** This line is covered by a package session already drawn at booking time
     *  (`pos_package_redemptions.id`) — the ONE line the backend lets cost 0. */
    redemptionId?: string | null;
    /** This line is an instalment toward `pos_payment_plans.id`. */
    planId?: string | null;
  }

  /** A package-redeemed line is legitimately free — its money moved when the
   *  package was sold — so it is exempt from the "needs a price" block. */
  export function lineNeedsPrice(l: CartLine): boolean {
    if (l.redemptionId) return false;
    const state = checkoutLineState(l);
    return l.unitPrice == null || (!state.ok && state.code === 'zero_price');
  }

  /** Pure so it's usable both here and in the page for totals — integer cents,
   *  never float-accumulate. Priceless/non-positive-price lines contribute 0. */
  export function lineCents(l: CartLine): number {
    const state = checkoutLineState(l);
    if (!state.ok) throw new CheckoutMoneyDraftError(state.code);
    return Number(state.value.totalMinor);
  }

  /** Same identity the `{#each}` keys on: two sessions of the SAME service (or
   *  a redeemed line plus a paid one) share a productId, and so does a booked
   *  session next to a walk-in sale of the same treatment — the booking id
   *  keeps those apart (a collision here is a hard `each_key_duplicate` crash
   *  that left /pos/sell blank after "Take payment in POS"). */
  export function lineKey(l: CartLine): string {
    return l.redemptionId ?? l.planId ?? (l.bookingId ? `b:${l.bookingId}` : l.sellable.productId);
  }
</script>

<script lang="ts">
  import { Minus, Percent, Plus, Trash2 } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { Badge, Button, EmptyState, iconSizes } from '$lib/components/ui';
  import { canAct } from '$lib/access/can.svelte';
  import { formatMoney } from '$lib/utils/format';
  import { decimalToNumber } from '$lib/money/decimal';

  interface Props {
    lines: CartLine[];
    settings: { allowPriceOverride: boolean };
    /** Read-only rendering for the payment step's order summary: no steppers,
     *  no inputs, no remove — the cart is settled, not edited, at that point. */
    readOnly?: boolean;
  }

  let { lines = $bindable(), settings, readOnly = false }: Props = $props();

  // Discount is the rare field — it hides behind a per-line affordance so the
  // common line is one row of name+total and one row of qty+price.
  // TODO(handoff): the affordance is one-way — once opened, a line's discount
  // field stays visible for the rest of the session (typing 0 leaves the input
  // on screen). Fine at the till, but a "clear discount" verb is missing. See
  // meta proposals/2026-09-13-pos-packages-plans-s1-followups.md §29.
  let discountOpen = $state<Record<string, boolean>>({});
  function showDiscount(l: CartLine): boolean {
    const state = checkoutLineState(l);
    return (state.ok && state.value.discountMinor > 0n) || discountOpen[lineKey(l)] === true;
  }

  function priceEditable(l: CartLine): boolean {
    // A redeemed session is priced by the package, not by the cashier.
    if (l.redemptionId) return false;
    return l.sellable.unitPrice == null || (settings.allowPriceOverride && canAct('pos', 'manage'));
  }
  function setQty(l: CartLine, raw: string) {
    l.qty = raw;
  }
  function stepQty(l: CartLine, delta: number) {
    try {
      const current = decimalToNumber(l.qty);
      l.qty = String(Math.max(1, Math.round(current) + delta));
    } catch {
      // Keep the invalid draft visible for correction.
    }
  }
  function setPrice(l: CartLine, raw: string) {
    l.unitPrice = raw;
  }
  function setDiscount(l: CartLine, raw: string) {
    l.discount = raw;
  }
  function issueMessage(code: string): string {
    if (code === 'invalid_qty') return m.pos_money_invalid_qty();
    if (code === 'invalid_discount') return m.pos_money_invalid_discount();
    if (code === 'zero_price') return m.pos_price_required();
    return m.pos_money_invalid_price();
  }
  function remove(i: number) {
    lines = lines.filter((_, idx) => idx !== i);
  }
</script>

<div class="cart">
  {#if lines.length === 0}
    <EmptyState title={m.pos_sell_cart_empty()} compact />
  {:else}
    <div class="lines">
      <!-- Key by the line's own identity: two sessions of the SAME service (or a
           redeemed line plus a paid one) share a productId and would collide. -->
      {#each lines as l, i (lineKey(l))}
        {@const money = checkoutLineState(l)}
        <div class="line" class:warn={!money.ok}>
          <div class="line-top">
            <span class="name">{l.sellable.name}</span>
            {#if l.redemptionId}
              <Badge variant="semantic" value="success" size="sm">{m.pos_pkg_line()}</Badge>
            {:else if l.planId}
              <Badge variant="semantic" value="info" size="sm">{m.pos_plan_line()}</Badge>
            {/if}
            <span class="line-total">{money.ok ? formatMoney(money.value.total) : '—'}</span>
            {#if !readOnly}
              <Button
                variant="ghost"
                size="xs"
                shape="icon"
                class="rm"
                title={m.common_remove()}
                onclick={() => remove(i)}><Trash2 size={iconSizes.xs} /></Button
              >
            {/if}
          </div>
          {#if readOnly}
            <span class="ro-row"
              >{m.pos_pay_line_detail({
                qty: money.ok ? String(money.value.qty) : String(l.qty),
                price: money.ok ? formatMoney(money.value.unitPrice) : '—',
              })}{money.ok && money.value.discountMinor > 0n
                ? ` · −${formatMoney(money.value.discount)}`
                : ''}</span
            >
          {:else}
            <div class="line-row">
              <div class="stepper">
                <Button
                  variant="ghost"
                  size="xs"
                  shape="icon"
                  class="step"
                  title={m.pos_pay_qty_less()}
                  onclick={() => stepQty(l, -1)}><Minus size={iconSizes.xs} /></Button
                >
                <input
                  class="inp qty"
                  type="text"
                  inputmode="decimal"
                  aria-label={m.pos_sell_qty()}
                  aria-invalid={!money.ok && money.code === 'invalid_qty'}
                  value={l.qty}
                  oninput={(e) => setQty(l, (e.currentTarget as HTMLInputElement).value)}
                />
                <Button
                  variant="ghost"
                  size="xs"
                  shape="icon"
                  class="step"
                  title={m.pos_pay_qty_more()}
                  onclick={() => stepQty(l, 1)}><Plus size={iconSizes.xs} /></Button
                >
              </div>
              <input
                class="inp price"
                type="text"
                inputmode="decimal"
                aria-label={m.pos_sell_price()}
                aria-invalid={!money.ok &&
                  (money.code === 'invalid_amount' || money.code === 'zero_price')}
                title={m.pos_sell_price()}
                disabled={!priceEditable(l)}
                value={l.unitPrice ?? ''}
                oninput={(e) => setPrice(l, (e.currentTarget as HTMLInputElement).value)}
              />
              {#if showDiscount(l)}
                <input
                  class="inp price disc"
                  type="text"
                  inputmode="decimal"
                  aria-label={m.pos_sell_discount()}
                  aria-invalid={!money.ok && money.code === 'invalid_discount'}
                  title={m.pos_sell_discount()}
                  value={l.discount}
                  oninput={(e) => setDiscount(l, (e.currentTarget as HTMLInputElement).value)}
                />
              {:else}
                <Button
                  variant="ghost"
                  size="xs"
                  shape="icon"
                  class="disc-btn"
                  title={m.pos_sell_discount()}
                  aria-label={m.pos_sell_discount()}
                  onclick={() => (discountOpen[lineKey(l)] = true)}
                  ><Percent size={iconSizes.xs} /></Button
                >
              {/if}
            </div>
          {/if}
          {#if !money.ok}
            <span class="req" role="alert">{issueMessage(money.code)}</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .cart {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-height: 0;
  }
  .lines {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .line {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    padding: var(--space-1) var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .line.warn {
    border-color: color-mix(in srgb, var(--color-danger-fg) 50%, transparent);
    background: color-mix(in srgb, var(--color-danger-fg) 6%, transparent);
  }
  .line-top {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .name {
    flex: 1;
    font-size: var(--font-size-body);
    font-weight: 500;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .line-total {
    font-size: var(--font-size-body);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .ro-row {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .cart :global(.rm) {
    color: var(--color-text-tertiary);
    flex-shrink: 0;
  }
  .cart :global(.rm):hover {
    color: var(--color-danger-fg);
  }
  .line-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  /* qty stepper — one bordered group so − [n] + reads as a single control */
  .stepper {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
  }
  .cart :global(.step) {
    color: var(--color-text-secondary);
  }
  .stepper .inp {
    width: 2.4rem;
    border: none;
    background: transparent;
    text-align: center;
    padding: 0;
  }
  .inp {
    min-height: var(--control-height-xs);
    padding: var(--space-0-5) var(--space-2);
    font-size: var(--font-size-body);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
  }
  .inp:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .price {
    flex: 1;
    min-width: 0;
    text-align: right;
  }
  .disc {
    max-width: 5rem;
    color: var(--color-danger-fg);
  }
  .cart :global(.disc-btn) {
    color: var(--color-text-tertiary);
    flex-shrink: 0;
  }
  .req {
    font-size: var(--font-size-caption);
    color: var(--color-danger-fg);
  }
</style>
