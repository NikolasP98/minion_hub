<script lang="ts">
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
    <button class="close-btn" onclick={onClose} aria-label="Close">
        <X size={16} />
    </button>
</div>

<style>
    .drawer-header {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 2.75rem;
        padding: 0 16px;
        background: var(--color-bg2);
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
    }

    .drawer-title {
        font-size: 14px;
        font-weight: 700;
        color: var(--color-foreground);
    }

    .conflict-note {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        font-weight: 600;
        color: var(--color-warning, #f59e0b);
    }

    .flex-1 { flex: 1; }

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
        flex-shrink: 0;
    }
    .close-btn:hover { color: var(--color-foreground); }
</style>
