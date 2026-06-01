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

    .field-group {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
    }

    .field-label {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--color-foreground);
    }

    .field-helper {
        font-size: 0.6875rem;
        color: var(--color-muted);
        margin: 0;
        line-height: 1.4;
    }

    .field-input {
        width: 100%;
        font-size: 0.8125rem;
        color: var(--color-foreground);
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
        border-radius: 0.5rem;
        padding: 0.5rem 0.75rem;
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
        font-size: 0.8125rem;
        color: var(--color-foreground);
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
        border-radius: 0.5rem;
        padding: 0.625rem 0.75rem;
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
