<script lang="ts" module>
  export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';
</script>

<script lang="ts">
  import * as tooltip from '@zag-js/tooltip';
  import { normalizeProps, useMachine } from '@zag-js/svelte';
  import { portalInLayer } from './portal-in-layer';
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
    /**
     * Interactive content (buttons/links inside the panel). Keeps the panel open
     * while the pointer travels from the trigger into it — Zag's own hover-intent
     * — instead of closing the instant the trigger is left. Escape still closes
     * it and focus is never trapped.
     */
    interactive?: boolean;
    /** Skip the default label styling — the caller brings its own panel. */
    bare?: boolean;
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
    /**
     * Coarse pointers never hover, and Zag ignores touch pointer moves and
     * pointer-modality focus, so a label that must be reachable by TOUCH (a
     * truncated header, HC-023) opts in: a tap on the trigger toggles the
     * panel. Escape, blur and a tap elsewhere still close it.
     */
    tapToOpen?: boolean;
  }

  let {
    label,
    content,
    id,
    placement = 'top',
    openDelay = 200,
    closeDelay = 100,
    interactive = false,
    bare = false,
    disabled = false,
    children,
    asChild = false,
    tapToOpen = false,
  }: Props = $props();

  const fallbackId = $props.id();
  const tipId = $derived(id ?? `tooltip-${fallbackId}`);

  // Nothing to show when there's no content and no rich snippet.
  const hasTip = $derived(!disabled && (content != null || (label ?? '').length > 0));

  const service = useMachine(tooltip.machine, () => ({
    id: tipId,
    openDelay,
    closeDelay,
    // A plain label tooltip must NOT stay open when the pointer moves onto it:
    // combined with pointer-events:none below that prevents open/close flicker
    // near the cursor. `interactive` opts a rich panel out of both.
    interactive,
    // A tap toggles below; Zag's own pointerdown-close would otherwise fire
    // first and turn every second tap into close-then-open.
    closeOnPointerDown: !tapToOpen,
    positioning: {
      placement: placement as TooltipPlacement,
      strategy: 'fixed' as const,
    },
  }));
  const tip = $derived(tooltip.connect(service, normalizeProps));
  // A tap = touch pointerup followed by a click. Zag's own `onClick` closes
  // (`closeOnClick`), so the click is intercepted for TOUCH only: it toggles
  // instead; mouse and keyboard clicks keep Zag's behaviour.
  let lastPointerType = '';
  const triggerProps = $derived.by(() => {
    const props = tip.getTriggerProps() as Record<string, unknown>;
    if (!tapToOpen) return props;
    const zagClick = props.onclick as ((e: MouseEvent) => void) | undefined;
    return {
      ...props,
      onpointerup: (e: PointerEvent) => {
        lastPointerType = e.pointerType;
      },
      onclick: (e: MouseEvent) => {
        if (lastPointerType !== 'touch') return zagClick?.(e);
        lastPointerType = '';
        tip.setOpen(!tip.open);
      },
    };
  });

  // Disabling must CLOSE the machine, not just hide the trigger. A pointerdown
  // during the open delay does not cancel it (Zag only closes the tooltip that
  // is already the visible one), so a click that disables this tooltip — the
  // calendar fans a container out on click — leaves a timer that still fires
  // "open" against a trigger that no longer carries the tooltip's id. The
  // positioning effect then finds no anchor and gives up, and when the tooltip
  // is enabled again the panel renders at the viewport origin with no
  // coordinates (owner report 2026-09-26). Closing here resets the machine so
  // the next hover positions from scratch.
  $effect(() => {
    if (disabled && tip.open) tip.setOpen(false);
  });
</script>

{#if hasTip}
  {#if asChild}
    {@render children(triggerProps)}
  {:else}
    <span {...triggerProps}>
      {@render children()}
    </span>
  {/if}

  {#if tip.open}
    <!-- Portaled to <body>, like Dropdown: rendered inline, the panel is trapped
         in whatever stacking context its host creates (the sidebar's
         `z-[var(--layer-navigation)]` aside, a blurred sticky header, a
         transformed card), and NO z-index on the panel can lift it out — a raw
         9999 here still painted under the calendar's sticky gutter (owner
         report 2026-09-22). z-index is set by `portalInLayer` itself (not a
         `style:`/utility class here — see its doc comment: a Tailwind arbitrary
         layer utility computes to `auto`, and a `style:` directive on this same
         element would race the action's own z-index write). `--layer-modal`
         matches Dropdown/Popover; `portalInLayer` also bumps a NESTED panel a
         tier above its host so an interactive tooltip raised from inside a
         dialog OR another portaled panel still sits on top. -->
    <div
      use:portalInLayer
      {...tip.getPositionerProps()}
      class={interactive ? '' : 'pointer-events-none'}
    >
      <div
        {...tip.getContentProps()}
        class={bare
          ? ''
          : 'surface-3 rounded-[var(--radius-md)] px-2.5 py-1.5 text-xs text-foreground max-w-[280px] leading-relaxed'}
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
