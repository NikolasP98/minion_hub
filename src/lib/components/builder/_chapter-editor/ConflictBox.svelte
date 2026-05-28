<script lang="ts">
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
        <button class="conflict-opt mine" onclick={() => onResolve(field, 'user')}>{m.builder_keepYours()}</button>
        <button class="conflict-opt ai" onclick={() => onResolve(field, 'ai')}>{m.builder_useAi()}</button>
    </div>
    <div class="conflict-preview">{conflict.aiValue.slice(0, 120)}{conflict.aiValue.length > 120 ? '...' : ''}</div>
</div>

<style>
    .conflict-box {
        border: 1px solid color-mix(in srgb, var(--color-accent) 30%, var(--color-border));
        border-radius: 6px;
        padding: 8px 10px;
        background: color-mix(in srgb, var(--color-accent) 4%, var(--color-bg));
        margin-top: 4px;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .conflict-header {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        font-weight: 600;
        color: var(--color-accent);
    }

    .conflict-options { display: flex; gap: 6px; }

    .conflict-opt {
        font-family: inherit;
        font-size: 11px;
        font-weight: 600;
        padding: 4px 10px;
        border-radius: 4px;
        cursor: pointer;
        border: 1px solid var(--color-border);
        background: var(--color-bg2);
        color: var(--color-foreground);
        transition: all 0.15s;
    }
    .conflict-opt.mine:hover { border-color: var(--color-foreground); }
    .conflict-opt.ai {
        background: var(--color-accent);
        border-color: var(--color-accent);
        color: white;
    }
    .conflict-opt.ai:hover { filter: brightness(1.15); }

    .conflict-preview {
        font-size: 11px;
        color: var(--color-muted);
        font-style: italic;
        line-height: 1.3;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
    }
</style>
