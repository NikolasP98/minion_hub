<script lang="ts">
    import * as m from '$lib/paraglide/messages';

    interface Props {
        temperature: number;
        maxTokens: number;
        retryCount: number;
        fallbackAgentId: string;
    }

    let {
        temperature = $bindable(),
        maxTokens = $bindable(),
        retryCount = $bindable(),
        fallbackAgentId = $bindable(),
    }: Props = $props();
</script>

<section class="editor-section">
    <h3 class="section-header">{m.builder_behavior()}</h3>
    <div class="section-body">
        <div class="field-group">
            <label class="field-label" for="temperature-input">{m.builder_temperature()}</label>
            <div class="range-row">
                <input
                    id="temperature-input"
                    type="range"
                    class="range-input"
                    bind:value={temperature}
                    min="0"
                    max="1"
                    step="0.1"
                />
                <span class="range-value">{temperature.toFixed(1)}</span>
            </div>
        </div>

        <div class="field-group">
            <label class="field-label" for="max-tokens-input">{m.builder_maxTokens()}</label>
            <input
                id="max-tokens-input"
                type="number"
                class="field-input"
                bind:value={maxTokens}
                min="1"
                max="200000"
                step="256"
            />
        </div>

        <div class="field-group">
            <label class="field-label" for="retry-input">{m.builder_retryCount()}</label>
            <input
                id="retry-input"
                type="number"
                class="field-input"
                bind:value={retryCount}
                min="0"
                max="10"
            />
        </div>

        <div class="field-group">
            <label class="field-label" for="fallback-input">{m.builder_fallbackAgent()}</label>
            <input
                id="fallback-input"
                type="text"
                class="field-input"
                bind:value={fallbackAgentId}
                placeholder={m.builder_fallbackAgentPlaceholder()}
            />
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

    .range-row {
        display: flex;
        align-items: center;
        gap: var(--space-3);
    }

    .range-input {
        flex: 1;
        height: 4px;
        accent-color: var(--color-accent);
        cursor: pointer;
    }

    .range-value {
        font-size: var(--font-size-body);
        font-weight: 600;
        color: var(--color-foreground);
        min-width: 2rem;
        text-align: right;
        font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    }
</style>
