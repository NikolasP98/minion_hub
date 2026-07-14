<script lang="ts">
  import { Button } from '$lib/components/ui';
import { X, AlertCircle } from "lucide-svelte";
    import * as m from '$lib/paraglide/messages';

    interface Props {
        totalConflicts: number;
        onClose: () => void;
    }

    let { totalConflicts, onClose }: Props = $props();
</script>

<div class="drawer-header">
    <span class="drawer-title">{m.builder_editChapter()}</span>
    {#if totalConflicts > 0}
        <span class="conflict-note">
            <AlertCircle size={12} />
            {totalConflicts} conflict{totalConflicts !== 1 ? "s" : ""}
        </span>
    {/if}
    <span class="flex-1"></span>
    <Button variant="ghost" class="close-btn" onclick={onClose} aria-label="Close">
        <X size={16} />
    </Button>
</div>

<style>
    .drawer-header {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        height: 2.75rem;
        padding: 0 var(--space-4);
        background: var(--color-bg2);
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
    }

    .drawer-title {
        font-size: var(--font-size-body);
        font-weight: 700;
        color: var(--color-foreground);
    }

    .conflict-note {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        font-size: var(--font-size-caption);
        font-weight: 600;
        color: var(--color-warning, var(--color-warning-fg));
    }

    .flex-1 { flex: 1; }

    .close-btn {
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
        flex-shrink: 0;
    }
    .close-btn:hover { color: var(--color-foreground); }
</style>
