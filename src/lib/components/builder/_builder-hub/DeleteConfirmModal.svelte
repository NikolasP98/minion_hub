<script lang="ts">
    import * as m from '$lib/paraglide/messages';

    interface Props {
        type: 'skill' | 'agent' | 'tool';
        name: string;
        onCancel: () => void;
        onConfirm: () => void;
    }

    let { type, name, onCancel, onConfirm }: Props = $props();
</script>

<div class="confirm-overlay" role="dialog" aria-modal="true" tabindex="-1" onclick={(e) => { if (e.target === e.currentTarget) onCancel(); }} onkeydown={(e) => { if (e.key === 'Escape') onCancel(); }}>
    <div class="confirm-modal">
        <p class="confirm-title">Delete "{name}"?</p>
        <p class="confirm-desc">{m.builder_deleteDesc({ type })}</p>
        <div class="confirm-actions">
            <button type="button" class="confirm-btn cancel" onclick={onCancel}>{m.common_cancel()}</button>
            <button type="button" class="confirm-btn delete" onclick={onConfirm}>{m.common_delete()}</button>
        </div>
    </div>
</div>

<style>
    .confirm-overlay {
        position: fixed;
        inset: 0;
        z-index: 1100;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(2px);
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .confirm-modal {
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 0.75rem;
        padding: 1.25rem 1.5rem;
        max-width: 340px;
        width: 100%;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
    }

    .confirm-title {
        font-size: 0.875rem;
        font-weight: 700;
        color: var(--color-foreground);
        margin: 0 0 0.375rem;
    }

    .confirm-desc {
        font-size: 0.75rem;
        color: var(--color-muted);
        margin: 0 0 1rem;
        line-height: 1.4;
    }

    .confirm-actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
    }

    .confirm-btn {
        font-family: inherit;
        font-size: 0.75rem;
        font-weight: 600;
        padding: 0.375rem 0.875rem;
        border-radius: 0.375rem;
        cursor: pointer;
        transition: all 0.15s ease;
        border: none;
    }

    .confirm-btn.cancel {
        background: var(--color-bg2);
        color: var(--color-muted);
        border: 1px solid var(--color-border);
    }

    .confirm-btn.cancel:hover {
        color: var(--color-foreground);
        border-color: var(--color-foreground);
    }

    .confirm-btn.delete {
        background: var(--color-error, #ef4444);
        color: white;
    }

    .confirm-btn.delete:hover {
        filter: brightness(1.1);
    }
</style>
