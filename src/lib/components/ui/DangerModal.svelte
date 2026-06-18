<script lang="ts" module>
  export type DangerMode = 'soft' | 'destructive';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { AlertTriangle } from 'lucide-svelte';
  import Modal from './Modal.svelte';
  import { Button } from '@minion-stack/ui';

  interface Props {
    open?: boolean;
    title?: string;
    /** 'soft' = confirm button only · 'destructive' = type-to-confirm gate. */
    mode?: DangerMode;
    /** For destructive mode: the exact phrase the user must type (e.g. resource name). */
    confirmWord?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    loading?: boolean;
    onconfirm?: () => void;
    oncancel?: () => void;
    /** Consequence description. */
    children?: Snippet;
  }

  let {
    open = $bindable(false),
    title = 'Are you sure?',
    mode = 'soft',
    confirmWord,
    confirmLabel = 'Delete',
    cancelLabel = 'Cancel',
    loading = false,
    onconfirm,
    oncancel,
    children,
  }: Props = $props();

  let typed = $state('');
  const canConfirm = $derived(mode === 'soft' || (!!confirmWord && typed.trim() === confirmWord));

  // Reset the typed gate whenever the modal opens.
  $effect(() => {
    if (open) typed = '';
  });

  function cancel() {
    open = false;
    oncancel?.();
  }
  function confirm() {
    if (!canConfirm) return;
    onconfirm?.();
  }
</script>

<Modal bind:open {title} size="sm" dismissible={!loading} onclose={oncancel}>
  {#snippet header()}
    <div class="flex items-center gap-2.5">
      <span
        class="flex items-center justify-center w-7 h-7 rounded-full shrink-0"
        style="background: color-mix(in srgb, var(--color-destructive) 16%, transparent); color: var(--color-destructive);"
      >
        <AlertTriangle size={15} />
      </span>
      <h2 class="t-heading truncate">{title}</h2>
    </div>
  {/snippet}

  <div class="t-body text-muted">
    {#if children}{@render children()}{/if}
  </div>

  {#if mode === 'destructive' && confirmWord}
    <label class="block mt-4">
      <span class="t-label block mb-1.5">
        Type <span class="font-mono text-foreground normal-case tracking-normal">{confirmWord}</span> to confirm
      </span>
      <input
        type="text"
        bind:value={typed}
        autocomplete="off"
        spellcheck="false"
        class="focus-ring-none w-full h-9 px-3 text-sm rounded-[var(--radius-md)] bg-bg2 border border-[var(--hairline)] text-foreground placeholder:text-muted-foreground focus:border-[color-mix(in_srgb,var(--color-destructive)_60%,transparent)] transition-colors duration-[150ms]"
        placeholder={confirmWord}
      />
    </label>
  {/if}

  {#snippet footer()}
    <Button variant="ghost" size="sm" disabled={loading} onclick={cancel}>{cancelLabel}</Button>
    <Button variant="danger" size="sm" {loading} disabled={!canConfirm} onclick={confirm}>
      {confirmLabel}
    </Button>
  {/snippet}
</Modal>
