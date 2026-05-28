<script lang="ts">
    import { ArrowLeft, Bot, Eye, Loader2, Check, Upload, Circle } from "lucide-svelte";
    import * as m from '$lib/paraglide/messages';

    interface Props {
        name: string;
        status: "draft" | "published";
        saving: boolean;
        dirty: boolean;
        publishing: boolean;
        onPublish: () => void;
    }

    let { name, status, saving, dirty, publishing, onPublish }: Props = $props();
</script>

<div class="editor-toolbar">
    <div class="flex items-center gap-3 min-w-0">
        <a href="/agents" class="back-link" title="Back to Agents">
            <ArrowLeft size={16} />
        </a>

        <div class="h-5 w-px bg-border/60 shrink-0"></div>

        <div class="flex items-center gap-2 min-w-0">
            <Bot size={16} class="text-accent shrink-0" />
            <span class="text-sm font-semibold text-foreground truncate">
                {name}
            </span>
            <span class="status-badge {status}">
                {status}
            </span>
        </div>
    </div>

    <div class="flex items-center gap-2">
        <span class="save-indicator" title={saving ? m.builder_saving() : dirty ? m.builder_unsavedChanges() : m.builder_allSaved()}>
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

        <div class="h-4 w-px bg-border/60"></div>

        <button type="button" class="toolbar-btn secondary" title={m.builder_preview()}>
            <Eye size={14} />
            <span class="hidden sm:inline">{m.builder_preview()}</span>
        </button>
        <button
            type="button"
            class="toolbar-btn {status === 'published' ? 'published' : 'primary'}"
            onclick={onPublish}
            disabled={publishing}
            title={status === 'published' ? m.builder_republishLatest() : m.builder_publishAgent()}
        >
            {#if publishing}
                <Loader2 size={14} class="loading-spinner" />
            {:else}
                <Upload size={14} />
            {/if}
            <span class="hidden sm:inline">{publishing ? m.builder_publishing() : status === 'published' ? m.builder_republish() : m.builder_publish()}</span>
        </button>
    </div>
</div>

<style>
    .editor-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 2.75rem;
        padding: 0 0.75rem;
        background: var(--color-bg2);
        border-bottom: 1px solid var(--color-border);
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
    }

    .back-link:hover {
        color: var(--color-foreground);
        background: var(--color-bg3);
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

    .toolbar-btn.secondary {
        color: var(--color-muted);
        background: transparent;
        border: 1px solid var(--color-border);
    }

    .toolbar-btn.secondary:hover {
        color: var(--color-foreground);
        background: var(--color-bg3);
    }

    .toolbar-btn.primary {
        color: white;
        background: var(--color-accent);
    }

    .toolbar-btn.primary:hover {
        filter: brightness(1.1);
    }

    .toolbar-btn.published {
        color: var(--color-success, #22c55e);
        background: color-mix(in srgb, var(--color-success, #22c55e) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-success, #22c55e) 25%, transparent);
    }

    .toolbar-btn.published:hover {
        background: color-mix(in srgb, var(--color-success, #22c55e) 20%, transparent);
    }

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
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
</style>
