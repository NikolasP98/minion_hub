<script lang="ts">
    import * as splitter from '@zag-js/splitter';
    import { normalizeProps, useMachine } from '@zag-js/svelte';
    import { untrack } from 'svelte';
    import type { Snippet } from 'svelte';
    import { ChevronRight } from 'lucide-svelte';

    export type CollapseLevel = 'expanded' | 'mini' | 'collapsed';

    interface SplitterApi {
        toggle: () => void;
        expand: () => void;
        hide: () => void;
        mini: () => void;
        collapseLevel: () => CollapseLevel;
    }

    interface Props {
        /** localStorage key to persist expanded panel size */
        storageKey: string;
        /** Default left panel size 0–100 (percent) */
        defaultSize?: number;
        /** Fixed panel size when in minibar mode (percent) */
        minibarSize?: number;
        /** Minimum size for expanded mode (percent); below this snaps to mini */
        expandedMinSize?: number;
        /** Maximum draggable panel size (percent) */
        maxSize?: number;
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
        expandedMinSize = minibarSize * 2,
        maxSize = 35,
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
    const initExpandedMinSize = untrack(() => expandedMinSize);
    const initDefaultSize = untrack(() => defaultSize);
    const initMaxSize = untrack(() => maxSize);
    const initStorageKey = untrack(() => storageKey);

    function loadSize(): number {
        if (typeof localStorage === 'undefined') return initDefaultSize;
        const raw = localStorage.getItem(`splitter:${initStorageKey}`);
        if (!raw) return initDefaultSize;
        const n = Number(raw);
        return Number.isFinite(n) ? n : initDefaultSize;
    }

    function loadMode(): 'expanded' | 'mini' | 'collapsed' {
        if (typeof localStorage === 'undefined') return 'expanded';
        const m = localStorage.getItem(`splitter:${initStorageKey}:mode`);
        if (m === 'expanded' || m === 'mini' || m === 'collapsed') return m;
        return 'expanded';
    }

    const initialSavedMode = loadMode();
    const initialSize = initialSavedMode === 'collapsed' ? 0 : loadSize();

    let savedExpandedSize = $state(
        initialSize >= initExpandedMinSize ? initialSize : initDefaultSize,
    );

    // sidebarMode tracks expanded vs mini when panel is NOT collapsed.
    // Zag is source of truth for collapsed state via api.isPanelCollapsed().
    let sidebarMode = $state<'expanded' | 'mini'>(
        initialSavedMode === 'mini' || (initialSize < initExpandedMinSize && initialSavedMode !== 'collapsed')
            ? 'mini'
            : 'expanded',
    );

    const service = useMachine(splitter.machine as any, () => ({
        id: initStorageKey,
        orientation: 'horizontal' as const,
        defaultSize: initialSavedMode === 'collapsed'
            ? [0, 100]
            : [initialSize, 100 - initialSize],
        panels: [
            { id: 'panel', minSize: initMinibarSize, maxSize: initMaxSize, collapsible: true, collapsedSize: 0 },
            { id: 'content', minSize: 5 },
        ],
        onResizeEnd(details: { size: number[] }) {
            const leftSize = details.size[0];
            if (leftSize <= 0) return; // collapsed — handled by onCollapse
            if (leftSize < initExpandedMinSize) {
                // Below expanded min → snap to mini
                sidebarMode = 'mini';
                api.resizePanel('panel', initMinibarSize);
            } else {
                // Expanded zone — save position
                sidebarMode = 'expanded';
                savedExpandedSize = leftSize;
                localStorage.setItem(`splitter:${initStorageKey}`, String(leftSize));
            }
        },
        onCollapse() { oncollapse?.(); },
        onExpand() { onexpand?.(); },
    }));

    const api = $derived(splitter.connect(service as any, normalizeProps));
    const isCollapsed = $derived(api.isPanelCollapsed('panel'));

    const collapseLevel = $derived<CollapseLevel>(
        isCollapsed ? 'collapsed' : sidebarMode === 'mini' ? 'mini' : 'expanded',
    );

    // Persist mode to localStorage
    $effect(() => {
        const cl = collapseLevel;
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(`splitter:${initStorageKey}:mode`, cl);
        }
    });

    // --- Helper functions ---

    function goExpanded(size?: number) {
        const sz = size ?? savedExpandedSize;
        sidebarMode = 'expanded';
        api.setSizes([sz, 100 - sz]);
    }

    function goMini() {
        sidebarMode = 'mini';
        api.resizePanel('panel', initMinibarSize);
    }

    function goCollapsed() {
        api.collapsePanel('panel');
    }

    function toggle() {
        if (isCollapsed) goExpanded();
        else if (sidebarMode === 'expanded') goMini();
        else goCollapsed(); // mini → collapsed
    }

    function handleDoubleClick(e: MouseEvent) {
        e.preventDefault();
        toggle();
    }

    $effect(() => {
        if (!onapi) return;
        untrack(() => {
            onapi!({
                toggle,
                expand: () => goExpanded(),
                hide: () => goCollapsed(),
                mini: () => goMini(),
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

        <!-- Resize handle (double-click toggles expanded↔mini) -->
        <div {...api.getResizeTriggerProps({ id: 'panel:content' })} class="splitter-handle"
             ondblclick={handleDoubleClick}>
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
            onclick={() => goExpanded()}
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
