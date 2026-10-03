<script module lang="ts">
  export type { PlanCreatedCallback, PlanCreatedOwner } from './plan-open-operation.svelte';
  export type { PlanOpenContinuation } from './plan-open-persistence';
</script>

<script lang="ts">
  /**
   * Open an instalment plan through POST /api/pos/plans
   * (spec 2026-09-13-pos-scheduling-packages-payment-plans section 2.2).
   *
   * Lives in both homes that already know a client: ClientAccountDrawer
   * (account view) and BookingDetailDrawer (pay this treatment in instalments,
   * which passes bookingId so the plan is created against the booking).
   *
   * Inline, not a nested Modal: both hosts are a Sheet (native dialog), and
   * this mirrors the topup form already living inside ClientAccountDrawer.
   *
   * Opening a plan moves no money. Each instalment is a fully-paid ticket of
   * its own, so this only records the promise and its due dates.
   */
  import { onDestroy, untrack } from 'svelte';
  import { Button, Input } from '$lib/components/ui';
  import { ConfirmDialog } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import { decimalToNumber } from '$lib/money/decimal';
  import { moneyDraft, planDueSchedule } from './checkout-money';
  import { PlanOpenOperation, type PlanCreatedCallback } from './plan-open-operation.svelte';
  import type { PlanOpenContinuation } from './plan-open-persistence';

  type Props = {
    /** One of the two client refs the endpoint accepts — at least one required. */
    partyId?: string | null;
    crmContactId?: string | null;
    /** Set from the booking drawer so the plan is linked to that treatment. */
    bookingId?: string | null;
    /** Seeds the plan name (the event type / booking title). */
    defaultTitle?: string;
    /** Seeds the total (the pay step passes the cart total). */
    defaultAmount?: number | null;
    /** Canonical organization/UI owner. A change cancels this form's observation. */
    mutationScope: string;
    actorId: string;
    orgId: string;
    continuation: PlanOpenContinuation;
    /** Created — the host re-reads its own view; the new plan's id lets it act on it. */
    oncreated: PlanCreatedCallback;
    /** Runs only after the post-commit callback settles while this owner remains current. */
    oncompleted?: () => void;
    oncancel: () => void;
  };

  let {
    partyId = null,
    crmContactId = null,
    bookingId = null,
    defaultTitle = '',
    defaultAmount = null,
    mutationScope,
    actorId,
    orgId,
    continuation,
    oncreated,
    oncompleted = () => {},
    oncancel,
  }: Props = $props();

  // svelte-ignore state_referenced_locally — seeded once, then reset only for a new owner scope
  let title = $state(defaultTitle);
  // svelte-ignore state_referenced_locally — same one-shot seed as the title
  let amount = $state(defaultAmount != null && defaultAmount > 0 ? String(defaultAmount) : '');
  let instalments = $state('');
  let note = $state('');
  let cancelConfirmOpen = $state(false);
  let restoreConfirmOpen = $state(false);

  function scopeKey(): string {
    const owner = mutationScope.trim();
    if (!owner || !actorId || !orgId || (!partyId && !crmContactId)) return '';
    return JSON.stringify([
      owner,
      actorId,
      orgId,
      partyId ?? null,
      crmContactId ?? null,
      bookingId ?? null,
    ]);
  }

  const operation = new PlanOpenOperation({ currentScope: scopeKey });
  const amountState = $derived(moneyDraft(amount, { positive: true, numeric12: true }));
  const titleValid = $derived(title.trim().length > 0 && title.trim().length <= 500);
  const noteValid = $derived(note.trim().length <= 2_000);
  const countState = $derived.by(() => {
    if (instalments.trim() === '') return { ok: true as const, value: null };
    try {
      const value = decimalToNumber(instalments);
      return Number.isInteger(value) && value >= 1 && value <= 365
        ? { ok: true as const, value }
        : { ok: false as const };
    } catch {
      return { ok: false as const };
    }
  });
  const ready = $derived(
    Boolean(scopeKey()) &&
      titleValid &&
      noteValid &&
      amountState.ok &&
      countState.ok &&
      !operation.busy &&
      !operation.locked,
  );

  function resetToDefaults() {
    title = defaultTitle;
    amount = defaultAmount != null && defaultAmount > 0 ? String(defaultAmount) : '';
    instalments = '';
    note = '';
  }

  function restoreIntent(intent: NonNullable<typeof operation.restoredIntent>) {
    title = intent.title;
    amount = String(intent.totalAmount);
    instalments =
      intent.dueSchedule && intent.dueSchedule.length > 1 ? String(intent.dueSchedule.length) : '';
    note = intent.note ?? '';
  }

  $effect(() => {
    const next = scopeKey();
    const binding = {
      scope: next,
      identity: { actorId, orgId },
      continuation,
      afterCreated: oncreated,
      afterCompleted: oncompleted,
    };
    untrack(() => {
      if (operation.syncScope(next)) resetToDefaults();
      if (!next) return;
      void operation.initialize(binding).then((intent) => {
        if (intent && scopeKey() === next) restoreIntent(intent);
      });
    });
  });

  onDestroy(() => operation.dispose());

  async function submit() {
    if (!ready) return;
    const amountResult = amountState;
    const countResult = countState;
    const scope = scopeKey();
    if (!amountResult.ok || !countResult.ok || !scope) return;
    const dueSchedule =
      countResult.value != null && countResult.value > 1
        ? planDueSchedule(amount, countResult.value)
        : null;
    await operation.submit({
      scope,
      identity: { actorId, orgId },
      continuation,
      partyId,
      crmContactId,
      bookingId,
      title: title.trim(),
      totalAmount: amountResult.value.number,
      dueSchedule,
      note: note.trim() || null,
      afterCreated: oncreated,
      afterCompleted: oncompleted,
    });
  }
</script>

<div class="form">
  <Input
    size="sm"
    label={m.pos_plan_form_title()}
    maxlength={500}
    disabled={operation.busy || operation.locked}
    error={title !== '' && !titleValid ? m.pos_plan_title_invalid() : undefined}
    bind:value={title}
  />
  <Input
    size="sm"
    type="text"
    inputmode="decimal"
    label={m.pos_plan_form_total()}
    disabled={operation.busy || operation.locked}
    error={amount !== '' && !amountState.ok ? m.pos_money_invalid_amount() : undefined}
    bind:value={amount}
  />
  <Input
    size="sm"
    type="text"
    inputmode="numeric"
    label={m.pos_plan_form_instalments()}
    helper={m.pos_plan_form_instalments_hint()}
    disabled={operation.busy || operation.locked}
    error={!countState.ok ? m.pos_plan_invalid_instalments() : undefined}
    bind:value={instalments}
  />
  <Input
    size="sm"
    label={m.pos_plan_form_note()}
    maxlength={2000}
    disabled={operation.busy || operation.locked}
    error={!noteValid ? m.pos_plan_note_invalid() : undefined}
    bind:value={note}
  />
  <div class="row">
    <Button size="sm" disabled={!ready} onclick={submit}>{m.pos_plan_open()}</Button>
    {#if operation.locked}
      {#if operation.restoredIntent}
        <Button
          size="sm"
          variant="outline"
          loading={operation.busy}
          disabled={operation.busy}
          onclick={() => operation.reconcile()}
        >
          {m.pos_plan_check_status()}
        </Button>
      {/if}
      {#if operation.canCancel}
        <Button
          size="sm"
          variant="outline"
          disabled={operation.busy}
          onclick={() => (cancelConfirmOpen = true)}
        >
          {m.pos_plan_cancel_pending()}
        </Button>
      {/if}
      {#if operation.needsCartRestore}
        <Button
          size="sm"
          variant="outline"
          disabled={operation.busy}
          onclick={() => (restoreConfirmOpen = true)}
        >
          {m.pos_plan_restore_pending()}
        </Button>
      {/if}
    {/if}
    <Button
      size="sm"
      variant="ghost"
      disabled={operation.busy || operation.locked}
      onclick={oncancel}>{m.common_cancel()}</Button
    >
  </div>
  {#if operation.message}
    <p class:good={operation.success} class="t-caption bad" role="alert">{operation.message}</p>
  {/if}
</div>

<ConfirmDialog
  bind:open={cancelConfirmOpen}
  title={m.pos_plan_cancel_pending()}
  message={m.pos_plan_cancel_pending_confirm()}
  confirmLabel={m.pos_plan_cancel_pending()}
  failureMessage={m.pos_plan_cancel_request_failed()}
  onconfirm={() => operation.cancel()}
/>

<ConfirmDialog
  bind:open={restoreConfirmOpen}
  title={m.pos_plan_restore_pending()}
  message={m.pos_plan_restore_confirm()}
  confirmLabel={m.pos_plan_restore_pending()}
  failureMessage={m.pos_plan_reconcile_failed()}
  onconfirm={() => operation.reconcile({ allowCartReplace: true })}
/>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .row :global(button) {
    min-width: 0;
    max-width: 100%;
  }
  .row :global(button > span) {
    min-width: 0;
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
    text-align: center;
  }
  @media (max-width: 767.98px), (pointer: coarse) {
    .row :global(button) {
      min-height: var(--control-height-touch);
    }
  }
  .bad {
    color: var(--color-danger-fg);
  }
  .bad.good {
    color: var(--color-success-fg);
  }
</style>
