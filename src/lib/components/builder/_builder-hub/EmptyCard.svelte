<script lang="ts">
  import { Button } from '$lib/components/ui';
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
    <Button variant="ghost"
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
    </Button>
</div>

<style>
    .empty-card {
        display: flex;
        align-items: stretch;
        min-height: 10rem;
        border: 2px dashed var(--color-border);
        border-radius: var(--radius-lg);
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
        padding: var(--space-6);
        gap: var(--space-2);
    }

    :global(.empty-icon) {
        color: var(--color-muted);
        opacity: 0.5;
        margin-bottom: var(--space-1);
    }

    .empty-title {
        font-size: var(--font-size-body);
        font-weight: 600;
        color: var(--color-foreground);
        margin: 0;
    }

    .empty-desc {
        font-size: var(--font-size-caption);
        color: var(--color-muted);
        text-align: center;
        line-height: 1.4;
        max-width: 18rem;
        margin: 0;
    }

    .empty-cta {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        margin-top: var(--space-2);
        font-size: var(--font-size-caption);
        font-weight: 600;
        color: var(--color-accent);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
</style>
