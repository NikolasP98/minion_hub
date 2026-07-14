<script lang="ts">
  import type { Snippet } from 'svelte';
  import Dialog from './Dialog.svelte';
  import type {
    DialogCloseReason,
    DialogSize,
    DialogVariant,
    SheetPlacement,
  } from './Dialog.svelte';

  interface Props {
    open?: boolean;
    title?: string;
    labelledBy?: string;
    description?: string;
    describedBy?: string;
    placement?: SheetPlacement;
    size?: DialogSize;
    variant?: DialogVariant;
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
    placement = 'right',
    size = 'md',
    variant = 'default',
    dismissible = true,
    hideClose = false,
    initialFocus,
    onclose,
    header,
    children,
    footer,
    class: cls = '',
  }: Props = $props();
</script>

<Dialog
  bind:open
  {title}
  {labelledBy}
  {description}
  {describedBy}
  {size}
  {variant}
  presentation="sheet"
  {placement}
  {dismissible}
  {hideClose}
  {initialFocus}
  {onclose}
  {header}
  {children}
  {footer}
  class={cls}
/>
