<script lang="ts">
    import * as m from '$lib/paraglide/messages';

    interface Props {
        model: string;
        systemPrompt: string;
    }

    let {
        model = $bindable(),
        systemPrompt = $bindable(),
    }: Props = $props();
</script>

<section class="editor-section">
    <h3 class="section-header">{m.builder_modelAndPrompt()}</h3>
    <div class="section-body">
        <div class="field-group">
            <label class="field-label" for="model-input">{m.agent_model()}</label>
            <input
                id="model-input"
                type="text"
                class="field-input"
                bind:value={model}
                placeholder={m.builder_modelPlaceholder()}
            />
        </div>

        <div class="field-group">
            <label class="field-label" for="system-prompt">{m.builder_systemPrompt()}</label>
            <p class="field-helper">{m.builder_systemPromptHelper()}</p>
            <textarea
                id="system-prompt"
                class="prompt-input"
                bind:value={systemPrompt}
                placeholder={m.builder_systemPromptPlaceholder()}
                rows="8"
            ></textarea>
        </div>
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

    .field-group {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .field-label {
        font-size: var(--font-size-caption);
        font-weight: 600;
        color: var(--color-foreground);
    }

    .field-helper {
        font-size: var(--font-size-caption);
        color: var(--color-muted);
        margin: 0;
        line-height: 1.4;
    }

    .field-input {
        width: 100%;
        font-size: var(--font-size-body);
        color: var(--color-foreground);
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: var(--space-2) var(--space-3);
        outline: none;
        font-family: inherit;
        transition: border-color var(--duration-fast) var(--ease-standard);
    }

    .field-input:focus {
        border-color: var(--color-accent);
    }

    .field-input::placeholder {
        color: var(--color-muted);
    }

    .prompt-input {
        width: 100%;
        font-size: var(--font-size-body);
        color: var(--color-foreground);
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: var(--space-2) var(--space-3);
        outline: none;
        resize: vertical;
        font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
        line-height: 1.6;
        transition: border-color var(--duration-fast) var(--ease-standard);
    }

    .prompt-input:focus {
        border-color: var(--color-accent);
    }

    .prompt-input::placeholder {
        color: var(--color-muted);
        font-family: inherit;
    }
</style>
