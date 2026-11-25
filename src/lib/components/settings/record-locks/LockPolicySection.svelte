<script lang="ts">
  import { Info } from 'lucide-svelte';
  import { invalidate } from '$lib/navigation';
  import * as m from '$lib/paraglide/messages';
  import { iconSizes, Button, Card, Input, Toggle } from '$lib/components/ui';
  import { jsonMutation } from '$lib/api/json-mutation';
  import { ApiError } from '$lib/api/fetch-json';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
  import { correctionRefusal } from '$lib/components/stock/correction-refusals';
  import type { LockPolicy } from '$lib/types/record-locks';

  let { policy, isOwner }: { policy: LockPolicy; isOwner: boolean } = $props();

  // Drafts follow the saved policy until the owner edits them (writable $derived, reset by `invalidate`).
  let monthOn = $derived(policy.month);
  let daysOn = $derived(policy.days !== null);
  let daysText = $derived(policy.days !== null ? String(policy.days) : '');
  let saving = $state(false);

  const daysValue = $derived(/^\d{1,4}$/.test(daysText.trim()) ? Number(daysText.trim()) : NaN);
  const daysValid = $derived(!daysOn || (daysValue >= 1 && daysValue <= 3650));
  const dirty = $derived(
    monthOn !== policy.month ||
      daysOn !== (policy.days !== null) ||
      (daysOn && daysValue !== policy.days),
  );

  async function save() {
    if (!isOwner || saving || !dirty || !daysValid) return;
    saving = true;
    try {
      await jsonMutation({
        input: '/api/settings/record-locks/policy',
        init: {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            month: monthOn,
            days: daysOn ? daysValue : null,
            webhook: policy.webhook,
          }),
        },
        onSuccess: () => invalidate('settings:record-locks'),
      });
      toastSuccess(m.record_locks_saved());
    } catch (e) {
      const code =
        e instanceof ApiError ? (e.details as { code?: string } | undefined)?.code : undefined;
      toastError(correctionRefusal(code));
    } finally {
      saving = false;
    }
  }
</script>

<section class="section" aria-labelledby="record-locks-rules-title">
  <h2 id="record-locks-rules-title" class="sr-only">{m.record_locks_title()}</h2>

  <Card padding="none">
    <div class="rule">
      <div class="text">
        <h3 class="t-label">{m.record_locks_rule_month()}</h3>
        <p class="t-caption muted">{m.record_locks_rule_month_hint()}</p>
      </div>
      <div class="control">
        <Toggle
          bind:checked={monthOn}
          ariaLabel={m.record_locks_rule_month()}
          disabled={!isOwner || saving}
        />
      </div>
    </div>
    <div class="rule">
      <div class="text">
        <h3 class="t-label">{m.record_locks_rule_days()}</h3>
        <p class="t-caption muted">{m.record_locks_rule_days_hint()}</p>
      </div>
      <div class="control">
        <span class="days">
          <Input
            size="sm"
            bind:value={daysText}
            inputmode="numeric"
            maxlength={4}
            aria-label={m.record_locks_days_label()}
            disabled={!isOwner || saving || !daysOn}
            error={daysOn && !daysValid ? correctionRefusal('invalid_policy') : undefined}
          />
          <span class="t-body muted">{m.record_locks_days_unit()}</span>
        </span>
        <Toggle
          bind:checked={daysOn}
          ariaLabel={m.record_locks_rule_days()}
          onchange={(on) => {
            if (on && !daysText.trim()) daysText = '60';
          }}
          disabled={!isOwner || saving}
        />
      </div>
    </div>
  </Card>

  {#if isOwner}
    <div class="actions">
      <Button onclick={save} loading={saving} disabled={!dirty || !daysValid}>
        {m.record_locks_save()}
      </Button>
    </div>
  {:else}
    <p class="note t-body" role="note">
      <Info size={iconSizes.md} class="shrink-0" aria-hidden="true" />
      {m.record_locks_readonly_note()}
    </p>
  {/if}
</section>

<style>
  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .rule {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4);
  }
  .rule + .rule {
    border-top: 1px solid var(--color-border-subtle);
  }
  .text {
    min-width: 0;
  }
  .text h3,
  .text p {
    margin: 0;
  }
  .control {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex-shrink: 0;
  }
  .days {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    width: 9rem;
  }
  .muted {
    color: var(--color-text-secondary);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
  }
  .note {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    margin: 0;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--color-info-border);
    border-radius: var(--radius-md);
    background: var(--color-info-surface);
    color: var(--color-info-fg);
  }
</style>
