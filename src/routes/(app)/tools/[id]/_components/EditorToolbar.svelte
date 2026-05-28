<script lang="ts">
    import {
        ArrowLeft,
        Wrench,
        Play,
        Upload,
        Loader2,
        Check,
        Circle,
        Power,
        PowerOff,
    } from "lucide-svelte";
    import type { ToolStatusEntry } from "$lib/types/tools";
    import * as m from '$lib/paraglide/messages';

    type Lang = "javascript" | "python" | "bash";
    type Status = "draft" | "published";

    interface Props {
        isAdmin: boolean;
        isGatewayTool: boolean;
        gatewayTool: ToolStatusEntry | null;
        name: string;
        status: Status;
        scriptLang: Lang;
        langOptions: Array<{ id: Lang; label: string }>;
        saving: boolean;
        dirty: boolean;
        running: boolean;
        publishing: boolean;
        onNameInput: () => void;
        onSwitchLanguage: (lang: Lang) => void;
        onRunTool: () => void;
        onPublishTool: () => void;
        onToggleGatewayToolEnabled: () => void;
    }

    let {
        isAdmin,
        isGatewayTool,
        gatewayTool,
        name = $bindable(),
        status,
        scriptLang,
        langOptions,
        saving,
        dirty,
        running,
        publishing,
        onNameInput,
        onSwitchLanguage,
        onRunTool,
        onPublishTool,
        onToggleGatewayToolEnabled,
    }: Props = $props();
</script>

<div class="editor-toolbar">
    <div class="toolbar-left">
        <a href="/tools" class="back-link" title="Back to Tools">
            <ArrowLeft size={16} />
        </a>

        <div class="toolbar-divider"></div>

        <div class="toolbar-identity">
            <Wrench size={16} class="tool-icon" />
            {#if isGatewayTool || !isAdmin}
                <span class="name-inline-ro">{name}</span>
            {:else}
                <input
                    type="text"
                    class="name-inline"
                    bind:value={name}
                    placeholder={m.builder_toolNamePlaceholder()}
                    oninput={onNameInput}
                />
            {/if}
            <span class="status-badge {status}">
                {status}
            </span>
            <span class="toolbar-source">{isGatewayTool ? m.builder_gatewaySource() : m.builder_customSource()}</span>
        </div>
    </div>

    <div class="toolbar-right">
        {#if isGatewayTool && gatewayTool}
            <!-- Gateway tool: enable/disable toggle (admin only) -->
            {#if isAdmin}
                <div class="toolbar-divider"></div>
                <button
                    type="button"
                    class="toolbar-btn {gatewayTool.enabled ? 'published' : 'run'}"
                    onclick={onToggleGatewayToolEnabled}
                    title={gatewayTool.enabled ? m.builder_disableTool() : m.builder_enableTool()}
                >
                    {#if gatewayTool.enabled}
                        <PowerOff size={14} />
                        <span class="hidden-sm">{m.builder_disable()}</span>
                    {:else}
                        <Power size={14} />
                        <span class="hidden-sm">{m.builder_enable()}</span>
                    {/if}
                </button>
            {/if}
        {:else}
            <!-- Custom builder tool: IDE toolbar -->
            {#if isAdmin}
                <!-- Language Selector -->
                <div class="lang-selector">
                    {#each langOptions as lang (lang.id)}
                        <button
                            type="button"
                            class="lang-pill"
                            class:active={scriptLang === lang.id}
                            onclick={() => onSwitchLanguage(lang.id)}
                        >
                            {lang.label}
                        </button>
                    {/each}
                </div>

                <div class="toolbar-divider"></div>

                <!-- Run Button -->
                <button
                    type="button"
                    class="toolbar-btn run"
                    onclick={onRunTool}
                    disabled={running}
                    title={m.builder_runScript()}
                >
                    {#if running}
                        <Loader2 size={14} class="loading-spinner" />
                    {:else}
                        <Play size={14} />
                    {/if}
                    <span class="hidden-sm">{m.builder_run()}</span>
                </button>

                <div class="toolbar-divider"></div>

                <!-- Save Indicator -->
                <span
                    class="save-indicator"
                    title={saving ? m.builder_saving() : dirty ? m.builder_unsavedChanges() : m.builder_allSaved()}
                >
                    {#if saving}
                        <Loader2 size={12} class="loading-spinner" />
                        <span>{m.builder_saving()}</span>
                    {:else if dirty}
                        <Circle size={8} class="dirty-dot" />
                        <span>{m.builder_unsaved()}</span>
                    {:else}
                        <Check size={12} class="saved-check" />
                        <span>{m.builder_saved()}</span>
                    {/if}
                </span>

                <!-- Publish Button -->
                <button
                    type="button"
                    class="toolbar-btn {status === 'published' ? 'published' : 'primary'}"
                    onclick={onPublishTool}
                    disabled={publishing}
                    title={status === "published"
                        ? m.builder_republishLatest()
                        : m.builder_publishTool()}
                >
                    {#if publishing}
                        <Loader2 size={14} class="loading-spinner" />
                    {:else}
                        <Upload size={14} />
                    {/if}
                    <span class="hidden-sm"
                        >{publishing
                            ? m.builder_publishing()
                            : status === "published"
                                ? m.builder_republish()
                                : m.builder_publish()}</span
                    >
                </button>
            {:else}
                <span class="toolbar-source">{scriptLang}</span>
            {/if}
        {/if}
    </div>
</div>

<style>
    /* ── Editor Toolbar ──────────────────────────────────────────────── */
    .editor-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 2.75rem;
        padding: 0 0.75rem;
        background: var(--color-bg2);
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
        gap: 0.5rem;
    }

    .toolbar-left {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        min-width: 0;
    }

    .toolbar-right {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-shrink: 0;
    }

    .toolbar-divider {
        width: 1px;
        height: 1.25rem;
        background: var(--color-border);
        opacity: 0.6;
        flex-shrink: 0;
    }

    .back-link {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        border-radius: 0.375rem;
        color: var(--color-muted);
        transition: all 0.15s ease;
        flex-shrink: 0;
    }

    .back-link:hover {
        color: var(--color-foreground);
        background: var(--color-bg3);
    }

    .toolbar-identity {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        min-width: 0;
    }

    :global(.tool-icon) {
        color: var(--color-accent);
        flex-shrink: 0;
    }

    .name-inline {
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--color-foreground);
        background: transparent;
        border: none;
        border-bottom: 1px solid transparent;
        padding: 0.125rem 0;
        outline: none;
        font-family: inherit;
        min-width: 6rem;
        max-width: 16rem;
        transition: border-color 0.15s ease;
    }

    .name-inline:focus {
        border-bottom-color: var(--color-accent);
    }

    .name-inline::placeholder {
        color: var(--color-muted);
    }

    .name-inline-ro {
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--color-foreground);
        padding: 0.125rem 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 16rem;
    }

    .status-badge {
        display: inline-flex;
        align-items: center;
        padding: 0.125rem 0.5rem;
        border-radius: 9999px;
        font-size: 0.625rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        flex-shrink: 0;
    }

    .status-badge.draft {
        color: var(--color-warning);
        background: color-mix(in srgb, var(--color-warning) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-warning) 25%, transparent);
    }

    .status-badge.published {
        color: var(--color-success);
        background: color-mix(in srgb, var(--color-success) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-success) 25%, transparent);
    }

    /* ── Language Selector ────────────────────────────────────────────── */
    .lang-selector {
        display: flex;
        align-items: center;
        gap: 0.125rem;
        padding: 0.125rem;
        border-radius: 0.375rem;
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
    }

    .lang-pill {
        display: flex;
        align-items: center;
        padding: 0.1875rem 0.5rem;
        border-radius: 0.25rem;
        font-size: 0.6875rem;
        font-weight: 500;
        color: var(--color-muted);
        background: transparent;
        border: none;
        cursor: pointer;
        transition: all 0.15s ease;
        font-family: inherit;
        white-space: nowrap;
    }

    .lang-pill:hover {
        color: var(--color-foreground);
    }

    .lang-pill.active {
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 15%, transparent);
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 30%, transparent);
    }

    /* ── Toolbar Buttons ─────────────────────────────────────────────── */
    .toolbar-btn {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.375rem 0.625rem;
        border-radius: 0.375rem;
        font-size: 0.75rem;
        font-weight: 500;
        border: none;
        cursor: pointer;
        transition: all 0.15s ease;
        font-family: inherit;
    }

    .toolbar-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .toolbar-btn.run {
        color: var(--color-bg);
        background: var(--color-accent);
    }

    .toolbar-btn.run:hover:not(:disabled) {
        filter: brightness(1.15);
    }

    .toolbar-btn.primary {
        color: white;
        background: var(--color-accent);
    }

    .toolbar-btn.primary:hover:not(:disabled) {
        filter: brightness(1.1);
    }

    .toolbar-btn.published {
        color: var(--color-success);
        background: color-mix(in srgb, var(--color-success) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-success) 25%, transparent);
    }

    .toolbar-btn.published:hover:not(:disabled) {
        background: color-mix(in srgb, var(--color-success) 20%, transparent);
    }

    /* ── Save Indicator ──────────────────────────────────────────────── */
    .save-indicator {
        display: flex;
        align-items: center;
        gap: 0.3125rem;
        font-size: 0.6875rem;
        color: var(--color-muted);
        white-space: nowrap;
        padding: 0.25rem 0.5rem;
        border-radius: 0.375rem;
        user-select: none;
    }

    :global(.loading-spinner) {
        color: var(--color-muted);
        animation: spin 1s linear infinite;
    }

    :global(.dirty-dot) {
        color: var(--color-warning, #f59e0b);
        fill: var(--color-warning, #f59e0b);
    }

    :global(.saved-check) {
        color: var(--color-success, #22c55e);
    }

    @keyframes spin {
        from {
            transform: rotate(0deg);
        }
        to {
            transform: rotate(360deg);
        }
    }

    /* ── Hidden on small screens ──────────────────────────────────────── */
    .hidden-sm {
        display: none;
    }

    @media (min-width: 640px) {
        .hidden-sm {
            display: inline;
        }
    }

    /* ── Toolbar Source Label ──────────────────────────────────────── */
    .toolbar-source {
        font-size: 0.625rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-muted);
        background: var(--color-bg3);
        padding: 0.1875rem 0.5rem;
        border-radius: 0.25rem;
        border: 1px solid var(--color-border);
        font-family: var(--font-mono, monospace);
    }
</style>
