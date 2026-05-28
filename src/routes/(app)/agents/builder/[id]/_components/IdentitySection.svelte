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
        border-radius: 0.75rem;
        overflow: hidden;
    }

    .section-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1rem;
        margin: 0;
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-muted);
        border-bottom: 1px solid var(--color-border);
    }

    .section-body {
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .name-input {
        width: 100%;
        font-size: 1.25rem;
        font-weight: 700;
        color: var(--color-foreground);
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        padding: 0.25rem 0;
        outline: none;
        font-family: inherit;
        transition: border-color 0.15s ease;
    }

    .name-input:focus {
        border-bottom-color: var(--color-accent);
    }

    .name-input::placeholder {
        color: var(--color-muted);
    }

    .desc-input {
        width: 100%;
        font-size: 0.8125rem;
        color: var(--color-foreground);
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
        border-radius: 0.5rem;
        padding: 0.625rem 0.75rem;
        outline: none;
        resize: vertical;
        font-family: inherit;
        line-height: 1.5;
        transition: border-color 0.15s ease;
    }

    .desc-input:focus {
        border-color: var(--color-accent);
    }

    .desc-input::placeholder {
        color: var(--color-muted);
    }
</style>
