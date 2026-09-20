<script module lang="ts">
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
    qty: number;
    unitPrice: number | null;
    discount: number;
    /** Set when the line rings up a completed appointment (POS "Cobrar" handoff). */
    bookingId?: string | null;
    /** This line is covered by a package session already drawn at booking time
     *  (`pos_package_redemptions.id`) — the ONE line the backend lets cost 0. */
    redemptionId?: string | null;
    /** This line is an instalment toward `pos_payment_plans.id`. */
    planId?: string | null;
  }

  /** Namespaced row identity keeps booked and unbooked sales of one service distinct. */
  export function lineKey(l: CartLine): string {
    if (l.redemptionId) return `redemption:${l.redemptionId}`;
    if (l.planId) return `plan:${l.planId}`;
    if (l.bookingId) return `booking:${l.bookingId}`;
    return `product:${l.sellable.productId}`;
  }

  /** A package-redeemed line is legitimately free — its money moved when the
   *  package was sold — so it is exempt from the "needs a price" block. */
  export function lineNeedsPrice(l: CartLine): boolean {
    return !l.redemptionId && (l.unitPrice == null || l.unitPrice <= 0);
  }

  /** Pure so it's usable both here and in the page for totals — integer cents,
   *  never float-accumulate. Priceless/non-positive-price lines contribute 0. */
  export function lineCents(l: CartLine): number {
    if (l.unitPrice == null || l.unitPrice <= 0) return 0;
    const raw = Math.round(l.unitPrice * 100) * l.qty - Math.round(l.discount * 100);
    return Math.max(0, raw);
  }
</script>

<script lang="ts">
  import { Minus, Percent, Plus, Trash2 } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { Badge, Button, EmptyState, iconSizes } from '$lib/components/ui';
  import { canAct } from '$lib/access/can.svelte';
  import { formatMoney } from '$lib/utils/format';
  import { capDiscount } from './checkout-money';

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
    return l.discount > 0 || discountOpen[lineKey(l)] === true;
  }

  function priceEditable(l: CartLine): boolean {
    // A redeemed session is priced by the package, not by the cashier.
    if (l.redemptionId) return false;
    return l.sellable.unitPrice == null || (settings.allowPriceOverride && canAct('pos', 'manage'));
  }
  const priceless = lineNeedsPrice;
  function setQty(l: CartLine, raw: number) {
    l.qty = l.bookingId ? 1 : Math.max(1, Math.round(raw) || 1);
  }
  function setPrice(l: CartLine, raw: string) {
    const n = Number(raw);
    l.unitPrice = raw.trim() === '' || !Number.isFinite(n) ? null : n;
  }
  function setDiscount(l: CartLine, raw: number) {
    // Cap to the line's own total (server's invalid_discount boundary) so an
    // oversized discount never reaches submitTicket in the first place.
    const lineTotal = l.unitPrice != null ? l.qty * l.unitPrice : 0;
    l.discount = capDiscount(raw, lineTotal);
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
        <div class="line" class:warn={priceless(l)}>
          <div class="line-top">
            <span class="name">{l.sellable.name}</span>
            {#if l.redemptionId}
              <Badge variant="semantic" value="success" size="sm">{m.pos_pkg_line()}</Badge>
            {:else if l.planId}
              <Badge variant="semantic" value="info" size="sm">{m.pos_plan_line()}</Badge>
            {/if}
            <span class="line-total">{formatMoney(lineCents(l) / 100)}</span>
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
                qty: String(l.qty),
                price: formatMoney(l.unitPrice ?? 0),
              })}{l.discount > 0 ? ` · −${formatMoney(l.discount)}` : ''}</span
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
                  disabled={Boolean(l.bookingId)}
                  onclick={() => setQty(l, l.qty - 1)}><Minus size={iconSizes.xs} /></Button
                >
                <input
                  class="inp qty"
                  type="number"
                  min="1"
                  step="1"
                  aria-label={m.pos_sell_qty()}
                  value={l.qty}
                  disabled={Boolean(l.bookingId)}
                  oninput={(e) => setQty(l, Number((e.currentTarget as HTMLInputElement).value))}
                />
                <Button
                  variant="ghost"
                  size="xs"
                  shape="icon"
                  class="step"
                  title={m.pos_pay_qty_more()}
                  disabled={Boolean(l.bookingId)}
                  onclick={() => setQty(l, l.qty + 1)}><Plus size={iconSizes.xs} /></Button
                >
              </div>
              <input
                class="inp price"
                type="number"
                min="0"
                step="0.01"
                aria-label={m.pos_sell_price()}
                title={m.pos_sell_price()}
                disabled={!priceEditable(l)}
                value={l.unitPrice ?? ''}
                oninput={(e) => setPrice(l, (e.currentTarget as HTMLInputElement).value)}
              />
              {#if showDiscount(l)}
                <input
                  class="inp price disc"
                  type="number"
                  min="0"
                  step="0.01"
                  aria-label={m.pos_sell_discount()}
                  title={m.pos_sell_discount()}
                  value={l.discount}
                  oninput={(e) =>
                    setDiscount(l, Number((e.currentTarget as HTMLInputElement).value))}
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
          {#if priceless(l)}
            <span class="req">{m.pos_price_required()}</span>
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
  /* Chrome/Safari spinners would double the stepper's job and steal the width. */
  .inp::-webkit-outer-spin-button,
  .inp::-webkit-inner-spin-button {
    appearance: none;
    margin: 0;
  }
  .inp[type='number'] {
    -moz-appearance: textfield;
    appearance: textfield;
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
