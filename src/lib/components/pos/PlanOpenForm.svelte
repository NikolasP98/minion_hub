<script lang="ts">
  /**
   * Open an instalment plan — the caller side of `POST /api/pos/plans`
   * (spec `2026-09-13-pos-scheduling-packages-payment-plans` §2.2).
   *
   * Lives in both homes that already know a client: `ClientAccountDrawer`
   * (account view) and `BookingDetailDrawer` (pay THIS treatment in instalments,
   * which passes `bookingId` so the plan is created against the booking).
   *
   * Inline, not a nested Modal: both hosts are a `Sheet` (native
   * `<dialog showModal>`), and this mirrors the topup form already living inside
   * ClientAccountDrawer rather than stacking a second top-layer dialog.
   *
   * Opening a plan moves NO money — each instalment is a fully-paid ticket of
   * its own, so this only records the promise and its due dates.
   */
  import { Button, Input } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { planDueSchedule } from './checkout-money';

  type Props = {
    /** One of the two client refs the endpoint accepts — at least one required. */
    partyId?: string | null;
    crmContactId?: string | null;
    /** Set from the booking drawer so the plan is linked to that treatment. */
    bookingId?: string | null;
    /** Seeds the plan name (the event type / booking title). */
    defaultTitle?: string;
    /** Created — the host re-reads its own view. */
    oncreated: () => void | Promise<void>;
    oncancel: () => void;
  };

  let {
    partyId = null,
    crmContactId = null,
    bookingId = null,
    defaultTitle = '',
    oncreated,
    oncancel,
  }: Props = $props();

  // svelte-ignore state_referenced_locally — seeded once; a $derived would wipe typing
  let title = $state(defaultTitle);
  let amount = $state('');
  let instalments = $state('');
  let note = $state('');
  let busy = $state(false);
  let err = $state<string | null>(null);

  /** Cents-rounded once, so the total and its schedule can never disagree. */
  const total = $derived(Math.round(Number(amount) * 100) / 100);
  const count = $derived(Math.floor(Number(instalments)));
  const ready = $derived(Boolean(title.trim()) && total > 0); // NaN fails `> 0` too

  async function submit() {
    if (!ready) return;
    busy = true;
    err = null;
    try {
      const res = await fetch('/api/pos/plans', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          partyId,
          crmContactId,
          title: title.trim(),
          totalAmount: total,
          bookingId,
          // No instalment count given → no schedule; the plan is still open and
          // payable, it just has no due dates to fall behind on.
          dueSchedule: count > 1 ? planDueSchedule(total, count) : null,
          note: note.trim() || null,
        }),
      });
      // Same wire contract as the drawer's own `send()`: `{error, code}` json.
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        err = j.error ?? m.pos_plan_create_failed();
        return;
      }
      await oncreated();
    } catch (e) {
      err = e instanceof Error ? e.message : m.pos_plan_create_failed();
    } finally {
      busy = false;
    }
  }
</script>

<div class="form">
  <Input size="sm" label={m.pos_plan_form_title()} bind:value={title} />
  <Input
    size="sm"
    type="number"
    min="0"
    step="0.01"
    label={m.pos_plan_form_total()}
    bind:value={amount}
  />
  <Input
    size="sm"
    type="number"
    min="1"
    step="1"
    label={m.pos_plan_form_instalments()}
    helper={m.pos_plan_form_instalments_hint()}
    bind:value={instalments}
  />
  <Input size="sm" label={m.pos_plan_form_note()} bind:value={note} />
  <div class="row">
    <Button size="sm" disabled={busy || !ready} onclick={submit}>{m.pos_plan_open()}</Button>
    <Button size="sm" variant="ghost" disabled={busy} onclick={oncancel}>{m.common_cancel()}</Button
    >
  </div>
  {#if err}<p class="t-caption bad">{err}</p>{/if}
</div>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .bad {
    color: var(--color-danger-fg);
  }
</style>
