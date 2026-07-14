<script module lang="ts">
  export interface PaymentRow {
    method: string;
    amount: number;
    tendered?: number | null;
  }
</script>

<script lang="ts">
  import { Button } from '$lib/components/ui';

  import { X } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { formatMoney } from '$lib/utils/format';

  interface Props {
    total: number;
    methods: string[];
    payments: PaymentRow[];
  }

  let { total, methods, payments = $bindable([]) }: Props = $props();

  const totalCents = $derived(Math.round(total * 100));
  const paidCents = $derived(payments.reduce((s, p) => s + Math.round(p.amount * 100), 0));
  const remainingCents = $derived(totalCents - paidCents);

  function addMethod(method: string) {
    const amount = Math.max(0, remainingCents) / 100;
    payments = [...payments, { method, amount, tendered: method === 'cash' ? amount : null }];
  }

  // Over-allocation clamp: this row's amount can never push Σ past total.
  function setAmount(i: number, raw: number) {
    const othersCents = payments.reduce(
      (s, p, idx) => (idx === i ? s : s + Math.round(p.amount * 100)),
      0,
    );
    const maxCents = Math.max(0, totalCents - othersCents);
    const cents = Math.min(
      Math.max(0, Math.round((Number.isFinite(raw) ? raw : 0) * 100)),
      maxCents,
    );
    payments[i].amount = cents / 100;
    if (payments[i].method === 'cash' && Math.round((payments[i].tendered ?? 0) * 100) < cents) {
      payments[i].tendered = payments[i].amount;
    }
  }

  function setTendered(i: number, raw: number) {
    payments[i].tendered = Math.max(0, Number.isFinite(raw) ? raw : 0);
  }

  function removeRow(i: number) {
    payments = payments.filter((_, idx) => idx !== i);
  }

  function change(p: PaymentRow): number {
    if (p.method !== 'cash' || p.tendered == null) return 0;
    return Math.max(0, Math.round(p.tendered * 100) - Math.round(p.amount * 100)) / 100;
  }

  function tenderInvalid(p: PaymentRow): boolean {
    return (
      p.method === 'cash' &&
      p.tendered != null &&
      Math.round(p.tendered * 100) < Math.round(p.amount * 100)
    );
  }
</script>

<div class="panel">
  <div class="methods">
    {#each methods as mth (mth)}
      <Button type="button" class="mbtn" onclick={() => addMethod(mth)}>{mth}</Button>
    {/each}
  </div>

  <!-- Remaining is shown in the page's pinned charge bar, next to the Charge button. -->
  {#if payments.length}
    <div class="rows">
      {#each payments as p, i (i)}
        <div class="row" class:invalid={tenderInvalid(p)}>
          <span class="mname">{p.method}</span>
          <label class="fld">
            <span class="lbl">{m.pos_sell_price()}</span>
            <input
              class="inp"
              type="number"
              min="0"
              step="0.01"
              value={p.amount}
              oninput={(e) => setAmount(i, Number((e.currentTarget as HTMLInputElement).value))}
            />
          </label>
          {#if p.method === 'cash'}
            <label class="fld">
              <span class="lbl">{m.pos_sell_tendered()}</span>
              <input
                class="inp"
                type="number"
                min="0"
                step="0.01"
                value={p.tendered ?? ''}
                oninput={(e) => setTendered(i, Number((e.currentTarget as HTMLInputElement).value))}
              />
            </label>
            <span class="change">{m.pos_sell_change()}: {formatMoney(change(p))}</span>
          {/if}
          <Button class="rm" title={m.common_remove()} onclick={() => removeRow(i)}
            ><X size={13} /></Button
          >
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .methods {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .panel :global(.mbtn) {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--hairline);
    background: var(--color-bg3);
    color: var(--color-foreground);
    font-size: var(--font-size-caption);
    text-transform: capitalize;
    cursor: pointer;
  }
  .panel :global(.mbtn):hover {
    border-color: var(--color-accent);
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    /* Lives in the pinned charge section — cap so many rows scroll instead of
       squeezing the cart above out of view. */
    max-height: 11rem;
    overflow-y: auto;
  }
  .row {
    display: flex;
    align-items: flex-end;
    flex-wrap: wrap; /* cash rows (price + tendered + change) exceed the panel width */
    gap: var(--space-2);
    padding: var(--space-1);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
  }
  .row.invalid {
    border-color: color-mix(in srgb, var(--color-destructive) 55%, transparent);
  }
  .mname {
    font-size: var(--font-size-caption);
    text-transform: capitalize;
    min-width: 3.5rem;
    padding-bottom: var(--space-1);
  }
  .fld {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }
  .lbl {
    font-size: var(--font-size-telemetry);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-muted-foreground);
  }
  .inp {
    width: 5.5rem;
    min-height: 1.8rem;
    padding: var(--space-1) var(--space-2);
    font-size: var(--font-size-body);
    border-radius: var(--radius-sm);
    background: var(--color-bg3);
    border: 1px solid var(--hairline);
    color: var(--color-foreground);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .change {
    font-size: var(--font-size-caption);
    color: var(--color-muted-foreground);
    padding-bottom: var(--space-1);
    white-space: nowrap;
  }
  .panel :global(.rm) {
    background: none;
    border: none;
    color: var(--color-muted-foreground);
    cursor: pointer;
    margin-bottom: var(--space-1);
  }
  .panel :global(.rm):hover {
    color: var(--color-destructive);
  }
</style>
