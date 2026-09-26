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
    // Bare directions (existing behavior) default to `-start` alignment;
    // an already-aligned value (e.g. `bottom-end`) is passed through as-is.
    positioning: {
      placement: (placement.includes('-') ? placement : `${placement}-start`) as ZagPlacement,
    },
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
     content div below, NOT here.

     `use:portal` (same as Dropdown/Tooltip): a layer token only orders siblings
     INSIDE the nearest stacking context, so an inline panel is capped by its
     host however high its z-index. On /pos/sell that host is `.catalog`
     (`isolation: isolate`, and on mobile a sticky `.catalog-head` at
     --layer-navigation): the panel painted UNDER the next grid column's
     buttons (the shared Button base is `relative`) and under the sidebar
     (Sidebar.svelte `z-[var(--layer-navigation)]`) once Zag's shift() pushed it
     left. At <body> the content's own layer finally applies.
     Consequence for callers: parent styles that reach the panel through an
     ancestor selector (`:global(.host .thing)`) no longer match — style the
     panel's own root/classes instead. -->
<div use:portalInLayer {...api.getPositionerProps()}>
  <div
    {...api.getContentProps()}
    class="outline-none z-[var(--layer-modal)] {bare
      ? ''
      : 'surface-3 rounded-[var(--radius-md)] p-1'} {cls}"
  >
    {@render children()}
  </div>
</div>
