<script lang="ts">
    import { Check } from "lucide-svelte";
    import * as m from '$lib/paraglide/messages';

    interface Props {
        totalConflicts: number;
        onClose: () => void;
        onSave: () => void;
    }

    let { totalConflicts, onClose, onSave }: Props = $props();
</script>

<div class="drawer-footer">
    <button class="btn btn--ghost" onclick={onClose}>{m.common_cancel()}</button>
    <button class="btn btn--primary" onclick={onSave} disabled={totalConflicts > 0}>
        <Check size={14} />
        {m.common_save()}
    </button>
</div>

<style>
    .drawer-footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        padding: 10px 16px;
        border-top: 1px solid var(--color-border);
        background: var(--color-bg2);
        flex-shrink: 0;
    }

    .btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        padding: 6px 14px;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.15s;
        border: none;
    }

    .btn--ghost {
        background: transparent;
        border: 1px solid var(--color-border);
        color: var(--color-muted);
    }
    .btn--ghost:hover { color: var(--color-foreground); border-color: var(--color-foreground); }

    .btn--primary {
        background: var(--color-accent);
        color: white;
    }
    .btn--primary:hover:not(:disabled) { filter: brightness(1.15); }
    .btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
