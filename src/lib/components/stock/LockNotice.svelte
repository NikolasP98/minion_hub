<script lang="ts">
  import { Lock } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { iconSizes } from '$lib/components/ui';
  import type { RecordLockResult } from '$lib/types/record-locks';
  import { lockReason } from './lock-reasons';

  let { lock }: { lock: Pick<RecordLockResult, 'rules'> } = $props();

  // A closed current month is a property of the month, not of the record: only reopening it helps.
  const ownerCanUnlock = $derived(lock.rules.every((h) => h.unlockable));
</script>

<div class="notice" role="status" data-testid="lock-notice">
  <Lock size={iconSizes.md} class="shrink-0" aria-hidden="true" />
  <div class="lines">
    {#each lock.rules as hit (hit.kind + (hit.lockId ?? ''))}
      <p class="t-body">{lockReason(hit)}</p>
    {/each}
    <p class="t-body">
      {ownerCanUnlock ? m.record_locks_notice_ask_owner() : m.record_locks_notice_reopen_month()}
    </p>
  </div>
</div>

<style>
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
  .lines {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  .lines p {
    margin: 0;
  }
</style>
