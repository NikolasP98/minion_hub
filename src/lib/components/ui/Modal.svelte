<script lang="ts" module>
  export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

  const SIZE: Record<ModalSize, string> = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  };
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import { X } from 'lucide-svelte';

  interface Props {
    /** Bindable open state. */
    open?: boolean;
    title?: string;
    size?: ModalSize;
    /** Allow closing by clicking the backdrop / pressing Esc. */
    dismissible?: boolean;
    /** Hide the default × close button. */
    hideClose?: boolean;
    onclose?: () => void;
    header?: Snippet;
    children?: Snippet;
    footer?: Snippet;
  }

  let {
    open = $bindable(false),
    title,
    size = 'md',
    dismissible = true,
    hideClose = false,
    onclose,
    header,
    children,
    footer,
  }: Props = $props();

  let dialog = $state<HTMLDialogElement>();

  // Drive the native <dialog> (free focus-trap, top-layer, inert background).
  $effect(() => {
    const d = dialog;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  });

  function close() {
    open = false;
    onclose?.();
  }

  // Native Esc fires `cancel`; block it when not dismissible.
  function oncancel(e: Event) {
    if (!dismissible) {
      e.preventDefault();
      return;
    }
    close();
  }

  function onBackdropClick(e: MouseEvent) {
    // A click whose target is the <dialog> itself is a backdrop click.
    if (dismissible && e.target === dialog) close();
  }
</script>

<dialog
  bind:this={dialog}
  {oncancel}
  onclick={onBackdropClick}
  class={`modal surface-4 w-[calc(100vw-2rem)] ${SIZE[size]} rounded-[var(--radius-xl)] p-0 text-foreground`}
  aria-label={title}
>
  {#if open}
    <div class="flex flex-col max-h-[85vh]">
      {#if header || title || !hideClose}
        <div class="shrink-0 flex items-center gap-3 px-5 py-3.5 border-b border-[var(--hairline)]">
          <div class="flex-1 min-w-0">
            {#if header}
              {@render header()}
            {:else if title}
              <h2 class="t-heading truncate">{title}</h2>
            {/if}
          </div>
          {#if !hideClose}
            <button
              type="button"
              onclick={close}
              class="flex items-center justify-center w-7 h-7 -mr-1 rounded-[var(--radius-md)] text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors duration-[150ms]"
              aria-label={m.common_close()}
            >
              <X size={16} />
            </button>
          {/if}
        </div>
      {/if}

      <div class="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        {#if children}{@render children()}{/if}
      </div>

      {#if footer}
        <div class="shrink-0 flex items-center justify-end gap-2 px-5 py-3.5 border-t border-[var(--hairline)]">
          {@render footer()}
        </div>
      {/if}
    </div>
  {/if}
</dialog>

<style>
  .modal {
    margin: auto; /* center in the viewport */
    border: 1px solid var(--elevation-4-border);
  }
  .modal::backdrop {
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(2px);
  }
  /* Enter animation (respects reduced-motion via the global media query) */
  .modal[open] {
    animation: modal-in var(--duration-normal, 250ms) var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
  }
  .modal[open]::backdrop {
    animation: modal-backdrop-in var(--duration-normal, 250ms) ease;
  }
  @keyframes modal-in {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
  @keyframes modal-backdrop-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
