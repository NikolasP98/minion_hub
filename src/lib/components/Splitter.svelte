<script lang="ts">
    import * as splitter from '@zag-js/splitter';
    import { normalizeProps, useMachine } from '@zag-js/svelte';
    import { untrack } from 'svelte';
    import type { Snippet } from 'svelte';

    interface SplitterApi {
        collapse: () => void;
        expand: () => void;
        isCollapsed: () => boolean;
    }

    interface Props {
        /** localStorage key to persist panel size */
        storageKey: string;
        /** Default left panel size 0–100 (percent) */
        defaultSize?: number;
        /** Minimum left panel size before auto-collapse (percent) */
        minSize?: number;
        /** Size when collapsed (percent, 0 = hidden) */
        collapsedSize?: number;
        /** Left panel snippet; receives { collapsed: boolean } */
        panel: Snippet<[{ collapsed: boolean }]>;
        /** Right panel content */
        children: Snippet;
        /** Fires when panel collapses */
        oncollapse?: () => void;
        /** Fires when panel expands */
        onexpand?: () => void;
        /** Receives the API for programmatic control */
        onapi?: (api: SplitterApi) => void;
    }

    let {
        storageKey,
        defaultSize = 20,
        minSize = 5,
        collapsedSize = 0,
        panel,
        children,
        oncollapse,
        onexpand,
        onapi,
    }: Props = $props();

    function loadSize(): number {
        if (typeof localStorage === 'undefined') return defaultSize;
        const raw = localStorage.getItem(`splitter:${storageKey}`);
        if (!raw) return defaultSize;
        const n = Number(raw);
        return Number.isFinite(n) ? n : defaultSize;
    }

    const initialSize = loadSize();

    const service = useMachine(splitter.machine as any, () => ({
        id: storageKey,
        orientation: 'horizontal' as const,
        defaultSize: [initialSize, 100 - initialSize],
        panels: [
            { id: 'panel', minSize, collapsible: true, collapsedSize },
            { id: 'content', minSize: 5 },
        ],
        onResizeEnd(details: { size: number[] }) {
            const leftSize = details.size[0];
            if (leftSize > collapsedSize) {
                localStorage.setItem(`splitter:${storageKey}`, String(leftSize));
            }
        },
        onCollapse() {
            oncollapse?.();
        },
        onExpand() {
            onexpand?.();
        },
    }));

    const api = $derived(splitter.connect(service as any, normalizeProps));
    const isCollapsed = $derived(api.isPanelCollapsed('panel'));

    // Expose programmatic API to parent once per onapi prop change.
    // untrack prevents the effect from re-running on every `api` recompute
    // (which happens on every resize drag tick), since the callbacks close
    // over `api` and always reflect the current machine state anyway.
    $effect(() => {
        if (!onapi) return;
        untrack(() => {
            onapi!({
                collapse: () => api.collapsePanel('panel'),
                expand: () => api.expandPanel('panel'),
                isCollapsed: () => api.isPanelCollapsed('panel'),
            });
        });
    });
</script>

<div {...api.getRootProps()} class="flex flex-1 min-h-0 overflow-hidden">
    <!-- Left panel -->
    <div {...api.getPanelProps({ id: 'panel' })} class="overflow-hidden flex flex-col min-w-0">
        {@render panel({ collapsed: isCollapsed })}
    </div>

    <!-- Resize handle -->
    <div {...api.getResizeTriggerProps({ id: 'panel:content' })} class="splitter-handle group">
        <div class="splitter-grip"></div>
    </div>

    <!-- Right panel -->
    <div {...api.getPanelProps({ id: 'content' })} class="min-w-0 flex flex-col overflow-hidden flex-1">
        {@render children()}
    </div>
</div>

<style>
    .splitter-handle {
        width: 4px;
        flex-shrink: 0;
        background: var(--color-border);
        cursor: col-resize;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s ease;
        position: relative;
        z-index: 10;
    }

    .splitter-handle:hover,
    .splitter-handle[data-focus] {
        background: color-mix(in srgb, var(--color-accent) 60%, var(--color-border));
    }

    .splitter-grip {
        width: 2px;
        height: 20px;
        border-radius: 1px;
        background: var(--color-muted-foreground);
        opacity: 0;
        transition: opacity 0.15s ease;
    }

    .splitter-handle:hover .splitter-grip,
    .splitter-handle[data-focus] .splitter-grip {
        opacity: 0.5;
    }
</style>
