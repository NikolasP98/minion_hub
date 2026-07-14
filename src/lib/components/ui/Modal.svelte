<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { DialogSize } from './foundations/Dialog.svelte';

  /** @deprecated Import `DialogSize` from `$lib/components/ui/foundations`. */
  export type ModalSize = DialogSize;

  /**
   * @deprecated Import `Dialog`, `ConfirmDialog`, or `Sheet` from
   * `$lib/components/ui/foundations` for new surfaces.
   */
  export interface ModalProps {
    open?: boolean;
    title: string;
    size?: ModalSize;
    dismissible?: boolean;
    hideClose?: boolean;
    onclose?: () => void;
    header?: Snippet;
    children?: Snippet;
    footer?: Snippet;
  }
</script>

<script lang="ts">
  import Dialog from './foundations/Dialog.svelte';
  import type { DialogCloseReason } from './foundations/Dialog.svelte';

  const generatedId = $props.id();

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
  }: ModalProps = $props();

  const headerId = `modal-${generatedId}-header`;

  function handleClose(_reason: DialogCloseReason) {
    onclose?.();
  }
</script>

{#snippet compatibilityHeader()}
  {#if header}
    <div id={headerId}>{@render header()}</div>
  {/if}
{/snippet}

<Dialog
  bind:open
  title={header ? undefined : title}
  labelledBy={header ? headerId : undefined}
  {size}
  {dismissible}
  {hideClose}
  onclose={handleClose}
  header={header ? compatibilityHeader : undefined}
  {children}
  {footer}
/>
