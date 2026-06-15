<script lang="ts">
    import * as tooltip from "@zag-js/tooltip";
    import { normalizeProps, useMachine } from "@zag-js/svelte";
    import type { Snippet } from "svelte";

    let {
        label,
        id,
        placement = "bottom",
        disabled = false,
        openDelay = 0,
        children,
    }: {
        label: string;
        id: string;
        placement?: "top" | "bottom" | "left" | "right";
        /** When true, render the trigger plainly — no hover tooltip. */
        disabled?: boolean;
        openDelay?: number;
        children: Snippet<[Record<string, unknown>]>;
    } = $props();

    const service = useMachine(tooltip.machine, () => ({
        id,
        openDelay,
        closeDelay: 0,
        // Non-interactive label tooltip: don't keep it open when the pointer
        // moves onto the content. Combined with pointer-events:none on the
        // content (below), this prevents the open/close flicker that happens
        // when the tooltip renders near the cursor over an interactive trigger.
        interactive: false,
        positioning: {
            placement: placement as "top" | "bottom" | "left" | "right",
            strategy: "fixed" as const,
        },
    }));
    const tip = $derived(tooltip.connect(service, normalizeProps));
</script>

{#if disabled}
    {@render children({})}
{:else}
    {@render children(tip.getTriggerProps() as Record<string, unknown>)}
{/if}

{#if !disabled && tip.open}
    <div {...tip.getPositionerProps()} class="!z-[9999] pointer-events-none">
        <div
            {...tip.getContentProps()}
            class="bg-bg2 border border-border rounded px-2.5 py-1.5 shadow-lg whitespace-nowrap"
        >
            <div class="text-xs text-foreground">{label}</div>
        </div>
    </div>
{/if}
