<script lang="ts">
  import { Button } from '$lib/components/ui';
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
    <Button variant="ghost" class="btn btn--ghost" onclick={onClose}>{m.common_cancel()}</Button>
    <Button variant="ghost" class="btn btn--primary" onclick={onSave} disabled={totalConflicts > 0}>
        <Check size={14} />
        {m.common_save()}
    </Button>
</div>

<style>
    .drawer-footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-4);
        border-top: 1px solid var(--color-border);
        background: var(--color-bg2);
        flex-shrink: 0;
    }

    .btn {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        font-family: inherit;
        font-size: var(--font-size-caption);
        font-weight: 600;
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: all var(--duration-fast) var(--ease-standard);
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
