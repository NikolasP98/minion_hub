<script module lang="ts">
  import type { MoneyDraft } from './checkout-money';
  export { changeDue, rowChange } from './checkout-money';

  /** Narrow local shape (mirrors the server's PaymentMethod) — avoids
   *  importing $server/* runtime modules into a client component. */
  export interface PaymentMethodOption {
    id: string;
    label: string;
    takesTendered: boolean;
    drawsOnCredit: boolean | null;
    requiresCreditDecision: boolean;
  }

  export interface PaymentRow {
    /** Stable render key — index keys mis-associate input state on row removal. */
    id?: string;
    method: string;
    amount: MoneyDraft;
    tendered?: MoneyDraft | null;
    /** Frozen at add-time from the method's config, so a row's tendered/change
     *  UI never flips mid-transaction if settings change elsewhere. */
    takesTendered: boolean;
  }
</script>

<script lang="ts">
  import { X } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { Button, iconSizes } from '$lib/components/ui';
  import { formatMoney } from '$lib/utils/format';
  import {
    moneyDraft,
    paymentRowsState,
    remainingMoneyState,
    rowChange as rowChangeForDisplay,
  } from './checkout-money';

  interface Props {
    total: number;
    methods: PaymentMethodOption[];
    payments: PaymentRow[];
  }

  let { total, methods, payments = $bindable([]) }: Props = $props();

  const totalState = $derived(moneyDraft(total, { exact: true, nonnegative: true }));
  const paymentState = $derived(paymentRowsState(payments));
  const remainingState = $derived(
    totalState.ok && paymentState.ok
      ? remainingMoneyState(totalState.value.minor, paymentState.value.paidMinor)
      : null,
  );

  /**
   * A method tile is a toggle, not an "add row" button: the common ticket is
   * ONE tender paying everything, so the first tap prefills the whole
   * remaining amount and a second tap on the same tile takes it back off
   * (resetting remaining) instead of stacking a second zero row.
   */
  function toggleMethod(mth: PaymentMethodOption) {
    const last = payments.findLastIndex((p) => p.method === mth.id);
    if (last >= 0) {
      payments = payments.filter((_, idx) => idx !== last);
      return;
    }
    if (!remainingState?.ok || remainingState.value.minor <= 0n) return;
    const amount = remainingState.value.number;
    payments = [
      ...payments,
      {
        id: crypto.randomUUID(),
        method: mth.id,
        amount,
        tendered: mth.takesTendered ? amount : null,
        takesTendered: mth.takesTendered,
      },
    ];
  }

  function allocated(id: string): number | null {
    const state = paymentRowsState(payments.filter((payment) => payment.method === id));
    return state.ok ? state.value.paid : null;
  }
  function isOn(id: string): boolean {
    return payments.some((p) => p.method === id);
  }

  function setAmount(i: number, raw: string) {
    payments[i].amount = raw;
  }

  function setTendered(i: number, raw: string) {
    payments[i].tendered = raw;
  }

  function removeRow(i: number) {
    payments = payments.filter((_, idx) => idx !== i);
  }

  function rowIssue(p: PaymentRow): 'invalid_amount' | 'invalid_tender' | null {
    const state = paymentRowsState([p]);
    return state.ok ? null : state.code === 'invalid_tender' ? 'invalid_tender' : 'invalid_amount';
  }

  function labelFor(id: string): string {
    return methods.find((mth) => mth.id === id)?.label ?? id;
  }
</script>

<div class="panel">
  <div class="methods">
    {#each methods as mth (mth.id)}
      {@const allocatedAmount = allocated(mth.id)}
      {@const unresolved = mth.requiresCreditDecision || mth.drawsOnCredit === null}
      <Button
        variant="ghost"
        type="button"
        class={`mtile ${isOn(mth.id) ? 'on' : ''}`}
        aria-pressed={isOn(mth.id)}
        disabled={unresolved}
        title={unresolved ? m.pos_pay_method_configuration_required() : undefined}
        onclick={() => toggleMethod(mth)}
      >
        <span class="mtile-label">{mth.label}</span>
        {#if unresolved}
          <span class="mtile-warning">{m.pos_pay_method_configuration_required()}</span>
        {/if}
        <span class="mtile-amount" class:on={isOn(mth.id)}
          >{isOn(mth.id) && allocatedAmount != null ? formatMoney(allocatedAmount) : '—'}</span
        >
      </Button>
    {/each}
  </div>

  <!-- Remaining + change due are shown by the payment step, next to Finish sale. -->
  {#if payments.length}
    <div class="rows">
      {#each payments as p, i (p.id ?? i)}
        {@const issue = rowIssue(p)}
        {@const change = rowChangeForDisplay(p)}
        <div class="row" class:invalid={issue !== null}>
          <span class="mname">{labelFor(p.method)}</span>
          <label class="fld">
            <span class="lbl">{m.pos_pay_amount()}</span>
            <input
              class="inp"
              type="text"
              inputmode="decimal"
              aria-invalid={issue === 'invalid_amount'}
              value={p.amount}
              oninput={(e) => setAmount(i, (e.currentTarget as HTMLInputElement).value)}
            />
          </label>
          {#if p.takesTendered}
            <label class="fld">
              <span class="lbl">{m.pos_sell_tendered()}</span>
              <input
                class="inp"
                type="text"
                inputmode="decimal"
                aria-invalid={issue === 'invalid_tender'}
                value={p.tendered ?? ''}
                oninput={(e) => setTendered(i, (e.currentTarget as HTMLInputElement).value)}
              />
            </label>
            {#if change != null}
              <span class="change">{m.pos_sell_change()}: {formatMoney(change)}</span>
            {/if}
          {/if}
          <Button
            variant="ghost"
            size="xs"
            shape="icon"
            class="rm"
            title={m.common_remove()}
            onclick={() => removeRow(i)}><X size={iconSizes.xs} /></Button
          >
          {#if issue}
            <span class="row-error" role="alert">
              {issue === 'invalid_tender'
                ? m.pos_money_invalid_tender()
                : m.pos_money_invalid_amount()}
            </span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  /* Tiles, not chips: at the till this is the primary target of the pay step. */
  .methods {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
    gap: var(--space-2);
  }
  .panel :global(.mtile) {
    height: auto;
    align-items: stretch;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    text-align: left;
  }
  /* Button renders slotted children inside an inner fixed-height row <span>. */
  .panel :global(.mtile > span) {
    width: 100%;
    min-width: 0;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-0-5);
  }
  .panel :global(.mtile):hover {
    border-color: var(--color-accent);
  }
  /* Selected tender = accent-TINTED surface + accent text (selection, not action). */
  .panel :global(.mtile.on) {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    color: var(--color-accent);
  }
  .mtile-label {
    font-size: var(--font-size-body);
    font-weight: 500;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .mtile-amount {
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
    color: var(--color-text-tertiary);
  }
  .mtile-warning {
    font-size: var(--font-size-telemetry);
    color: var(--color-warning-fg);
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .mtile-amount.on {
    color: var(--color-accent);
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .row {
    display: flex;
    align-items: flex-end;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: var(--space-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
  }
  .row.invalid {
    border-color: color-mix(in srgb, var(--color-danger-fg) 55%, transparent);
  }
  .mname {
    flex: 1;
    min-width: 5rem;
    font-size: var(--font-size-body);
    font-weight: 500;
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
    color: var(--color-text-tertiary);
  }
  .inp {
    width: 6.5rem;
    min-height: var(--control-height-sm);
    padding: var(--space-1) var(--space-2);
    font-size: var(--font-size-body);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    color: var(--color-text-primary);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .change {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    padding-bottom: var(--space-1);
    white-space: nowrap;
  }
  .row-error {
    flex-basis: 100%;
    font-size: var(--font-size-caption);
    color: var(--color-danger-fg);
  }
  .panel :global(.rm) {
    color: var(--color-text-tertiary);
    margin-bottom: var(--space-1);
  }
  .panel :global(.rm):hover {
    color: var(--color-danger-fg);
  }
</style>
