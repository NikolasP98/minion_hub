<script lang="ts">
  /**
   * Title-bar autosave feedback (owner directive: visual feedback is the key
   * to trust). Rendered by `RecordPeek` (peek header) and by any record page
   * that also wants the same indicator outside a peek (`SellableEditorPage`).
   */
  import { Check, AlertCircle } from 'lucide-svelte';
  import { Button, Spinner, iconSizes } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import type { SaveState } from './save-status.svelte';

  interface Props {
    status: SaveState;
    message?: string;
    onRetry?: () => void;
  }
  let { status, message, onRetry }: Props = $props();
</script>

{#if status === 'saving'}
  <span class="save-indicator" role="status">
    <Spinner size="sm" />
    <span class="t-caption">{m.record_saving()}</span>
  </span>
{:else if status === 'saved'}
  <span class="save-indicator" role="status">
    <Check size={iconSizes.sm} class="ok" aria-hidden="true" />
    <span class="t-caption ok">{m.record_saved()}</span>
  </span>
{:else if status === 'error'}
  <span class="save-indicator" role="status">
    <AlertCircle size={iconSizes.sm} class="err" aria-hidden="true" />
    <span class="t-caption err">{message ?? m.record_save_failed()}</span>
    {#if onRetry}
      <Button variant="ghost" size="xs" onclick={onRetry}>{m.record_retry()}</Button>
    {/if}
  </span>
{/if}

<style>
  .save-indicator {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--space-1);
  }
  .ok {
    color: var(--color-success-fg);
  }
  .err {
    color: var(--color-danger-fg);
  }
</style>
