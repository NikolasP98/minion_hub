<script lang="ts">
  import { Button } from '$lib/components/ui';
import { autosize } from '$lib/actions/autosize';
    import { X, Loader2, BookOpen } from "lucide-svelte";
    import * as m from '$lib/paraglide/messages';
    import EmojiPicker from "./EmojiPicker.svelte";

    interface Props {
        onComplete: (id: string) => void;
        onClose: () => void;
    }

    let { onComplete, onClose }: Props = $props();

    let name = $state("");
    let description = $state("");
    let emoji = $state("📖");
    let creating = $state(false);
    let error = $state<string | null>(null);

    const canCreate = $derived(name.trim().length >= 2);

    async function handleCreate() {
        if (!canCreate || creating) return;
        creating = true;
        error = null;
        try {
            const res = await fetch("/api/builder/skills", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: name.trim(), description: description.trim(), emoji }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            onComplete(data.id);
        } catch (e) {
            error = e instanceof Error ? e.message : m.builder_failedCreateSkill();
            creating = false;
        }
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") onClose();
        if (e.key === "Enter" && canCreate && !creating) handleCreate();
    }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
    class="overlay"
    role="dialog"
    aria-modal="true"
    aria-label={m.builder_newSkill()}
    tabindex="-1"
    onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    onkeydown={handleKeydown}
>
    <div class="modal">
        <div class="modal-header">
            <div class="header-left">
                <BookOpen size={16} class="text-accent" />
                <span class="modal-title">{m.builder_newSkill()}</span>
            </div>
            <Button variant="ghost" class="close-btn" onclick={onClose} aria-label={m.common_close()}>
                <X size={16} />
            </Button>
        </div>

        <div class="modal-body">
            <div class="name-row">
                <EmojiPicker value={emoji} onSelect={(e) => { emoji = e; }} size="md" />
                <!-- svelte-ignore a11y_autofocus -->
                <input
                    class="name-input"
                    type="text"
                    bind:value={name}
                    placeholder={m.builder_skillNamePlaceholder()}
                    autofocus
                />
            </div>

            <textarea
                class="desc-input"
                use:autosize={description}
                bind:value={description}
                placeholder={m.builder_skillDescPlaceholder()}
            ></textarea>

            {#if error}
                <p class="error-text">{error}</p>
            {/if}
        </div>

        <div class="modal-footer">
            <Button variant="ghost" class="btn cancel" onclick={onClose}>{m.common_cancel()}</Button>
            <Button variant="ghost" class="btn create" onclick={handleCreate} disabled={!canCreate || creating}>
                {#if creating}
                    <Loader2 size={14} class="spin" />
                    {m.builder_creating()}
                {:else}
                    {m.builder_createSkill()}
                {/if}
            </Button>
        </div>
    </div>
</div>

<style>
    .overlay {
        position: fixed;
        inset: 0;
        z-index: var(--layer-debug);
        background: color-mix(in srgb, var(--color-canvas) 60%, transparent);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .modal {
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        width: 100%;
        max-width: 420px;
        box-shadow: var(--shadow-elevation-1);
    }

    .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--space-3) var(--space-4);
        border-bottom: 1px solid var(--color-border);
    }

    .header-left {
        display: flex;
        align-items: center;
        gap: var(--space-2);
    }

    .modal-title {
        font-size: var(--font-size-body);
        font-weight: 700;
        color: var(--color-foreground);
    }

    :global(.close-btn) {
        background: transparent;
        border: none;
        color: var(--color-muted);
        cursor: pointer;
        padding: var(--space-1);
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color var(--duration-fast);
    }
    :global(.close-btn:hover) { color: var(--color-foreground); }

    .modal-body {
        padding: var(--space-4);
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
    }

    .name-row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
    }

    .name-input {
        flex: 1;
        font-size: var(--font-size-page-title);
        font-weight: 600;
        color: var(--color-foreground);
        background: transparent;
        border: none;
        border-bottom: 2px solid var(--color-border);
        padding: var(--space-2) 0;
        outline: none;
        font-family: inherit;
        transition: border-color var(--duration-fast);
    }
    .name-input:focus { border-bottom-color: var(--color-accent); }
    .name-input::placeholder { color: var(--color-muted); }

    .desc-input {
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-foreground);
        font-family: inherit;
        font-size: var(--font-size-body);
        padding: var(--space-2) var(--space-2);
        outline: none;
        resize: vertical;
        transition: border-color var(--duration-fast);
    }
    .desc-input:focus { border-color: var(--color-accent); }
    .desc-input::placeholder { color: var(--color-muted); }

    .error-text {
        font-size: var(--font-size-caption);
        color: var(--color-danger-fg);
        margin: 0;
    }

    .modal-footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-2);
        padding: var(--space-3) var(--space-4);
        border-top: 1px solid var(--color-border);
    }

    :global(.btn) {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        font-family: inherit;
        font-size: var(--font-size-body);
        font-weight: 600;
        padding: var(--space-2) var(--space-4);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: all var(--duration-fast) var(--ease-standard);
        border: none;
    }

    :global(.btn.cancel) {
        background: transparent;
        border: 1px solid var(--color-border);
        color: var(--color-muted);
    }
    :global(.btn.cancel:hover) { color: var(--color-foreground); border-color: var(--color-foreground); }

    :global(.btn.create) {
        background: var(--color-accent);
        color: white;
    }
    :global(.btn.create:hover:not(:disabled)) { filter: brightness(1.15); }
    :global(.btn.create:disabled) { opacity: 0.5; cursor: not-allowed; }

    :global(.spin) {
        animation: spin 1s linear infinite;
    }
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
</style>
