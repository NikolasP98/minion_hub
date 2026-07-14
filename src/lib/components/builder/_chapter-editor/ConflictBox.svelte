<script lang="ts">
  import { Button } from '$lib/components/ui';
import { Sparkles } from "lucide-svelte";
    import * as m from '$lib/paraglide/messages';
    import type { FieldKey, FieldConflict } from './types';

    interface Props {
        field: FieldKey;
        conflict: FieldConflict;
        onResolve: (field: FieldKey, choice: 'user' | 'ai') => void;
    }

    let { field, conflict, onResolve }: Props = $props();
</script>

<div class="conflict-box">
    <div class="conflict-header">
        <Sparkles size={12} />
        <span>{m.builder_aiSuggestedDifferent()}</span>
    </div>
    <div class="conflict-options">
        <Button variant="ghost" class="conflict-opt mine" onclick={() => onResolve(field, 'user')}>{m.builder_keepYours()}</Button>
        <Button variant="ghost" class="conflict-opt ai" onclick={() => onResolve(field, 'ai')}>{m.builder_useAi()}</Button>
    </div>
    <div class="conflict-preview">{conflict.aiValue.slice(0, 120)}{conflict.aiValue.length > 120 ? '...' : ''}</div>
</div>

<style>
    .conflict-box {
        border: 1px solid color-mix(in srgb, var(--color-accent) 30%, var(--color-border));
        border-radius: var(--radius-md);
        padding: var(--space-2) var(--space-2);
        background: color-mix(in srgb, var(--color-accent) 4%, var(--color-bg));
        margin-top: var(--space-1);
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .conflict-header {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        font-size: var(--font-size-caption);
        font-weight: 600;
        color: var(--color-accent);
    }

    .conflict-options { display: flex; gap: var(--space-2); }

    :global(.conflict-opt) {
        font-family: inherit;
        font-size: var(--font-size-caption);
        font-weight: 600;
        padding: var(--space-1) var(--space-2);
        border-radius: var(--radius-sm);
        cursor: pointer;
        border: 1px solid var(--color-border);
        background: var(--color-bg2);
        color: var(--color-foreground);
        transition: all var(--duration-fast) var(--ease-standard);
    }
    :global(.conflict-opt.mine:hover) { border-color: var(--color-foreground); }
    :global(.conflict-opt.ai) {
        background: var(--color-accent);
        border-color: var(--color-accent);
        color: white;
    }
    :global(.conflict-opt.ai:hover) { filter: brightness(1.15); }

    .conflict-preview {
        font-size: var(--font-size-caption);
        color: var(--color-muted);
        font-style: italic;
        line-height: 1.3;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
    }
</style>
