<script lang="ts">
  import { Button } from '$lib/components/ui';
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
            <Button variant="ghost" type="button" class="confirm-btn cancel" onclick={onCancel}>{m.common_cancel()}</Button>
            <Button variant="ghost" type="button" class="confirm-btn delete" onclick={onConfirm}>{m.common_delete()}</Button>
        </div>
    </div>
</div>

<style>
    .confirm-overlay {
        position: fixed;
        inset: 0;
        z-index: var(--layer-debug);
        background: color-mix(in srgb, var(--color-canvas) 50%, transparent);
        backdrop-filter: blur(2px);
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .confirm-modal {
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        padding: var(--space-6) var(--space-6);
        max-width: 340px;
        width: 100%;
        box-shadow: var(--shadow-overlay);
    }

    .confirm-title {
        font-size: var(--font-size-body);
        font-weight: 700;
        color: var(--color-foreground);
        margin: 0 0 var(--space-2);
    }

    .confirm-desc {
        font-size: var(--font-size-caption);
        color: var(--color-muted);
        margin: 0 0 var(--space-4);
        line-height: 1.4;
    }

    .confirm-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-2);
    }

    :global(.confirm-btn) {
        font-family: inherit;
        font-size: var(--font-size-caption);
        font-weight: 600;
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: all var(--duration-fast) var(--ease-standard);
        border: none;
    }

    :global(.confirm-btn.cancel) {
        background: var(--color-bg2);
        color: var(--color-muted);
        border: 1px solid var(--color-border);
    }

    :global(.confirm-btn.cancel:hover) {
        color: var(--color-foreground);
        border-color: var(--color-foreground);
    }

    :global(.confirm-btn.delete) {
        background: var(--color-danger-fg);
        color: white;
    }

    :global(.confirm-btn.delete:hover) {
        filter: brightness(1.1);
    }
</style>
