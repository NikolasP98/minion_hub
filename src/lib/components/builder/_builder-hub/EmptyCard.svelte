<script lang="ts">
    import { type Icon as IconType } from "lucide-svelte";
    import * as m from '$lib/paraglide/messages';

    interface Props {
        icon: typeof IconType;
        title: string;
        description: string;
        locked: boolean;
        onClick: () => void;
    }

    let { icon: Icon, title, description, locked, onClick }: Props = $props();
</script>

<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
    <button
        type="button"
        class="empty-card"
        disabled={locked}
        onclick={locked ? undefined : onClick}
    >
        <div class="empty-card-inner">
            <Icon size={28} class="empty-icon" />
            <p class="empty-title">{title}</p>
            <p class="empty-desc">{description}</p>
            {#if !locked}
                <span class="empty-cta">+ {m.builder_create()}</span>
            {/if}
        </div>
    </button>
</div>

<style>
    .empty-card {
        display: flex;
        align-items: stretch;
        min-height: 10rem;
        border: 2px dashed var(--color-border);
        border-radius: 0.75rem;
        background: transparent;
        cursor: pointer;
        transition: all var(--duration-normal) var(--ease-standard);
        padding: 0;
        font-family: inherit;
        width: 100%;
        color: inherit;
    }

    .empty-card:hover:not(:disabled) {
        border-color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 4%, transparent);
    }

    .empty-card:disabled {
        cursor: not-allowed;
        opacity: 0.6;
    }

    .empty-card-inner {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        padding: 1.5rem;
        gap: 0.5rem;
    }

    :global(.empty-icon) {
        color: var(--color-muted);
        opacity: 0.5;
        margin-bottom: 0.25rem;
    }

    .empty-title {
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--color-foreground);
        margin: 0;
    }

    .empty-desc {
        font-size: 0.6875rem;
        color: var(--color-muted);
        text-align: center;
        line-height: 1.4;
        max-width: 18rem;
        margin: 0;
    }

    .empty-cta {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        margin-top: 0.5rem;
        font-size: 0.6875rem;
        font-weight: 600;
        color: var(--color-accent);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
</style>
