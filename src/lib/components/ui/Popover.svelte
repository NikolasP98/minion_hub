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
  }

  let {
    trigger,
    children,
    open = $bindable(undefined),
    placement = 'bottom',
    class: cls = '',
    bare = false,
  }: Props = $props();

  let nextId = 0;
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
  class="inline-flex items-center bg-transparent border-none p-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-[var(--radius-md)]"
>
  {@render trigger()}
</button>

<div {...api.getPositionerProps()} class="z-50">
  <div
    {...api.getContentProps()}
    class="outline-none {bare ? '' : 'surface-3 rounded-[var(--radius-md)] p-1'} {cls}"
  >
    {@render children()}
  </div>
</div>
