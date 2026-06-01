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
        z-index: 9999;
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
        gap: 3px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        padding: 8px 12px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(12px);
        max-width: 220px;
        text-align: center;
    }

    .tooltip-emoji {
        font-size: 18px;
        line-height: 1;
    }

    .tooltip-name {
        font-size: 12px;
        font-weight: 700;
        color: var(--color-foreground);
        line-height: 1.2;
    }

    .tooltip-desc {
        font-size: 10px;
        color: var(--color-muted);
        line-height: 1.3;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    .tooltip-badge {
        font-size: 9px;
        font-weight: 600;
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 15%, transparent);
        border-radius: 3px;
        padding: 1px 5px;
        margin-top: 1px;
    }
</style>
