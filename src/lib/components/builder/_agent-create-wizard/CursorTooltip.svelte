<script lang="ts">
    interface PopoverData {
        emoji: string | null;
        name: string;
        desc: string;
        badge: string | null;
    }

    interface Props {
        visible: boolean;
        pos: { x: number; y: number };
        data: PopoverData | null;
    }

    let { visible, pos, data }: Props = $props();
</script>

{#if visible && data}
    <div
        class="cursor-tooltip"
        style="left: {pos.x}px; top: {pos.y}px;"
    >
        <div class="tooltip-inner">
            {#if data.emoji}
                <span class="tooltip-emoji">{data.emoji}</span>
            {/if}
            <span class="tooltip-name">{data.name}</span>
            {#if data.desc}
                <span class="tooltip-desc">{data.desc}</span>
            {/if}
            {#if data.badge}
                <span class="tooltip-badge">{data.badge}</span>
            {/if}
        </div>
    </div>
{/if}

<style>
    .cursor-tooltip {
        position: fixed;
        z-index: var(--layer-debug);
        transform: translate(12px, -50%);
        pointer-events: none;
        animation: tooltip-in 0.2s cubic-bezier(0.34, 1.4, 0.64, 1) forwards;
        transition: left var(--duration-instant) ease-out, top var(--duration-instant) ease-out;
    }

    @keyframes tooltip-in {
        from {
            opacity: 0;
            transform: translate(12px, -50%) scale(0.9) translateY(4px);
        }
        to {
            opacity: 1;
            transform: translate(12px, -50%) scale(1) translateY(0);
        }
    }

    .tooltip-inner {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-1);
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: var(--space-2) var(--space-3);
        box-shadow: var(--shadow-overlay);
        backdrop-filter: blur(12px);
        max-width: 220px;
        text-align: center;
    }

    .tooltip-emoji {
        font-size: var(--font-size-page-title);
        line-height: 1;
    }

    .tooltip-name {
        font-size: var(--font-size-caption);
        font-weight: 700;
        color: var(--color-foreground);
        line-height: 1.2;
    }

    .tooltip-desc {
        font-size: var(--font-size-telemetry);
        color: var(--color-muted);
        line-height: 1.3;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    .tooltip-badge {
        font-size: var(--font-size-telemetry);
        font-weight: 600;
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 15%, transparent);
        border-radius: var(--radius-xs);
        padding: 1px var(--space-1);
        margin-top: 1px;
    }
</style>
