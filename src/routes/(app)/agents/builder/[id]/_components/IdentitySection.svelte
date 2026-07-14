<script lang="ts">
    import EmojiPicker from "$lib/components/builder/EmojiPicker.svelte";
    import * as m from '$lib/paraglide/messages';

    interface Props {
        emoji: string;
        name: string;
        description: string;
    }

    let {
        emoji = $bindable(),
        name = $bindable(),
        description = $bindable(),
    }: Props = $props();
</script>

<section class="editor-section">
    <h3 class="section-header">{m.builder_stepIdentity()}</h3>
    <div class="section-body">
        <EmojiPicker value={emoji} onSelect={(e) => { emoji = e; }} />

        <input
            type="text"
            class="name-input"
            bind:value={name}
            placeholder={m.builder_agentNamePlaceholder()}
        />

        <textarea
            class="desc-input"
            bind:value={description}
            placeholder={m.builder_agentDescPlaceholder()}
            rows="3"
        ></textarea>
    </div>
</section>

<style>
    .editor-section {
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        overflow: hidden;
    }

    .section-header {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-3) var(--space-4);
        margin: 0;
        font-size: var(--font-size-caption);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-muted);
        border-bottom: 1px solid var(--color-border);
    }

    .section-body {
        padding: var(--space-4);
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
    }

    .name-input {
        width: 100%;
        font-size: var(--font-size-page-title);
        font-weight: 700;
        color: var(--color-foreground);
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        padding: var(--space-1) 0;
        outline: none;
        font-family: inherit;
        transition: border-color var(--duration-fast) var(--ease-standard);
    }

    .name-input:focus {
        border-bottom-color: var(--color-accent);
    }

    .name-input::placeholder {
        color: var(--color-muted);
    }

    .desc-input {
        width: 100%;
        font-size: var(--font-size-body);
        color: var(--color-foreground);
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: var(--space-2) var(--space-3);
        outline: none;
        resize: vertical;
        font-family: inherit;
        line-height: 1.5;
        transition: border-color var(--duration-fast) var(--ease-standard);
    }

    .desc-input:focus {
        border-color: var(--color-accent);
    }

    .desc-input::placeholder {
        color: var(--color-muted);
    }
</style>
