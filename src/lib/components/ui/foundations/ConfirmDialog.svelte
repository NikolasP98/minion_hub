<script lang="ts" module>
  export type ConfirmDialogTone = 'default' | 'danger';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { AlertTriangle } from 'lucide-svelte';
  import { Button } from '@minion-stack/ui';
  import * as m from '$lib/paraglide/messages';
  import Dialog from './Dialog.svelte';
  import type { DialogCloseReason, DialogVariant } from './Dialog.svelte';

  interface Props {
    open?: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    failureMessage: string;
    tone?: ConfirmDialogTone;
    variant?: DialogVariant;
    onconfirm: () => void | Promise<void>;
    onconfirmed?: () => void;
    onclose?: (reason: DialogCloseReason) => void;
    details?: Snippet;
  }

  let {
    open = $bindable(false),
    title,
    message,
    confirmLabel = m.common_confirm(),
    cancelLabel = m.common_cancel(),
    failureMessage,
    tone = 'default',
    variant = 'default',
    onconfirm,
    onconfirmed,
    onclose,
    details,
  }: Props = $props();

  let busy = $state(false);
  let failed = $state(false);
  let wasOpen = false;

  $effect(() => {
    if (open && !wasOpen) failed = false;
    wasOpen = open;
  });

  async function confirm() {
    if (busy) return;
    busy = true;
    failed = false;
    try {
      await onconfirm();
      open = false;
      onconfirmed?.();
    } catch {
      failed = true;
    } finally {
      busy = false;
    }
  }

  function close(reason: DialogCloseReason) {
    if (busy) return;
    onclose?.(reason);
  }

  function cancel() {
    if (busy) return;
    open = false;
    onclose?.('cancel');
  }
</script>

<Dialog bind:open {title} size="sm" {variant} dismissible={!busy} hideClose={busy} onclose={close}>
  <div data-component="confirm-dialog" data-tone={tone} class="confirm-copy">
    {#if tone === 'danger'}
      <span class="confirm-icon" aria-hidden="true"><AlertTriangle size={18} /></span>
    {/if}
    <div>
      <p>{message}</p>
      {#if details}<div class="confirm-details">{@render details()}</div>{/if}
    </div>
  </div>
  {#if failed}
    <p class="confirm-error" role="alert">{failureMessage}</p>
  {/if}

  {#snippet footer()}
    <Button variant="ghost" disabled={busy} onclick={cancel}>{cancelLabel}</Button>
    <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={busy} onclick={confirm}>
      {confirmLabel}
    </Button>
  {/snippet}
</Dialog>

<style>
  .confirm-copy {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3, 12px);
    color: var(--color-text-secondary, var(--color-muted));
    font-size: var(--font-size-body, 14px);
    line-height: var(--line-height-body, 20px);
  }
  .confirm-icon {
    display: inline-flex;
    width: var(--control-height-md, 32px);
    height: var(--control-height-md, 32px);
    flex: none;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--color-danger-border, var(--color-destructive));
    border-radius: var(--radius-full, 9999px);
    color: var(--color-danger-fg, var(--color-destructive));
    background: var(--color-danger-surface, transparent);
  }
  .confirm-details {
    margin-top: var(--space-2, 8px);
  }
  .confirm-error {
    margin-top: var(--space-3, 12px);
    border: 1px solid var(--color-danger-border, var(--color-destructive));
    border-radius: var(--radius-md);
    padding: var(--space-2, 8px) var(--space-3, 12px);
    color: var(--color-danger-fg, var(--color-destructive));
    background: var(--color-danger-surface, transparent);
    font-size: var(--font-size-caption, 12px);
  }
</style>
