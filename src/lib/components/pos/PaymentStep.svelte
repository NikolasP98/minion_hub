<script lang="ts">
  /**
   * Step 2 of the /pos/sell checkout: settling an already-built ticket.
   *
   * The item grid is gone on purpose — nothing is added here, so the whole
   * width belongs to the summary + tender area. The page stays the state
   * owner; this component only renders and reports intent.
   */
  import { ArrowLeft } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { Badge, Button, SegmentedControl, iconSizes } from '$lib/components/ui';
  import PlanOpenForm from '$lib/components/pos/PlanOpenForm.svelte';
  import { formatMoney } from '$lib/utils/format';
  import PaymentPanel, {
    changeDue,
    type PaymentMethodOption,
    type PaymentRow,
  } from '$lib/components/pos/PaymentPanel.svelte';
  import SellCart, { type CartLine } from '$lib/components/pos/SellCart.svelte';

  interface Props {
    lines: CartLine[];
    total: number;
    methods: PaymentMethodOption[];
    payments: PaymentRow[];
    customerName: string | null;
    /** Stored value on the client's account, or null when there is no account. */
    creditBalance: number | null;
    remaining: number;
    /** First unmet precondition, already resolved by the page (null = ready). */
    blocker: string | null;
    submitting: boolean;
    /** Client on the ticket — an instalment plan needs one (`POST /api/pos/plans`). */
    partyId: string | null;
    /** The booked session being charged, so a plan opened here is linked to it. */
    bookingId: string | null;
    /** Seeds the plan name (first line / booked service). */
    planTitle: string;
    /** Whether the cart can be financed at all (nothing to finance once it holds an instalment). */
    planAllowed: boolean;
    onBack: () => void;
    onFinish: () => void;
    /** A plan was opened for this cart — the page swaps the cart for its first instalment. */
    onPlanCreated: (plan: { id: string }) => void | Promise<void>;
  }

  let {
    lines,
    total,
    methods,
    payments = $bindable([]),
    customerName,
    creditBalance,
    remaining,
    blocker,
    submitting,
    partyId,
    bookingId,
    planTitle,
    planAllowed,
    onBack,
    onFinish,
    onPlanCreated,
  }: Props = $props();

  /** Direct vs in parts — the payment agreement is decided HERE, at the till,
   *  never in the appointment drawer (owner directive 2026-09-20). */
  let mode = $state<'full' | 'plan'>('full');
  const modeItems = $derived([
    { value: 'full', label: m.pos_pay_mode_full() },
    { value: 'plan', label: m.pos_pay_mode_plan(), disabled: !planAllowed },
  ]);

  const change = $derived(changeDue(payments));
  /** `credit` is a magic method id today — see the page's TODO(handoff). */
  const creditOffered = $derived(methods.some((mth) => mth.id === 'credit'));
</script>

<div class="pay">
  <div class="pay-head">
    <Button variant="ghost" size="sm" onclick={onBack}>
      <ArrowLeft size={iconSizes.sm} />
      {m.pos_pay_back()}
    </Button>
    <h2 class="t-title">{m.pos_pay_title()}</h2>
  </div>

  <div class="pay-body">
    <section class="summary" aria-label={m.pos_pay_summary()}>
      <div class="sum-head">
        <span class="t-label">{m.pos_pay_summary()}</span>
        <span class="sum-cust">{customerName ?? m.pos_pay_walk_in()}</span>
      </div>
      <div class="sum-lines">
        <SellCart {lines} settings={{ allowPriceOverride: false }} readOnly />
      </div>
      <div class="sum-total">
        <span>{m.pos_sell_total()}</span>
        <span class="amount">{formatMoney(total)}</span>
      </div>
    </section>

    <section class="tender" aria-label={m.pos_pay_tender()}>
      <div class="tender-scroll">
        <div class="mode-row">
          <span class="t-label">{m.pos_pay_method()}</span>
          <SegmentedControl
            items={modeItems}
            bind:value={mode}
            size="sm"
            aria-label={m.pos_pay_method()}
          />
        </div>
        {#if mode === 'plan'}
          {#if partyId}
            <p class="t-caption hint-plan">{m.pos_pay_plan_hint()}</p>
            <PlanOpenForm
              {partyId}
              {bookingId}
              defaultTitle={planTitle}
              defaultAmount={total}
              oncreated={async (plan) => {
                mode = 'full';
                await onPlanCreated(plan);
              }}
              oncancel={() => (mode = 'full')}
            />
          {:else}
            <p class="t-caption hint-plan">{m.pos_pay_plan_needs_client()}</p>
          {/if}
        {:else}
          {#if creditOffered && creditBalance != null}
            <Badge variant="semantic" value="info" size="sm">
              {m.pos_pay_credit_available({ amount: formatMoney(creditBalance) })}
            </Badge>
          {/if}
          <PaymentPanel {total} {methods} bind:payments />
        {/if}
      </div>

      <div class="settle">
        <div class="settle-row" class:done={Math.round(remaining * 100) === 0}>
          <span>{m.pos_sell_remaining()}</span>
          <span class="amount">{formatMoney(remaining)}</span>
        </div>
        {#if change > 0}
          <div class="settle-row change">
            <span>{m.pos_pay_change_due()}</span>
            <span class="amount">{formatMoney(change)}</span>
          </div>
        {/if}
        <Button
          variant="primary"
          size="lg"
          disabled={blocker != null || submitting}
          loading={submitting}
          onclick={onFinish}>{blocker ?? m.pos_pay_finish()}</Button
        >
        <span class="hint t-caption">{m.pos_pay_enter_hint()}</span>
      </div>
    </section>
  </div>
</div>

<style>
  .pay {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-height: 0;
    height: 100%;
  }
  .pay-head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-shrink: 0;
  }
  .pay-body {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
    min-height: 0;
  }
  @media (min-width: 1024px) {
    .pay-body {
      grid-template-columns: minmax(0, 20rem) minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr);
      flex: 1;
    }
  }
  .summary,
  .tender {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-height: 0;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    padding: var(--space-3);
  }
  .mode-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .hint-plan {
    margin: 0;
    color: var(--color-text-secondary);
  }
  .sum-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    flex-shrink: 0;
  }
  .sum-cust {
    font-size: var(--font-size-body);
    font-weight: 500;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sum-lines {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .sum-total {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    padding-top: var(--space-2);
    border-top: 1px solid var(--color-border-default);
    font-size: var(--font-size-page-title);
    font-weight: 600;
  }
  .tender-scroll {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .tender-scroll > :global(*) {
    flex-shrink: 0;
    width: 100%;
  }
  .settle {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    flex-shrink: 0;
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border-default);
  }
  .settle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: var(--font-size-page-title);
    font-weight: 600;
    color: var(--color-danger-fg);
  }
  .settle-row.done {
    color: var(--color-success-fg);
  }
  .settle-row.change {
    color: var(--color-info-fg);
  }
  .amount {
    font-variant-numeric: tabular-nums;
  }
  .hint {
    color: var(--color-text-tertiary);
    text-align: center;
  }
</style>
