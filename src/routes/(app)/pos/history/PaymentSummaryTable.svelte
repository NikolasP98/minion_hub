<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { Badge, Tooltip } from '$lib/components/ui';
  import { formatMoney } from '$lib/utils/format';
  import { moneyDraft, remainingMoneyState } from '$lib/components/pos/checkout-money';

  let {
    total,
    methodTotals,
    expected = null,
    counted = null,
  }: {
    /** Net total — the emphasised first row. */
    total: number;
    /** Method → net amount. One row per method, no more duplicate per-method
     *  blocks (owner: "I don't understand these duplicate lines"). */
    methodTotals: Record<string, number>;
    /** Present only for a closed shift that was counted — else every
     *  Esperado/Contado/Diferencia cell stays blank. */
    expected?: Record<string, number> | null;
    counted?: Record<string, number> | null;
  } = $props();

  function shiftDifference(
    counted: number,
    expectedAmount: number,
  ): { value: number | null; balanced: boolean } {
    const countedMoney = moneyDraft(counted, { exact: true });
    const expectedMoney = moneyDraft(expectedAmount, { exact: true });
    if (!countedMoney.ok || !expectedMoney.ok) return { value: null, balanced: false };
    const difference = remainingMoneyState(countedMoney.value.minor, expectedMoney.value.minor);
    return difference.ok
      ? { value: difference.value.number, balanced: difference.value.minor === 0n }
      : { value: null, balanced: false };
  }

  const methodEntries = $derived(Object.entries(methodTotals));
</script>

<table class="pay-summary">
  <thead>
    <tr>
      <th scope="col">{m.fin_col_method()}</th>
      <!-- Each figure column explains itself on hover (owner 2026-10-15). -->
      <th scope="col" class="num">
        <Tooltip label={m.pos_history_summary_amount_help()} openDelay={300}>
          <span class="hdr-help">{m.pos_history_summary_amount()}</span>
        </Tooltip>
      </th>
      <th scope="col" class="num">
        <Tooltip label={m.pos_shift_expected_help()} openDelay={300}>
          <span class="hdr-help">{m.pos_shift_expected()}</span>
        </Tooltip>
      </th>
      <th scope="col" class="num">
        <Tooltip label={m.pos_shift_counted_help()} openDelay={300}>
          <span class="hdr-help">{m.pos_shift_counted()}</span>
        </Tooltip>
      </th>
      <th scope="col" class="num">
        <Tooltip label={m.pos_shift_difference_help()} openDelay={300}>
          <span class="hdr-help">{m.pos_shift_difference()}</span>
        </Tooltip>
      </th>
    </tr>
  </thead>
  <tbody>
    <tr class="total-row">
      <td>{m.pos_sell_total()}</td>
      <td class="num tabular-nums" colspan={4}>{formatMoney(total)}</td>
    </tr>
    {#each methodEntries as [method, amount] (method)}
      {@const exp = expected?.[method]}
      {@const diff = exp != null ? shiftDifference(counted?.[method] ?? 0, exp) : null}
      <tr>
        <td class="capitalize">{method}</td>
        <td class="num tabular-nums">{formatMoney(amount)}</td>
        <td class="num tabular-nums">{exp != null ? formatMoney(exp) : ''}</td>
        <td class="num tabular-nums">{exp != null ? formatMoney(counted?.[method] ?? 0) : ''}</td>
        <td class="num">
          {#if diff}
            <Badge variant="semantic" value={diff.balanced ? 'success' : 'warning'} size="sm">
              {diff.value == null ? '—' : formatMoney(diff.value)}
            </Badge>
          {/if}
        </td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .hdr-help {
    text-decoration: underline dotted;
    text-underline-offset: 2px;
    cursor: help;
  }

  .pay-summary {
    width: 100%;
    max-width: 40rem;
    border-top: 1px solid var(--color-border);
    font-size: var(--font-size-label);
  }
  .pay-summary th {
    text-align: left;
    font-weight: var(--font-weight-regular);
    color: var(--color-text-tertiary);
    padding: var(--space-1) var(--space-3);
  }
  .pay-summary td {
    padding: var(--space-1) var(--space-3);
  }
  .pay-summary .num {
    text-align: right;
  }
  .pay-summary tbody tr:hover {
    background: var(--color-surface-2);
  }
  .pay-summary .total-row {
    font-weight: var(--font-weight-medium);
    border-top: 1px solid var(--color-border);
    border-bottom: 1px solid var(--color-border);
  }
  .pay-summary .total-row td {
    padding-top: var(--space-2);
    padding-bottom: var(--space-2);
  }
</style>
