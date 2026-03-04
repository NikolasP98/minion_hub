<script lang="ts">
    import * as splitter from '@zag-js/splitter';
    import { normalizeProps, useMachine } from '@zag-js/svelte';
    import { untrack } from 'svelte';
    import type { Snippet } from 'svelte';
    import { ChevronRight } from 'lucide-svelte';

    export type CollapseLevel = 'expanded' | 'mini' | 'collapsed';

    interface SplitterApi {
        toggleMini: () => void;
        expand: () => void;
        collapseLevel: () => CollapseLevel;
    }

    interface Props {
        /** localStorage key to persist expanded panel size */
        storageKey: string;
        /** Default left panel size 0–100 (percent) */
        defaultSize?: number;
        /** Panel size when in minibar mode (percent) */
        minibarSize?: number;
        /** Maximum draggable panel size (percent) */
        maxSize?: number;
        /** Size when fully collapsed (always 0) */
        collapsedSize?: number;
        /** Left panel snippet; receives { collapseLevel } */
        panel: Snippet<[{ collapseLevel: CollapseLevel }]>;
        /** Right panel content */
        children: Snippet;
        /** Fires when panel collapses to zero */
        oncollapse?: () => void;
        /** Fires when panel expands from zero */
        onexpand?: () => void;
        /** Receives the programmatic API handle once on mount */
        onapi?: (api: SplitterApi) => void;
    }

    let {
        storageKey,
        defaultSize = 20,
        minibarSize = 5,
        maxSize = 35,
        collapsedSize = 0,
        panel,
        children,
        oncollapse,
        onexpand,
        onapi,
    }: Props = $props();

    // Capture initial prop values once at mount time.
    // These are intentionally one-time reads: the splitter machine is initialised
    // once and Zag does not support hot-swapping panel configs at runtime.
    const initMinibarSize = untrack(() => minibarSize);
    const initDefaultSize = untrack(() => defaultSize);
    const initMaxSize = untrack(() => maxSize);
    const initCollapsedSize = untrack(() => collapsedSize);
    const initStorageKey = untrack(() => storageKey);

    // Dragging below minSize triggers Zag's auto-collapse to collapsedSize (0).
    // Setting minSize = minibarSize means the drag range is [minibarSize, maxSize];
    // anything below minibarSize collapses entirely — no squished intermediate state.
    const minSize = initMinibarSize;

    function loadSize(): number {
        if (typeof localStorage === 'undefined') return initDefaultSize;
        const raw = localStorage.getItem(`splitter:${initStorageKey}`);
        if (!raw) return initDefaultSize;
        const n = Number(raw);
        return Number.isFinite(n) ? n : initDefaultSize;
    }

    const initialSize = loadSize();

    // Restore mini mode if the saved size was at/near minibarSize on last session
    let sidebarMode = $state<'expanded' | 'mini'>(
        initialSize <= initMinibarSize * 1.5 ? 'mini' : 'expanded',
    );
    let savedExpandedSize = $state(
        initialSize > initMinibarSize * 1.5 ? initialSize : initDefaultSize,
    );

    const service = useMachine(splitter.machine as any, () => ({
        id: initStorageKey,
        orientation: 'horizontal' as const,
        defaultSize: [initialSize, 100 - initialSize],
        panels: [
            { id: 'panel', minSize, maxSize: initMaxSize, collapsible: true, collapsedSize: initCollapsedSize },
            { id: 'content', minSize: 5 },
        ],
        onResizeEnd(details: { size: number[] }) {
            const leftSize = details.size[0];
            if (leftSize <= initCollapsedSize) return; // handled by onCollapse
            // Snap to mini if the user released near the minimum drag position
            if (leftSize <= initMinibarSize * 1.5) {
                sidebarMode = 'mini';
                api.resizePanel('panel', initMinibarSize);
            } else {
                sidebarMode = 'expanded';
                savedExpandedSize = leftSize;
                localStorage.setItem(`splitter:${initStorageKey}`, String(leftSize));
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

    const collapseLevel = $derived<CollapseLevel>(
        isCollapsed ? 'collapsed' : sidebarMode === 'mini' ? 'mini' : 'expanded',
    );

    function doToggleMini() {
        if (isCollapsed) return; // only the popout tab handles expand from fully-collapsed
        if (sidebarMode === 'mini') {
            sidebarMode = 'expanded';
            api.resizePanel('panel', savedExpandedSize);
        } else {
            sidebarMode = 'mini';
            api.resizePanel('panel', initMinibarSize);
        }
    }

    function doExpand() {
        sidebarMode = 'expanded';
        // setSizes bypasses Zag's "restore to pre-collapse size" so we always land
        // on the saved expanded size rather than whatever size was before collapsing.
        api.setSizes([savedExpandedSize, 100 - savedExpandedSize]);
    }

    $effect(() => {
        if (!onapi) return;
        untrack(() => {
            onapi!({
                toggleMini: doToggleMini,
                expand: doExpand,
                collapseLevel: () => collapseLevel,
            });
        });
    });
</script>

<!-- Outer wrapper is relative so the popout tab can be absolutely positioned -->
<div class="flex flex-1 min-h-0 relative overflow-hidden">
    <div {...api.getRootProps()} class="flex flex-1 min-h-0 overflow-hidden">
        <!-- Left panel -->
        <div {...api.getPanelProps({ id: 'panel' })} class="overflow-hidden flex flex-col min-w-0 h-full">
            {@render panel({ collapseLevel })}
        </div>

        <!-- Resize handle -->
        <div {...api.getResizeTriggerProps({ id: 'panel:content' })} class="splitter-handle">
            <div class="splitter-grip"></div>
        </div>

        <!-- Right panel -->
        <div {...api.getPanelProps({ id: 'content' })} class="min-w-0 flex flex-col overflow-hidden flex-1">
            {@render children()}
        </div>
    </div>

    <!-- Popout tab: shown only when fully collapsed (zero width) -->
    {#if isCollapsed}
        <button
            class="popout-tab"
            onclick={doExpand}
            aria-label="Expand sidebar"
            title="Expand sidebar"
        >
            <ChevronRight size={12} />
        </button>
    {/if}
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

    .popout-tab {
        position: absolute;
        left: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 16px;
        height: 48px;
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-left: none;
        border-radius: 0 6px 6px 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--color-muted-foreground);
        cursor: pointer;
        z-index: 20;
        transition: color 0.15s, background 0.15s;
        padding: 0;
    }

    .popout-tab:hover {
        color: var(--color-foreground);
        background: var(--color-bg3);
    }
</style>
