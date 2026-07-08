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
    kind: 'product' | 'service';
    itemId: string | null;
    stockQty: number | null;
    hasMapping: boolean;
  }

  export interface CartLine {
    sellable: SellCartSellable;
    qty: number;
    unitPrice: number | null;
    discount: number;
  }

  /** Pure so it's usable both here and in the page for totals — integer cents,
   *  never float-accumulate. Priceless/non-positive-price lines contribute 0. */
  export function lineCents(l: CartLine): number {
    if (l.unitPrice == null || l.unitPrice <= 0) return 0;
    return Math.round(l.unitPrice * 100) * l.qty - Math.round(l.discount * 100);
  }
</script>

<script lang="ts">
  import { Trash2 } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { EmptyState } from '$lib/components/ui';
  import { canAct } from '$lib/access/can.svelte';

  interface Props {
    lines: CartLine[];
    settings: { allowPriceOverride: boolean };
    totalCents: number;
    onchange?: () => void;
  }

  let { lines = $bindable(), settings, totalCents, onchange }: Props = $props();

  function priceEditable(l: CartLine): boolean {
    return l.sellable.unitPrice == null || (settings.allowPriceOverride && canAct('pos', 'manage'));
  }
  function priceless(l: CartLine): boolean {
    return l.unitPrice == null || l.unitPrice <= 0;
  }
  function setQty(l: CartLine, raw: number) {
    l.qty = Math.max(1, Math.round(raw) || 1);
    onchange?.();
  }
  function setPrice(l: CartLine, raw: string) {
    const n = Number(raw);
    l.unitPrice = raw.trim() === '' || !Number.isFinite(n) ? null : n;
    onchange?.();
  }
  function setDiscount(l: CartLine, raw: number) {
    l.discount = Number.isFinite(raw) && raw >= 0 ? raw : 0;
    onchange?.();
  }
  function remove(i: number) {
    lines = lines.filter((_, idx) => idx !== i);
    onchange?.();
  }
</script>

<div class="cart">
  {#if lines.length === 0}
    <EmptyState title={m.pos_sell_cart_empty()} compact />
  {:else}
    <div class="lines">
      {#each lines as l, i (l.sellable.productId)}
        <div class="line" class:warn={priceless(l)}>
          <div class="line-top">
            <span class="name">{l.sellable.name}</span>
            <button class="rm" title={m.common_remove()} onclick={() => remove(i)}><Trash2 size={13} /></button>
          </div>
          <div class="line-row">
            <label class="fld">
              <span class="lbl">{m.pos_sell_qty()}</span>
              <input
                class="inp qty"
                type="number"
                min="1"
                step="1"
                value={l.qty}
                oninput={(e) => setQty(l, Number((e.currentTarget as HTMLInputElement).value))}
              />
            </label>
            <label class="fld">
              <span class="lbl">{m.pos_sell_price()}</span>
              <input
                class="inp price"
                type="number"
                min="0"
                step="0.01"
                disabled={!priceEditable(l)}
                value={l.unitPrice ?? ''}
                oninput={(e) => setPrice(l, (e.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <label class="fld">
              <span class="lbl">{m.pos_sell_discount()}</span>
              <input
                class="inp price"
                type="number"
                min="0"
                step="0.01"
                value={l.discount}
                oninput={(e) => setDiscount(l, Number((e.currentTarget as HTMLInputElement).value))}
              />
            </label>
          </div>
          {#if priceless(l)}
            <span class="req">{m.pos_price_required()}</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <div class="total-row">
    <span>{m.pos_sell_total()}</span>
    <span class="total">{(totalCents / 100).toFixed(2)}</span>
  </div>
</div>

<style>
  .cart {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-height: 0;
  }
  .lines {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    overflow-y: auto;
  }
  .line {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    padding: 0.5rem 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .line.warn {
    border-color: color-mix(in srgb, var(--color-destructive) 50%, transparent);
    background: color-mix(in srgb, var(--color-destructive) 6%, transparent);
  }
  .line-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .name {
    font-size: 0.86rem;
    font-weight: 500;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rm {
    background: none;
    border: none;
    color: var(--color-muted-foreground);
    cursor: pointer;
    flex-shrink: 0;
  }
  .rm:hover {
    color: var(--color-destructive);
  }
  .line-row {
    display: flex;
    gap: 0.5rem;
  }
  .fld {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    flex: 1;
    min-width: 0;
  }
  .lbl {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-muted-foreground);
  }
  .inp {
    min-height: 1.8rem;
    padding: 0.25rem 0.4rem;
    font-size: 0.8rem;
    border-radius: var(--radius-sm);
    background: var(--color-bg3);
    border: 1px solid var(--hairline);
    color: var(--color-foreground);
    font-variant-numeric: tabular-nums;
  }
  .inp:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .qty {
    text-align: center;
  }
  .price {
    text-align: right;
  }
  .req {
    font-size: 0.7rem;
    color: var(--color-destructive);
  }
  .total-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 0.5rem;
    border-top: 1px solid var(--hairline);
    font-size: 0.95rem;
    font-weight: 600;
  }
  .total {
    font-variant-numeric: tabular-nums;
  }
</style>
