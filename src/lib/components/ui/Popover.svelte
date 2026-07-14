<script lang="ts" module>
  // Module-level so each instance gets a distinct id — a per-instance counter
  // gave every popover "ui-popover-0", and Zag resolves trigger/content by DOM
  // id, so two popovers on one page anchored to each other's elements.
  let nextId = 0;
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as popover from '@zag-js/popover';
  import { useMachine, normalizeProps } from '@zag-js/svelte';

  type Placement = 'top' | 'bottom' | 'left' | 'right';

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
  }

  let {
    trigger,
    children,
    open = $bindable(undefined),
    placement = 'bottom',
    class: cls = '',
    bare = false,
    disabled = false,
  }: Props = $props();

  const popoverId = `ui-popover-${nextId++}`;

  // When `open` is bound the machine runs controlled; otherwise it self-manages.
  const service = useMachine(popover.machine, () => ({
    id: popoverId,
    positioning: { placement: `${placement}-start` as const },
    open,
    onOpenChange({ open: next }: { open: boolean }) {
      if (open !== undefined) open = next;
    },
  }));
  const api = $derived(popover.connect(service, normalizeProps));
</script>

<button
  {...api.getTriggerProps()}
  {disabled}
  class="inline-flex items-center bg-transparent border-none p-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-[var(--radius-md)]"
>
  {@render trigger()}
</button>

<!-- The positioner's stacking level comes from the CONTENT's z-index: Zag
     imperatively sets the positioner's `--z-index` to
     getComputedStyle(contentEl).zIndex while positioning (get-placement.mjs),
     overwriting anything set on the positioner itself — so z-[var(--layer-modal)] lives on the
     content div below, NOT here. -->
<div {...api.getPositionerProps()}>
  <div
    {...api.getContentProps()}
    class="outline-none z-[var(--layer-modal)] {bare
      ? ''
      : 'surface-3 rounded-[var(--radius-md)] p-1'} {cls}"
  >
    {@render children()}
  </div>
</div>
