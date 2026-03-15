<script lang="ts">
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
    <button type="button" class="picker-trigger {size}" onclick={() => { open = !open; }} title="Change icon">
        <span class="picker-current">{value}</span>
    </button>

    {#if open}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="picker-backdrop" onclick={() => { open = false; }}></div>
        <div class="picker-dropdown">
            {#each emojis as emoji}
                <button
                    type="button"
                    class="picker-item"
                    class:selected={emoji === value}
                    onclick={() => select(emoji)}
                >{emoji}</button>
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
        border-radius: 0.5rem;
        border: 2px dashed var(--color-border);
        background: var(--color-bg2);
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .picker-trigger:hover {
        border-color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 6%, transparent);
    }

    .picker-trigger.sm {
        width: 2.25rem;
        height: 2.25rem;
        border-radius: 0.375rem;
        border-width: 1.5px;
    }

    .picker-trigger.sm .picker-current {
        font-size: 1.125rem;
    }

    .picker-trigger.md {
        width: 2.75rem;
        height: 2.75rem;
    }

    .picker-trigger.md .picker-current {
        font-size: 1.375rem;
    }

    .picker-trigger.lg {
        width: 3.5rem;
        height: 3.5rem;
        border-radius: 0.75rem;
    }

    .picker-trigger.lg .picker-current {
        font-size: 1.75rem;
    }

    .picker-current {
        line-height: 1;
    }

    .picker-backdrop {
        position: fixed;
        inset: 0;
        z-index: 99;
    }

    .picker-dropdown {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        z-index: 100;
        display: grid;
        grid-template-columns: repeat(8, 1fr);
        gap: 2px;
        padding: 6px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    }

    .picker-item {
        width: 2.25rem;
        height: 2.25rem;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.125rem;
        border-radius: 6px;
        border: 1.5px solid transparent;
        background: none;
        cursor: pointer;
        transition: all 0.1s ease;
    }

    .picker-item:hover {
        background: var(--color-bg3);
    }

    .picker-item.selected {
        border-color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    }
</style>
