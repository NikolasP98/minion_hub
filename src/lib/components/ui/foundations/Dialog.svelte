<script lang="ts" module>
  export type DialogSize = 'sm' | 'md' | 'lg' | 'xl';
  export type DialogVariant = 'default' | 'crt' | 'voxelized' | 'canvas' | 'terminal';
  export type DialogCloseReason = 'close-button' | 'cancel' | 'backdrop' | 'programmatic';
  export type DialogPresentation = 'dialog' | 'sheet';
  export type SheetPlacement = 'left' | 'right' | 'bottom';
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Snippet } from 'svelte';
  import { X } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { acquireDialogScrollLock } from './dialog-scroll-lock';
  import { assertDialogLabel } from './dialog';

  interface Props {
    open?: boolean;
    /** Required unless `labelledBy` points at a visible heading supplied by `header`. */
    title?: string;
    labelledBy?: string;
    description?: string;
    describedBy?: string;
    size?: DialogSize;
    variant?: DialogVariant;
    presentation?: DialogPresentation;
    placement?: SheetPlacement;
    dismissible?: boolean;
    hideClose?: boolean;
    initialFocus?: string;
    onclose?: (reason: DialogCloseReason) => void;
    header?: Snippet;
    children?: Snippet;
    footer?: Snippet;
    class?: string;
  }

  let {
    open = $bindable(false),
    title,
    labelledBy,
    description,
    describedBy,
    size = 'md',
    variant = 'default',
    presentation = 'dialog',
    placement = 'right',
    dismissible = true,
    hideClose = false,
    initialFocus,
    onclose,
    header,
    children,
    footer,
    class: cls = '',
  }: Props = $props();

  $effect.pre(() => assertDialogLabel(title, labelledBy));

  const uid = $props.id();
  const titleId = `${uid}-title`;
  const descriptionId = `${uid}-description`;
  const accessibleTitleId = $derived(labelledBy ?? (title ? titleId : undefined));
  const accessibleDescriptionId = $derived(
    describedBy ?? (description ? descriptionId : undefined),
  );

  let dialogElement = $state<HTMLDialogElement>();
  let releaseScrollLock: (() => void) | undefined;
  let returnFocus: HTMLElement | null = null;
  let closeEmitted = false;

  function releaseModalState() {
    releaseScrollLock?.();
    releaseScrollLock = undefined;
    if (returnFocus?.isConnected) queueMicrotask(() => returnFocus?.focus());
    returnFocus = null;
  }

  function emitClose(reason: DialogCloseReason) {
    if (closeEmitted) return;
    closeEmitted = true;
    onclose?.(reason);
  }

  function requestClose(reason: DialogCloseReason) {
    if (!open) return;
    open = false;
    emitClose(reason);
  }

  $effect(() => {
    const element = dialogElement;
    if (!element) return;

    if (open && !element.open) {
      closeEmitted = false;
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal();
      releaseScrollLock = acquireDialogScrollLock();
      if (initialFocus) {
        queueMicrotask(() => element.querySelector<HTMLElement>(initialFocus)?.focus());
      }
    } else if (!open && element.open) {
      element.close();
    }
  });

  function handleCancel(event: Event) {
    event.preventDefault();
    if (dismissible) requestClose('cancel');
  }

  function handleBackdropClick(event: MouseEvent) {
    if (dismissible && event.target === dialogElement) requestClose('backdrop');
  }

  function handleNativeClose() {
    releaseModalState();
    if (open) {
      open = false;
      emitClose('programmatic');
    }
  }

  onDestroy(() => {
    releaseModalState();
    if (dialogElement?.open) dialogElement.close();
  });
</script>

<dialog
  bind:this={dialogElement}
  data-component="dialog"
  data-part="positioner"
  data-presentation={presentation}
  data-placement={presentation === 'sheet' ? placement : undefined}
  data-size={size}
  data-variant={variant}
  aria-labelledby={accessibleTitleId}
  aria-describedby={accessibleDescriptionId}
  oncancel={handleCancel}
  onclose={handleNativeClose}
  onclick={handleBackdropClick}
  class={`dialog-positioner ${cls}`}
>
  {#if open}
    <section data-part="content" class="dialog-content" tabindex="-1">
      {#if header || title || !hideClose}
        <header data-part="header" class="dialog-header">
          <div class="dialog-heading">
            {#if header}
              {@render header()}
            {:else if title}
              <h2 id={titleId}>{title}</h2>
            {/if}
            {#if description}
              <p id={descriptionId}>{description}</p>
            {/if}
          </div>
          {#if !hideClose}
            <button
              type="button"
              data-part="close-trigger"
              onclick={() => requestClose('close-button')}
              aria-label={m.common_close()}
            >
              <X size={16} aria-hidden="true" />
            </button>
          {/if}
        </header>
      {/if}

      <div data-part="body" class="dialog-body">
        {#if children}{@render children()}{/if}
      </div>

      {#if footer}
        <footer data-part="footer" class="dialog-footer">
          {@render footer()}
        </footer>
      {/if}
    </section>
  {/if}
</dialog>

<style>
  .dialog-positioner {
    width: calc(100% - (2 * var(--space-page-gutter, 16px)));
    max-width: min(calc(100% - (2 * var(--space-page-gutter, 16px))), 64rem);
    max-height: calc(100dvh - (2 * var(--space-page-gutter, 16px)));
    margin: auto;
    padding: 0;
    border: 0;
    color: var(--color-text-primary, var(--color-foreground));
    background: transparent;
    overflow: visible;
  }

  .dialog-positioner::backdrop {
    background: color-mix(in srgb, var(--color-canvas, var(--color-bg)) 62%, transparent);
    backdrop-filter: blur(3px);
  }

  .dialog-positioner[data-size='sm'] {
    max-width: min(calc(100% - (2 * var(--space-page-gutter, 16px))), 24rem);
  }
  .dialog-positioner[data-size='md'] {
    max-width: min(calc(100% - (2 * var(--space-page-gutter, 16px))), 32rem);
  }
  .dialog-positioner[data-size='lg'] {
    max-width: min(calc(100% - (2 * var(--space-page-gutter, 16px))), 42rem);
  }
  .dialog-positioner[data-size='xl'] {
    max-width: min(calc(100% - (2 * var(--space-page-gutter, 16px))), 56rem);
  }

  .dialog-content {
    display: flex;
    max-height: inherit;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--color-border-strong, var(--elevation-4-border));
    border-radius: var(--radius-xl);
    outline: none;
    background: var(--color-overlay, var(--elevation-4-bg));
    box-shadow: var(--shadow-overlay, var(--shadow-xl, var(--shadow-lg)));
  }

  .dialog-header,
  .dialog-footer {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-3, 12px);
    padding: var(--space-3, 12px) var(--space-4, 16px);
  }
  .dialog-header {
    border-bottom: 1px solid var(--color-border-subtle, var(--hairline));
  }
  .dialog-footer {
    justify-content: flex-end;
    border-top: 1px solid var(--color-border-subtle, var(--hairline));
  }
  .dialog-heading {
    min-width: 0;
    flex: 1;
  }
  .dialog-heading h2 {
    overflow: hidden;
    font-size: var(--font-size-section-title, 14px);
    line-height: var(--line-height-heading, 20px);
    font-weight: var(--font-weight-semibold, 600);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dialog-heading p {
    margin-top: var(--space-0-5, 2px);
    color: var(--color-text-secondary, var(--color-muted));
    font-size: var(--font-size-caption, 12px);
    line-height: var(--line-height-compact, 16px);
  }
  [data-part='close-trigger'] {
    display: inline-flex;
    width: var(--control-height-md, 32px);
    height: var(--control-height-md, 32px);
    flex: none;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: var(--radius-md);
    color: var(--color-text-secondary, var(--color-muted));
    background: transparent;
    transition:
      color var(--duration-fast, 150ms) var(--ease-standard),
      background-color var(--duration-fast, 150ms) var(--ease-standard);
  }
  [data-part='close-trigger']:hover {
    color: var(--color-text-primary, var(--color-foreground));
    background: color-mix(
      in srgb,
      var(--color-text-primary, var(--color-foreground)) 7%,
      transparent
    );
  }
  [data-part='close-trigger']:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .dialog-body {
    min-height: 0;
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--space-4, 16px);
  }

  .dialog-positioner[open] .dialog-content {
    animation: dialog-enter var(--duration-normal, 250ms) var(--ease-enter, ease-out);
  }

  .dialog-positioner[data-presentation='sheet'] {
    position: fixed;
    width: min(28rem, 100%);
    max-width: 100%;
    height: 100dvh;
    max-height: 100dvh;
    margin: 0;
  }
  .dialog-positioner[data-presentation='sheet'][data-placement='right'] {
    inset: 0 0 0 auto;
  }
  .dialog-positioner[data-presentation='sheet'][data-placement='left'] {
    inset: 0 auto 0 0;
  }
  .dialog-positioner[data-presentation='sheet'][data-placement='bottom'] {
    inset: auto 0 0;
    width: 100%;
    height: auto;
    max-height: min(85dvh, 48rem);
  }
  .dialog-positioner[data-presentation='sheet'] .dialog-content {
    height: 100%;
    max-height: inherit;
    border-radius: 0;
  }
  .dialog-positioner[data-presentation='sheet'][data-placement='bottom'] .dialog-content {
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  }

  .dialog-positioner[data-variant='terminal'] .dialog-content,
  .dialog-positioner[data-variant='canvas'] .dialog-content {
    font-family: var(--font-family-mono, var(--font-mono));
  }

  @keyframes dialog-enter {
    from {
      opacity: 0;
      transform: translateY(var(--space-2, 8px)) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @media (max-width: 767.98px) {
    .dialog-positioner[data-presentation='dialog'] {
      width: calc(100% - (2 * var(--space-2, 8px)));
      max-height: calc(100dvh - (2 * var(--space-2, 8px)));
    }
    .dialog-header,
    .dialog-footer,
    .dialog-body {
      padding-left: var(--space-4, 16px);
      padding-right: var(--space-4, 16px);
    }
    [data-part='close-trigger'] {
      width: var(--control-height-touch, 44px);
      height: var(--control-height-touch, 44px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .dialog-positioner[open] .dialog-content {
      animation: none;
    }
  }
</style>
