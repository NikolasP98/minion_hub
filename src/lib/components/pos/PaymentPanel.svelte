<script module lang="ts">
  /** Narrow local shape (mirrors the server's PaymentMethod) — avoids
   *  importing $server/* runtime modules into a client component. */
  export interface PaymentMethodOption {
    id: string;
    label: string;
    takesTendered: boolean;
  }

  export interface PaymentRow {
    /** Stable render key — index keys mis-associate input state on row removal. */
    id?: string;
    method: string;
    amount: number;
    tendered?: number | null;
    /** Frozen at add-time from the method's config, so a row's tendered/change
     *  UI never flips mid-transaction if settings change elsewhere. */
    takesTendered: boolean;
  }

  /** Change owed on one cash-like row (0 for everything else). */
  export function rowChange(p: PaymentRow): number {
    if (!p.takesTendered || p.tendered == null) return 0;
    return Math.max(0, Math.round(p.tendered * 100) - Math.round(p.amount * 100)) / 100;
  }

  /** Total change owed across the ticket — the figure the drawer hands back. */
  export function changeDue(payments: PaymentRow[]): number {
    return payments.reduce((s, p) => s + Math.round(rowChange(p) * 100), 0) / 100;
  }
</script>

<script lang="ts">
  import { X } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { Button, iconSizes } from '$lib/components/ui';
  import { formatMoney } from '$lib/utils/format';

  interface Props {
    total: number;
    methods: PaymentMethodOption[];
    payments: PaymentRow[];
  }

  let { total, methods, payments = $bindable([]) }: Props = $props();

  const totalCents = $derived(Math.round(total * 100));
  const paidCents = $derived(payments.reduce((s, p) => s + Math.round(p.amount * 100), 0));
  const remainingCents = $derived(totalCents - paidCents);

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
    const amount = Math.max(0, remainingCents) / 100;
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

  function allocated(id: string): number {
    return (
      payments.reduce((s, p) => (p.method === id ? s + Math.round(p.amount * 100) : s), 0) / 100
    );
  }
  function isOn(id: string): boolean {
    return payments.some((p) => p.method === id);
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
    if (payments[i].takesTendered && Math.round((payments[i].tendered ?? 0) * 100) < cents) {
      payments[i].tendered = payments[i].amount;
    }
  }

  function setTendered(i: number, raw: number) {
    payments[i].tendered = Math.max(0, Number.isFinite(raw) ? raw : 0);
  }

  function removeRow(i: number) {
    payments = payments.filter((_, idx) => idx !== i);
  }

  function tenderInvalid(p: PaymentRow): boolean {
    return (
      p.takesTendered &&
      p.tendered != null &&
      Math.round(p.tendered * 100) < Math.round(p.amount * 100)
    );
  }

  function labelFor(id: string): string {
    return methods.find((mth) => mth.id === id)?.label ?? id;
  }
</script>

<div class="panel">
  <div class="methods">
    {#each methods as mth (mth.id)}
      <Button
        variant="ghost"
        type="button"
        class={`mtile ${isOn(mth.id) ? 'on' : ''}`}
        aria-pressed={isOn(mth.id)}
        onclick={() => toggleMethod(mth)}
      >
        <span class="mtile-label">{mth.label}</span>
        <span class="mtile-amount" class:on={isOn(mth.id)}
          >{isOn(mth.id) ? formatMoney(allocated(mth.id)) : '—'}</span
        >
      </Button>
    {/each}
  </div>

  <!-- Remaining + change due are shown by the payment step, next to Finish sale. -->
  {#if payments.length}
    <div class="rows">
      {#each payments as p, i (p.id ?? i)}
        <div class="row" class:invalid={tenderInvalid(p)}>
          <span class="mname">{labelFor(p.method)}</span>
          <label class="fld">
            <span class="lbl">{m.pos_pay_amount()}</span>
            <input
              class="inp"
              type="number"
              min="0"
              step="0.01"
              value={p.amount}
              oninput={(e) => setAmount(i, Number((e.currentTarget as HTMLInputElement).value))}
            />
          </label>
          {#if p.takesTendered}
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
            <span class="change">{m.pos_sell_change()}: {formatMoney(rowChange(p))}</span>
          {/if}
          <Button
            variant="ghost"
            size="xs"
            shape="icon"
            class="rm"
            title={m.common_remove()}
            onclick={() => removeRow(i)}><X size={iconSizes.xs} /></Button
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
  .panel :global(.rm) {
    color: var(--color-text-tertiary);
    margin-bottom: var(--space-1);
  }
  .panel :global(.rm):hover {
    color: var(--color-danger-fg);
  }
</style>
