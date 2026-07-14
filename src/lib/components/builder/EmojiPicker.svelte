<script lang="ts">
  import { Button } from '$lib/components/ui';
import * as m from '$lib/paraglide/messages';
    interface Props {
        value: string;
        onSelect: (emoji: string) => void;
        size?: 'sm' | 'md' | 'lg';
    }

    let { value, onSelect, size = 'lg' }: Props = $props();

    let open = $state(false);

    const emojis = [
        '📖', '📝', '🔍', '🧠', '⚡', '🛠️', '📊', '🎯',
        '🤖', '💬', '🔧', '🌐', '📡', '🔒', '🎨', '📦',
        '🧪', '💡', '🔗', '📋', '🏗️', '🔄', '📈', '🎮',
    ];

    function select(emoji: string) {
        onSelect(emoji);
        open = false;
    }
</script>

<div class="picker-wrap">
    <Button variant="ghost" type="button" class="picker-trigger {size}" onclick={() => { open = !open; }} title={m.emoji_changeIcon()}>
        <span class="picker-current">{value}</span>
    </Button>

    {#if open}
        <Button variant="ghost" type="button" class="picker-backdrop" aria-label={m.emoji_closePickerLabel()} onclick={() => { open = false; }}></Button>
        <div class="picker-dropdown">
            {#each emojis as emoji (emoji)}
                <Button variant="ghost"
                    type="button"
                    class="picker-item"
                    class:selected={emoji === value}
                    onclick={() => select(emoji)}
                >{emoji}</Button>
            {/each}
        </div>
    {/if}
</div>

<style>
    .picker-wrap {
        position: relative;
        display: inline-flex;
    }

    .picker-trigger {
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--radius-md);
        border: 2px dashed var(--color-border);
        background: var(--color-bg2);
        cursor: pointer;
        transition: all var(--duration-fast) var(--ease-standard);
    }

    .picker-trigger:hover {
        border-color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 6%, transparent);
    }

    .picker-trigger.sm {
        width: 2.25rem;
        height: 2.25rem;
        border-radius: var(--radius-md);
        border-width: 1.5px;
    }

    .picker-trigger.sm .picker-current {
        font-size: var(--font-size-page-title);
    }

    .picker-trigger.md {
        width: 2.75rem;
        height: 2.75rem;
    }

    .picker-trigger.md .picker-current {
        font-size: var(--font-size-display);
    }

    .picker-trigger.lg {
        width: 3.5rem;
        height: 3.5rem;
        border-radius: var(--radius-lg);
    }

    .picker-trigger.lg .picker-current {
        font-size: var(--font-size-display);
    }

    .picker-current {
        line-height: 1;
    }

    .picker-backdrop {
        position: fixed;
        inset: 0;
        z-index: var(--layer-debug);
        border: none;
        padding: 0;
        margin: 0;
        background: transparent;
        cursor: default;
    }

    .picker-dropdown {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        z-index: var(--layer-debug);
        display: grid;
        grid-template-columns: repeat(8, 1fr);
        gap: var(--space-0-5);
        padding: var(--space-2);
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-overlay);
    }

    .picker-item {
        width: 2.25rem;
        height: 2.25rem;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: var(--font-size-page-title);
        border-radius: var(--radius-md);
        border: 1.5px solid transparent;
        background: none;
        cursor: pointer;
        transition: all var(--duration-instant) var(--ease-standard);
    }

    .picker-item:hover {
        background: var(--color-bg3);
    }

    .picker-item.selected {
        border-color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    }
</style>
