<script lang="ts" module>
  export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';
</script>

<script lang="ts">
  import * as tooltip from '@zag-js/tooltip';
  import { normalizeProps, useMachine } from '@zag-js/svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    /** Simple string content (the common path). */
    label?: string;
    /** Rich tooltip content (inline `{#snippet content()}`). Wins over `label`. */
    content?: Snippet;
    /** Stable id for the machine. Falls back to a generated one. */
    id?: string;
    placement?: TooltipPlacement;
    openDelay?: number;
    closeDelay?: number;
    /** When true, render the trigger plainly — no hover tooltip. */
    disabled?: boolean;
    /**
     * Trigger. By default the trigger is wrapped in a `<span>` that carries the
     * Zag trigger props — ergonomic for inline help icons. Pass `asChild` to
     * skip the wrapper and receive the trigger props as the snippet argument,
     * spreading them onto your own focusable element (needed when the trigger is
     * a flex/grid item, e.g. nav rows, so layout isn't disturbed).
     */
    children: Snippet<[Record<string, unknown>?]>;
    /** Spread trigger props onto your own element instead of a wrapper span. */
    asChild?: boolean;
  }

  let {
    label,
    content,
    id,
    placement = 'top',
    openDelay = 200,
    closeDelay = 100,
    disabled = false,
    children,
    asChild = false,
  }: Props = $props();

  const fallbackId = $props.id();
  const tipId = $derived(id ?? `tooltip-${fallbackId}`);

  // Nothing to show when there's no content and no rich snippet.
  const hasTip = $derived(!disabled && (content != null || (label ?? '').length > 0));

  const service = useMachine(tooltip.machine, () => ({
    id: tipId,
    openDelay,
    closeDelay,
    // Non-interactive label tooltip: don't keep it open when the pointer moves
    // onto the content. Combined with pointer-events:none on the content, this
    // prevents open/close flicker near the cursor over an interactive trigger.
    interactive: false,
    positioning: {
      placement: placement as TooltipPlacement,
      strategy: 'fixed' as const,
    },
  }));
  const tip = $derived(tooltip.connect(service, normalizeProps));
</script>

{#if hasTip}
  {#if asChild}
    {@render children(tip.getTriggerProps() as Record<string, unknown>)}
  {:else}
    <span {...tip.getTriggerProps() as Record<string, unknown>}>
      {@render children()}
    </span>
  {/if}

  {#if tip.open}
    <div {...tip.getPositionerProps()} class="!z-[9999] pointer-events-none">
      <div
        {...tip.getContentProps()}
        class="surface-3 rounded-[var(--radius-md)] px-2.5 py-1.5 text-xs text-foreground max-w-[280px] leading-relaxed"
      >
        {#if content}
          {@render content()}
        {:else}
          {label}
        {/if}
      </div>
    </div>
  {/if}
{:else if asChild}
  {@render children({})}
{:else}
  {@render children()}
{/if}
