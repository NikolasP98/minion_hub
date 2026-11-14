<script lang="ts" module>
  /** Where a voided sale's money goes (spec 2026-10-13 I3): cash is the default. */
  export type RefundChoice = 'cash' | 'credit' | 'none';
</script>

<script lang="ts">
  import * as m from '$lib/paraglide/messages';

  let { value = $bindable('cash') }: { value?: RefundChoice } = $props();
</script>

<fieldset class="refund">
  <legend class="t-label">{m.pos_appt_refund_label()}</legend>
  {#each [['cash', m.pos_appt_refund_cash()], ['credit', m.pos_appt_refund_credit()], ['none', m.pos_appt_refund_none()]] as [choice, label] (choice)}
    <label class="refund-opt">
      <input type="radio" name="refund" value={choice} bind:group={value} />
      {label}
    </label>
  {/each}
</fieldset>

<style>
  .refund {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: var(--space-3) 0 0;
    padding: 0;
    border: 0;
  }
  .refund-opt {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--control-height-sm);
    color: var(--color-text-primary);
    cursor: pointer;
  }
  .refund-opt input {
    accent-color: var(--color-accent);
  }
</style>
