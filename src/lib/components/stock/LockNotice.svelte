<script lang="ts">
  import { Lock, LockOpen } from 'lucide-svelte';
  import { invalidate } from '$lib/navigation';
  import * as m from '$lib/paraglide/messages';
  import { iconSizes, Button, Input } from '$lib/components/ui';
  import { Dialog, FormField } from '$lib/components/ui/foundations';
  import { jsonMutation } from '$lib/api/json-mutation';
  import { ApiError } from '$lib/api/fetch-json';
  import { formatDate } from '$lib/utils/format';
  import type { RecordLockResult } from '$lib/types/record-locks';
  import { correctionRefusal } from './correction-refusals';
  import { lockReason } from './lock-reasons';

  let {
    lock,
    recordId,
    isOwner = false,
  }: {
    lock: Pick<RecordLockResult, 'locked' | 'rules' | 'unlock'>;
    /** The receipt this notice is about (the unlock is granted for it). */
    recordId: string;
    isOwner?: boolean;
  } = $props();

  // A closed current month is a property of the month, not of the record: only reopening it helps.
  const ownerCanUnlock = $derived(lock.rules.every((h) => h.unlockable));

  let open = $state(false);
  let reason = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);

  function openDialog() {
    reason = '';
    error = null;
    open = true;
  }

  async function unlock() {
    if (busy || !reason.trim()) return;
    busy = true;
    error = null;
    try {
      await jsonMutation({
        input: '/api/settings/record-locks/unlocks',
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            recordType: 'stock_receipt',
            recordId,
            reason: reason.trim(),
          }),
        },
        onSuccess: () => invalidate('stock:entry-detail'),
      });
      open = false;
    } catch (e) {
      const code =
        e instanceof ApiError ? (e.details as { code?: string } | undefined)?.code : undefined;
      error = correctionRefusal(code);
    } finally {
      busy = false;
    }
  }
</script>

{#if lock.unlock && !lock.locked}
  <div class="notice unlocked" role="status" data-testid="lock-unlocked">
    <LockOpen size={iconSizes.md} class="shrink-0" aria-hidden="true" />
    <p class="t-body">
      {m.record_locks_unlocked_state({
        until: formatDate(lock.unlock.expiresAt, { dateStyle: 'short', timeStyle: 'short' }),
        name: lock.unlock.grantedByName ?? m.record_locks_unlocked_by_owner(),
      })}
    </p>
  </div>
{:else if lock.locked}
  <div class="stack">
    <div class="notice" role="status" data-testid="lock-notice">
      <Lock size={iconSizes.md} class="shrink-0" aria-hidden="true" />
      <div class="lines">
        {#each lock.rules as hit (hit.kind + (hit.lockId ?? ''))}
          <p class="t-body">{lockReason(hit)}</p>
        {/each}
        {#if !isOwner}
          <p class="t-body">
            {ownerCanUnlock
              ? m.record_locks_notice_ask_owner()
              : m.record_locks_notice_reopen_month()}
          </p>
        {:else if !ownerCanUnlock}
          <p class="t-body">{m.record_locks_notice_reopen_month()}</p>
        {/if}
      </div>
    </div>
    {#if isOwner && ownerCanUnlock}
      <div>
        <Button variant="outline" size="sm" onclick={openDialog}>
          <LockOpen size={iconSizes.sm} />
          {m.record_locks_unlock_action()}
        </Button>
      </div>
    {/if}
  </div>
{/if}

<Dialog
  {open}
  labelledBy="record-locks-unlock-title"
  size="sm"
  dirty={!busy && !!reason.trim()}
  onclose={() => (open = false)}
>
  {#snippet header()}
    <h2 id="record-locks-unlock-title" class="t-title">{m.record_locks_unlock_action()}</h2>
  {/snippet}
  <div class="form">
    <p class="t-body">{m.record_locks_unlock_body()}</p>
    <FormField label={m.record_locks_unlock_reason()} required disabled={busy}>
      {#snippet children(p)}<Input {...p} bind:value={reason} maxlength={1000} />{/snippet}
    </FormField>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)} disabled={busy}>
      {m.common_cancel()}
    </Button>
    <Button onclick={unlock} loading={busy} disabled={!reason.trim()}>
      <LockOpen size={iconSizes.sm} />
      {m.record_locks_unlock_confirm()}
    </Button>
  {/snippet}
</Dialog>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .notice {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--color-warning-border);
    border-radius: var(--radius-md);
    background: var(--color-warning-surface);
    color: var(--color-warning-fg);
  }
  .notice.unlocked {
    border-color: var(--color-success-border);
    background: var(--color-success-surface);
    color: var(--color-success-fg);
  }
  .lines {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  .lines p,
  .unlocked p {
    margin: 0;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .error {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-danger-border);
    border-radius: var(--radius-md);
    color: var(--color-danger-fg);
    background: var(--color-danger-surface);
    font-size: var(--font-size-caption);
  }
</style>
