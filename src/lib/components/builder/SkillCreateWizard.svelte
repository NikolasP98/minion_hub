<script lang="ts">
    import { X, Loader2, BookOpen } from "lucide-svelte";
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
            error = e instanceof Error ? e.message : "Failed to create skill";
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
    aria-label="New Skill"
    tabindex="-1"
    onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    onkeydown={handleKeydown}
>
    <div class="modal">
        <div class="modal-header">
            <div class="header-left">
                <BookOpen size={16} class="text-accent" />
                <span class="modal-title">New Skill</span>
            </div>
            <button class="close-btn" onclick={onClose} aria-label="Close">
                <X size={16} />
            </button>
        </div>

        <div class="modal-body">
            <div class="name-row">
                <EmojiPicker value={emoji} onSelect={(e) => { emoji = e; }} size="md" />
                <input
                    class="name-input"
                    type="text"
                    bind:value={name}
                    placeholder="Skill name"
                    autofocus
                />
            </div>

            <textarea
                class="desc-input"
                rows="3"
                bind:value={description}
                placeholder="What does this skill do? (optional)"
            ></textarea>

            {#if error}
                <p class="error-text">{error}</p>
            {/if}
        </div>

        <div class="modal-footer">
            <button class="btn cancel" onclick={onClose}>Cancel</button>
            <button class="btn create" onclick={handleCreate} disabled={!canCreate || creating}>
                {#if creating}
                    <Loader2 size={14} class="spin" />
                    Creating...
                {:else}
                    Create Skill
                {/if}
            </button>
        </div>
    </div>
</div>

<style>
    .overlay {
        position: fixed;
        inset: 0;
        z-index: 1000;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .modal {
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 12px;
        width: 100%;
        max-width: 420px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    }

    .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 18px;
        border-bottom: 1px solid var(--color-border);
    }

    .header-left {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .modal-title {
        font-size: 14px;
        font-weight: 700;
        color: var(--color-foreground);
    }

    .close-btn {
        background: transparent;
        border: none;
        color: var(--color-muted);
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color 0.15s;
    }
    .close-btn:hover { color: var(--color-foreground); }

    .modal-body {
        padding: 18px;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .name-row {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .name-input {
        flex: 1;
        font-size: 16px;
        font-weight: 600;
        color: var(--color-foreground);
        background: transparent;
        border: none;
        border-bottom: 2px solid var(--color-border);
        padding: 6px 0;
        outline: none;
        font-family: inherit;
        transition: border-color 0.15s;
    }
    .name-input:focus { border-bottom-color: var(--color-accent); }
    .name-input::placeholder { color: var(--color-muted); }

    .desc-input {
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-foreground);
        font-family: inherit;
        font-size: 13px;
        padding: 8px 10px;
        outline: none;
        resize: vertical;
        transition: border-color 0.15s;
    }
    .desc-input:focus { border-color: var(--color-accent); }
    .desc-input::placeholder { color: var(--color-muted); }

    .error-text {
        font-size: 12px;
        color: var(--color-error, #ef4444);
        margin: 0;
    }

    .modal-footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 18px;
        border-top: 1px solid var(--color-border);
    }

    .btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-family: inherit;
        font-size: 13px;
        font-weight: 600;
        padding: 7px 16px;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.15s;
        border: none;
    }

    .btn.cancel {
        background: transparent;
        border: 1px solid var(--color-border);
        color: var(--color-muted);
    }
    .btn.cancel:hover { color: var(--color-foreground); border-color: var(--color-foreground); }

    .btn.create {
        background: var(--color-accent);
        color: white;
    }
    .btn.create:hover:not(:disabled) { filter: brightness(1.15); }
    .btn.create:disabled { opacity: 0.5; cursor: not-allowed; }

    :global(.spin) {
        animation: spin 1s linear infinite;
    }
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
</style>
