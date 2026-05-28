<script lang="ts">
    import EmojiPicker from "../EmojiPicker.svelte";
    import Combobox from "$lib/components/ui/Combobox.svelte";
    import * as m from '$lib/paraglide/messages';

    type ModelItem = { id: string; name: string };

    interface Props {
        name: string;
        emoji: string;
        model: string;
        modelItems: ModelItem[];
        defaultModel: string;
        contentProps: Record<string, any>;
    }

    let {
        name = $bindable(),
        emoji = $bindable(),
        model = $bindable(),
        modelItems,
        defaultModel,
        contentProps,
    }: Props = $props();
</script>

<div {...contentProps}>
    <div class="field">
        <label class="field-label" for="agent-name">
            {m.agent_name()} <span class="required">*</span>
        </label>
        <div class="name-row">
            <EmojiPicker value={emoji} onSelect={(e) => { emoji = e; }} size="md" />
            <input
                id="agent-name"
                class="field-input name-field"
                type="text"
                bind:value={name}
                placeholder={m.builder_agentNamePlaceholder()}
                required
            />
        </div>
        {#if name.length > 0 && name.trim().length < 3}
            <span class="field-error">{m.builder_nameTooShort()}</span>
        {/if}
    </div>

    <div class="field">
        <Combobox
            id="wizard-model"
            items={modelItems}
            itemToValue={(m) => m.id}
            itemToString={(m) => m.name}
            bind:value={model}
            label="Model"
            placeholder={m.builder_searchModels()}
        >
            {#snippet item({ item: mi, selected, itemTextProps })}
                <span
                    class="model-item-name"
                    class:model-item-selected={selected}
                    {...itemTextProps}
                >{mi.name}</span>
                {#if mi.id === defaultModel}
                    <span class="model-badge">{m.builder_modelDefault()}</span>
                {/if}
                <span class="model-item-id">{mi.id}</span>
            {/snippet}
        </Combobox>
    </div>
</div>

<style>
    .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 16px;
    }
    .field:last-child {
        margin-bottom: 0;
    }

    .field-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--color-foreground);
    }

    .required {
        color: var(--color-accent);
    }

    .field-error {
        font-size: 11px;
        color: var(--color-destructive, #ef4444);
    }

    .field-input {
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-foreground);
        font-family: inherit;
        font-size: 13px;
        padding: 8px 10px;
        outline: none;
        transition:
            border-color 0.15s,
            box-shadow 0.15s;
    }
    .field-input:focus {
        border-color: var(--color-accent);
        box-shadow: 0 0 0 2px
            color-mix(in srgb, var(--color-accent) 20%, transparent);
    }
    .field-input::placeholder {
        color: var(--color-muted);
    }

    .name-row {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .name-field {
        flex: 1;
    }

    .model-item-name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--color-foreground);
    }
    .model-item-selected {
        color: var(--color-accent);
        font-weight: 600;
    }

    .model-badge {
        font-size: 10px;
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 15%, transparent);
        border-radius: 3px;
        padding: 1px 5px;
        flex-shrink: 0;
    }

    .model-item-id {
        color: var(--color-muted);
        font-size: 11px;
        font-family: "JetBrains Mono", "Fira Code", monospace;
        flex-shrink: 0;
    }
</style>
