<script lang="ts">
    import * as tooltip from "@zag-js/tooltip";
    import { normalizeProps, useMachine } from "@zag-js/svelte";
    import type { Snippet } from "svelte";

    let {
        label,
        id,
        placement = "bottom",
        children,
    }: {
        label: string;
        id: string;
        placement?: "top" | "bottom" | "left" | "right";
        children: Snippet<[Record<string, unknown>]>;
    } = $props();

    const service = useMachine(tooltip.machine, () => ({
        id,
        openDelay: 0,
        closeDelay: 0,
        positioning: {
            placement: placement as "top" | "bottom" | "left" | "right",
            strategy: "fixed" as const,
        },
    }));
    const tip = $derived(tooltip.connect(service, normalizeProps));
</script>

{@render children(tip.getTriggerProps() as Record<string, unknown>)}

{#if tip.open}
    <div {...tip.getPositionerProps()} class="!z-[9999]">
        <div
            {...tip.getContentProps()}
            class="bg-bg2 border border-border rounded px-2.5 py-1.5 shadow-lg whitespace-nowrap"
        >
            <div class="text-xs text-foreground">{label}</div>
        </div>
    </div>
{/if}
