<script lang="ts" module>
  // Module-level so each instance gets a distinct id — a per-instance counter
  // gave every popover "ui-popover-0", and Zag resolves trigger/content by DOM
  // id, so two popovers on one page anchored to each other's elements.
  let nextId = 0;
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as popover from '@zag-js/popover';
  import type { Placement as ZagPlacement } from '@zag-js/popover';
  import { useMachine, normalizeProps } from '@zag-js/svelte';
  import { portalInLayer } from './portal-in-layer';
  import { registerLayer } from './floating-layer.svelte';

  type Placement = 'top' | 'bottom' | 'left' | 'right' | 'bottom-end';

  interface Props {
    /** Trigger content (rendered inside the Zag-wired <button>). */
    trigger: Snippet;
    /** Floating panel content. */
    children: Snippet;
    /** Controlled open state (bindable). */
    open?: boolean;
    placement?: Placement;
    /** Passthrough class for the floating panel. */
    class?: string;
    /** Skip the default surface-3 styling — child brings its own panel. */
    bare?: boolean;
    disabled?: boolean;
    /** Opt in for wide dynamic panels that must shrink to the visual viewport. */
    viewportContained?: boolean;
    /** Accessible name for icon-only triggers (the inner snippet can't name the button). */
    label?: string;
  }

  let {
    trigger,
    children,
    open = $bindable(undefined),
    placement = 'bottom',
    class: cls = '',
    bare = false,
    disabled = false,
    viewportContained = false,
    label,
  }: Props = $props();

  const popoverId = `ui-popover-${nextId++}`;

  // When `open` is bound the machine runs controlled; otherwise it self-manages.
  const service = useMachine(popover.machine, () => ({
    id: popoverId,
    // Bare directions (existing behavior) default to `-start` alignment;
    // an already-aligned value (e.g. `bottom-end`) is passed through as-is.
    positioning: {
      placement: (placement.includes('-') ? placement : `${placement}-start`) as ZagPlacement,
      ...(viewportContained ? { strategy: 'fixed' as const, fitViewport: true } : {}),
    },
    open,
    onOpenChange({ open: next }: { open: boolean }) {
      if (open !== undefined) open = next;
    },
  }));
  const api = $derived(popover.connect(service, normalizeProps));

  // One floating layer at a time (see `floating-layer.svelte.ts`): registered
  // while OPEN, not while mounted — the positioner below is always in the DOM
  // and only `hidden` when closed.
  let positionerEl = $state<HTMLElement | null>(null);
  $effect(() => {
    if (!api.open || !positionerEl) return;
    return registerLayer(positionerEl);
  });
</script>

<button
  {...api.getTriggerProps()}
  aria-label={label}
  {disabled}
  class="inline-flex items-center bg-transparent border-none p-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-[var(--radius-md)]"
>
  {@render trigger()}
</button>

<!-- `use:portal` (same as Dropdown/Tooltip): moves the panel out of its host so
     clicks inside it do not bubble into the host, or into the host dialog (see
     `portal-in-layer.ts`). `popover="manual"` + `portalInLayer` show it in the
     browser top layer while open, above every z-index and outside every overflow
     clip. Consequence for callers: parent styles that reach the panel through an
     ancestor selector (`:global(.host .thing)`) do not match. Style the panel's
     own root/classes instead.

     Stays unconditionally mounted (never `{#if api.open}`): `ProfileMenu.test.ts`'s
     SSR assertions expect a closed popover's content in the server HTML, hidden
     only by the `hidden` attribute. -->
<div
  bind:this={positionerEl}
  popover="manual"
  use:portalInLayer={api.open}
  {...api.getPositionerProps()}
  class:viewport-contained={viewportContained}
  style:min-width={viewportContained ? '0' : undefined}
  style:max-width={viewportContained
    ? 'min(var(--available-width, calc(100dvw - var(--space-4))), calc(100dvw - var(--space-4)))'
    : undefined}
  style:max-height={viewportContained
    ? 'min(var(--available-height, calc(100dvh - var(--space-4))), calc(100dvh - var(--space-4)))'
    : undefined}
>
  <div
    {...api.getContentProps()}
    class:viewport-contained-content={viewportContained}
    class="outline-none {bare ? '' : 'surface-3 rounded-[var(--radius-md)] p-1'} {cls}"
  >
    {@render children()}
  </div>
</div>

<style>
  .viewport-contained-content {
    max-width: 100%;
    max-height: 100%;
    overflow: auto;
    overscroll-behavior: contain;
  }
</style>
