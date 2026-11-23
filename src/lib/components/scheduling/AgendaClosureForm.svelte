<script lang="ts">
  /**
   * "Cerrar agenda" (spec 147): close the whole agenda for a day range, all day
   * or a daily From–To window, with a reason everyone sees. One submit = one
   * closure per day on the server.
   */
  import { Button, Input, Toggle } from '$lib/components/ui';
  import { FormField } from '$lib/components/ui/foundations';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
  import * as m from '$lib/paraglide/messages';

  let {
    initialDate,
    initialTime = null,
    endpoint = '/api/scheduling/closures',
    onclosed,
    oncancel,
    dirty = $bindable(false),
  }: {
    initialDate: string;
    /** The clicked slot's `HH:MM`: prefills From (to the end of the day). */
    initialTime?: string | null;
    endpoint?: string;
    onclosed: () => void | Promise<void>;
    oncancel: () => void;
    dirty?: boolean;
  } = $props();

  // svelte-ignore state_referenced_locally -- seed once from the prefill props
  let fromDate = $state(initialDate);
  // svelte-ignore state_referenced_locally
  let toDate = $state(initialDate);
  // svelte-ignore state_referenced_locally
  let allDay = $state(!initialTime);
  // svelte-ignore state_referenced_locally
  let startTime = $state(initialTime ?? '09:00');
  let endTime = $state('20:00');
  let reason = $state('');
  let submitting = $state(false);
  let err = $state<string | null>(null);

  const invalid = $derived(
    !reason.trim() || !fromDate || toDate < fromDate || (!allDay && endTime <= startTime),
  );
  $effect(() => {
    dirty = reason.trim() !== '' || fromDate !== initialDate || toDate !== initialDate;
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (invalid || submitting) return;
    submitting = true;
    err = null;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fromDate,
          toDate,
          startTime: allDay ? null : startTime,
          endTime: allDay ? null : endTime,
          reason,
        }),
      });
      if (!res.ok) {
        err = res.status === 403 ? m.cal_closure_forbidden() : m.cal_closure_failed();
        toastError(err);
        return;
      }
      const { count } = (await res.json()) as { count: number };
      dirty = false;
      toastSuccess(m.cal_closure_created({ n: count }));
      await onclosed();
    } catch {
      err = m.cal_closure_failed();
      toastError(err);
    } finally {
      submitting = false;
    }
  }
</script>

<form class="closure-form" onsubmit={submit}>
  <div class="row">
    <FormField label={m.cal_closure_from()} required>
      {#snippet children(field)}
        <input {...field} class="txt" type="date" bind:value={fromDate} />
      {/snippet}
    </FormField>
    <FormField label={m.cal_closure_to()} required>
      {#snippet children(field)}
        <input {...field} class="txt" type="date" min={fromDate} bind:value={toDate} />
      {/snippet}
    </FormField>
  </div>
  <Toggle label={m.cal_closure_all_day()} bind:checked={allDay} />
  {#if !allDay}
    <div class="row">
      <FormField label={m.cal_closure_start()} required>
        {#snippet children(field)}
          <input {...field} class="txt" type="time" step="900" bind:value={startTime} />
        {/snippet}
      </FormField>
      <FormField label={m.cal_closure_end()} required>
        {#snippet children(field)}
          <input {...field} class="txt" type="time" step="900" bind:value={endTime} />
        {/snippet}
      </FormField>
    </div>
  {/if}
  <Input
    label={m.cal_closure_reason()}
    helper={m.cal_closure_reason_hint()}
    required
    maxlength={120}
    bind:value={reason}
  />
  {#if err}<p class="t-caption err" role="alert">{err}</p>{/if}
  <div class="actions">
    <Button variant="ghost" type="button" onclick={oncancel}>{m.sched_cancel()}</Button>
    <Button variant="danger" type="submit" disabled={invalid} loading={submitting}>
      {m.cal_closure_submit()}
    </Button>
  </div>
</form>

<style>
  .closure-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }
  .txt {
    width: 100%;
    height: var(--control-height-md);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    padding: 0 var(--space-2);
    font-family: inherit;
  }
  .err {
    color: var(--color-danger-fg);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
