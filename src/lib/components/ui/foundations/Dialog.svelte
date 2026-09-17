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

  // Only an OPEN dialog needs its accessible name: callers routinely mount a
  // closed dialog with an empty title until there is something to edit
  // (SecretsSection → SecretEditModal on /settings), and asserting at mount
  // threw on every client-side navigation to such a page.
  $effect.pre(() => {
    if (open) assertDialogLabel(title, labelledBy);
  });

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
  // True while the panel/backdrop plays its exit animation — the native
  // dialog stays open (and mounted) until `handleContentAnimationEnd` calls
  // the real `.close()`, so the CSS transition has something to animate.
  let closing = $state(false);

  function releaseModalState() {
    releaseScrollLock?.();
    releaseScrollLock = undefined;
    const target = returnFocus;
    if (target?.isConnected) queueMicrotask(() => target.focus());
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

    if (open) {
      // TODO(handoff): reopened mid-exit — cancel the pending close. The CSS
      // exit animation is abandoned for the enter one rather than crossfaded
      // (ponytail: acceptable snap for a sub-250ms open/close/reopen race;
      // upgrade to a crossfade only if this proves visible in practice).
      closing = false;
      if (!element.open) {
        closeEmitted = false;
        returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        element.showModal();
        releaseScrollLock = acquireDialogScrollLock();
        if (initialFocus) {
          queueMicrotask(() => element.querySelector<HTMLElement>(initialFocus)?.focus());
        }
      }
    } else if (element.open && !closing) {
      closing = true;
    }
  });

  // Fires for both the enter and exit CSS animations on `.dialog-content`;
  // only the exit one should trigger the real native close.
  function handleContentAnimationEnd(event: AnimationEvent) {
    if (!closing || event.target !== event.currentTarget) return;
    closing = false;
    const element = dialogElement;
    if (element?.open) {
      // Release this closing's state now: the native close event is queued and
      // may arrive after the same dialog has already been opened again.
      releaseModalState();
      element.close();
    }
  }

  function handleCancel(event: Event) {
    event.preventDefault();
    if (dismissible) requestClose('cancel');
  }

  function handleBackdropClick(event: MouseEvent) {
    if (dismissible && event.target === dialogElement) requestClose('backdrop');
  }

  function handleNativeClose() {
    // Ignore a queued close event from an earlier opening.
    if (dialogElement?.open) return;
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
  data-closing={closing || undefined}
  aria-labelledby={accessibleTitleId}
  aria-describedby={accessibleDescriptionId}
  oncancel={handleCancel}
  onclose={handleNativeClose}
  onclick={handleBackdropClick}
  class={`dialog-positioner ${cls}`}
>
  {#if open || closing}
    <section
      data-part="content"
      class="dialog-content"
      tabindex="-1"
      onanimationend={handleContentAnimationEnd}
    >
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

  .dialog-positioner[data-presentation='dialog'][open]:not([data-closing]) .dialog-content {
    animation: dialog-enter var(--duration-normal, 250ms) var(--ease-enter, ease-out);
  }
  .dialog-positioner[data-presentation='dialog'][data-closing] .dialog-content {
    animation: dialog-exit var(--duration-normal, 250ms) var(--ease-exit, ease-in) forwards;
  }

  /* Sheet backdrop + panel: slide in from the placement edge on open, slide
     back out on close. The native dialog stays `[open]` for the whole exit
     animation (see `closing` in the script) so both the panel and the
     `::backdrop` have something to transition. */
  .dialog-positioner[open]:not([data-closing])::backdrop {
    animation: backdrop-fade-in var(--duration-normal, 250ms) var(--ease-standard, ease) forwards;
  }
  .dialog-positioner[data-closing]::backdrop {
    animation: backdrop-fade-out var(--duration-normal, 250ms) var(--ease-exit, ease-in) forwards;
  }

  .dialog-positioner[data-presentation='sheet'][data-placement='left'][open]:not([data-closing])
    .dialog-content {
    animation: sheet-enter-left var(--duration-normal, 250ms) var(--ease-enter, ease-out) forwards;
  }
  .dialog-positioner[data-presentation='sheet'][data-placement='left'][data-closing]
    .dialog-content {
    animation: sheet-exit-left var(--duration-normal, 250ms) var(--ease-exit, ease-in) forwards;
  }
  .dialog-positioner[data-presentation='sheet'][data-placement='right'][open]:not([data-closing])
    .dialog-content {
    animation: sheet-enter-right var(--duration-normal, 250ms) var(--ease-enter, ease-out) forwards;
  }
  .dialog-positioner[data-presentation='sheet'][data-placement='right'][data-closing]
    .dialog-content {
    animation: sheet-exit-right var(--duration-normal, 250ms) var(--ease-exit, ease-in) forwards;
  }
  .dialog-positioner[data-presentation='sheet'][data-placement='bottom'][open]:not([data-closing])
    .dialog-content {
    animation: sheet-enter-bottom var(--duration-normal, 250ms) var(--ease-enter, ease-out) forwards;
  }
  .dialog-positioner[data-presentation='sheet'][data-placement='bottom'][data-closing]
    .dialog-content {
    animation: sheet-exit-bottom var(--duration-normal, 250ms) var(--ease-exit, ease-in) forwards;
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
  @keyframes dialog-exit {
    from {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    to {
      opacity: 0;
      transform: translateY(var(--space-2, 8px)) scale(0.98);
    }
  }
  @keyframes backdrop-fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes backdrop-fade-out {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }
  @keyframes sheet-enter-left {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(0);
    }
  }
  @keyframes sheet-exit-left {
    from {
      transform: translateX(0);
    }
    to {
      transform: translateX(-100%);
    }
  }
  @keyframes sheet-enter-right {
    from {
      transform: translateX(100%);
    }
    to {
      transform: translateX(0);
    }
  }
  @keyframes sheet-exit-right {
    from {
      transform: translateX(0);
    }
    to {
      transform: translateX(100%);
    }
  }
  @keyframes sheet-enter-bottom {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
  @keyframes sheet-exit-bottom {
    from {
      transform: translateY(0);
    }
    to {
      transform: translateY(100%);
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

  /* No local `prefers-reduced-motion` override: every animation above times
     off `--duration-normal`/`--ease-*`, which the design-tokens package
     itself zeroes under reduced motion, and app.css's sitewide near-zero
     animation-duration override (see the "Reduced motion" rule there) backs
     that up. Both keep the animations effectively instant without
     suppressing them outright — suppressing them would skip the
     `animationend` this component's exit path waits on to release the
     native dialog. */
</style>
