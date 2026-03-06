# Splitter Three-Level Collapse Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade all four sidebar layouts to support max-width, two collapse levels (minibar + fully hidden), toggle-button cycling between minibar↔expanded only, drag-only full collapse, and a popout tab when fully hidden — plus fix the sparkline resize bug and footer positioning.

**Architecture:** `Splitter.svelte` is redesigned to own three-level state (`expanded | mini | collapsed`). It snaps to minibar on drag near the minimum, collapses to zero on drag past it, and renders a popout tab when collapsed. Each sidebar component accepts a `collapseLevel` prop and renders icon-only in mini mode. The sparkline fix uses a `ResizeObserver` to call `chart.resize()` whenever the container dimensions change.

**Tech Stack:** Zag.js splitter, Svelte 5 runes, ECharts, ResizeObserver, Lucide icons

---

### Task 1: Redesign `Splitter.svelte`

**Files:**
- Modify: `src/lib/components/Splitter.svelte`

This is a full rewrite. Key changes:
- Panel snippet param changes from `{ collapsed: boolean }` → `{ collapseLevel: 'expanded' | 'mini' | 'collapsed' }`
- New props: `minibarSize` (default 5), `maxSize` (default 35)
- Internal `sidebarMode: 'expanded' | 'mini'` state controls toggle behavior
- `onResizeEnd` snaps to mini when drag lands in [minSize, minSize×1.5]; saves expanded size otherwise
- Popout tab button overlaid at left edge when fully collapsed
- New API: `{ toggleMini, expand, collapseLevel }` (replaces old `{ collapse, expand, isCollapsed }`)

**Step 1: Replace the file**

```svelte
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
        /** Size when fully collapsed (percent, always 0) */
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

    // Dragging below minSize triggers Zag's collapse (to collapsedSize=0).
    // minSize = minibarSize means the panel can't be dragged below minibar width
    // without collapsing entirely — no squished-but-visible intermediate zone.
    const minSize = minibarSize;

    function loadSize(): number {
        if (typeof localStorage === 'undefined') return defaultSize;
        const raw = localStorage.getItem(`splitter:${storageKey}`);
        if (!raw) return defaultSize;
        const n = Number(raw);
        return Number.isFinite(n) ? n : defaultSize;
    }

    const initialSize = loadSize();

    // Restore mini mode if the saved size was at/near minibarSize
    let sidebarMode = $state<'expanded' | 'mini'>(
        initialSize <= minibarSize * 1.5 ? 'mini' : 'expanded',
    );
    let savedExpandedSize = $state(
        initialSize > minibarSize * 1.5 ? initialSize : defaultSize,
    );

    const service = useMachine(splitter.machine as any, () => ({
        id: storageKey,
        orientation: 'horizontal' as const,
        defaultSize: [initialSize, 100 - initialSize],
        panels: [
            { id: 'panel', minSize, maxSize, collapsible: true, collapsedSize },
            { id: 'content', minSize: 5 },
        ],
        onResizeEnd(details: { size: number[] }) {
            const leftSize = details.size[0];
            if (leftSize <= collapsedSize) return; // collapsed, handled by onCollapse
            // Snap to mini if user released near the minimum; otherwise save as expanded
            if (leftSize <= minibarSize * 1.5) {
                sidebarMode = 'mini';
                api.resizePanel('panel', minibarSize);
            } else {
                sidebarMode = 'expanded';
                savedExpandedSize = leftSize;
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

    const collapseLevel = $derived<CollapseLevel>(
        isCollapsed
            ? 'collapsed'
            : sidebarMode === 'mini'
              ? 'mini'
              : 'expanded',
    );

    function doToggleMini() {
        if (isCollapsed) return; // popout tab handles expand; toggle button only works when visible
        if (sidebarMode === 'mini') {
            sidebarMode = 'expanded';
            api.resizePanel('panel', savedExpandedSize);
        } else {
            sidebarMode = 'mini';
            api.resizePanel('panel', minibarSize);
        }
    }

    function doExpand() {
        sidebarMode = 'expanded';
        // Use setSizes to bypass Zag's "restore to pre-collapse size" logic
        // so we always land on the saved expanded size, not the minibar size.
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
<div class="flex flex-1 min-h-0 overflow-visible relative">
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

    <!-- Popout tab: shown only when panel is fully collapsed (zero width) -->
    {#if isCollapsed}
        <button class="popout-tab" onclick={doExpand} aria-label="Expand sidebar" title="Expand sidebar">
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
```

**Step 2: Run type-check**

```bash
cd /home/nikolas/Documents/CODE/AI/minion_hub && bun run check 2>&1 | grep -v "flow-editor\|FlowCanvas\|reliability" | grep -iE "error" | head -20
```

Expected: errors only from pages that still use the old `{ collapsed }` snippet (will be fixed in later tasks). No errors in `Splitter.svelte` itself.

**Step 3: Commit**

```bash
git add src/lib/components/Splitter.svelte
git commit -m "feat(splitter): three-level collapse, maxSize, minibarSize, popout tab"
```

---

### Task 2: Fix `EChartsSparkline.svelte` — ResizeObserver

**Files:**
- Modify: `src/lib/components/EChartsSparkline.svelte`

When the splitter panel goes from 0 → visible, the ECharts canvas still has its old zero-width dimensions. Adding a `ResizeObserver` that calls `chart.resize()` fixes both the initial render after hidden→visible and general container size changes.

**Step 1: Add ResizeObserver inside `onMount`**

Read the current file first, then modify the `onMount` callback. The `Promise.all` block currently creates `chart` but never sets up a resize observer. After `chart = echarts.init(...)`, add:

```ts
// After: chart = echarts.init(container, null, { renderer: 'canvas' });
ro = new ResizeObserver(() => { chart?.resize(); });
ro.observe(container);
```

Declare `let ro: ResizeObserver | null = null;` before the Promise.all block.

In the cleanup return function, add `ro?.disconnect();` before `chart?.dispose();`.

Full modified `onMount`:

```ts
onMount(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;

    Promise.all([
        import('echarts/core'),
        import('echarts/charts'),
        import('echarts/components'),
        import('echarts/renderers'),
    ]).then(([echarts, { LineChart, BarChart }, { GridComponent }, { CanvasRenderer }]) => {
        if (disposed) return;
        echarts.use([LineChart, BarChart, GridComponent, CanvasRenderer]);
        chart = echarts.init(container, null, { renderer: 'canvas' });
        ro = new ResizeObserver(() => { chart?.resize(); });
        ro.observe(container);
    });

    return () => {
        disposed = true;
        ro?.disconnect();
        chart?.dispose();
    };
});
```

**Step 2: Verify type-check**

```bash
cd /home/nikolas/Documents/CODE/AI/minion_hub && bun run check 2>&1 | grep "EChartsSparkline" | head -10
```
Expected: no errors

**Step 3: Commit**

```bash
git add src/lib/components/EChartsSparkline.svelte
git commit -m "fix(sparkline): resize chart on container resize (fixes re-show after splitter collapse)"
```

---

### Task 3: Update `AgentSidebar.svelte` and `+page.svelte`

**Files:**
- Modify: `src/lib/components/AgentSidebar.svelte`
- Modify: `src/routes/+page.svelte`

**AgentSidebar changes:**
1. Prop: `collapsed?: boolean` → `collapseLevel?: CollapseLevel` (import type from Splitter)
2. `const collapsed = $derived(collapseLevel !== 'expanded')` — mini and collapsed both show icon-only
3. Remove `ui.sidebarCollapsed` from the toggle logic (splitter now owns this state)
4. Add `h-full` to `HudBorder` class to fix footer positioning

**Step 1: Modify `AgentSidebar.svelte`**

In the `<script>` section, replace:
```ts
import { Plus, ChevronLeft, ChevronRight, Bot, Radio } from "lucide-svelte";
```
with:
```ts
import { Plus, ChevronLeft, ChevronRight, Bot, Radio } from "lucide-svelte";
import type { CollapseLevel } from '$lib/components/Splitter.svelte';
```

Replace the Props interface and derived:
```ts
// BEFORE
interface Props {
    /** Controlled collapsed state from the splitter parent */
    collapsed?: boolean;
    /** Called when the user clicks the collapse/expand chevron */
    ontoggle?: () => void;
}

let { collapsed: collapsedProp, ontoggle }: Props = $props();
// ...
const collapsed = $derived(collapsedProp ?? ui.sidebarCollapsed);

function toggleCollapse() {
    if (ontoggle) {
        ontoggle();
    } else {
        ui.sidebarCollapsed = !ui.sidebarCollapsed;
    }
}
```

Replace with:
```ts
interface Props {
    /** Collapse level from the parent Splitter */
    collapseLevel?: CollapseLevel;
    /** Called when the user clicks the collapse/expand chevron — parent handles the toggle */
    ontoggle?: () => void;
}

let { collapseLevel = 'expanded', ontoggle }: Props = $props();

// Show minibar UI when in mini or collapsed state
const collapsed = $derived(collapseLevel !== 'expanded');

function toggleCollapse() {
    ontoggle?.();
}
```

Also remove the unused `ui` import since `ui.sidebarCollapsed` is no longer used in `toggleCollapse`. Keep the `ui` import only if it's still used elsewhere in the file (it is — `ui.agentAddOpen`, `ui.selectedAgentId`, `ui.selectedSessionKey`, `ui.overlayOpen` are all used).

Change `HudBorder` class — add `h-full`:
```svelte
<!-- BEFORE -->
<HudBorder
    class="w-full shrink-0 overflow-hidden border-r border-border bg-bg2 flex flex-col"
>

<!-- AFTER -->
<HudBorder
    class="w-full h-full overflow-hidden border-r border-border bg-bg2 flex flex-col"
>
```
(Remove `shrink-0` since `h-full` controls height; `shrink-0` was relevant when the sidebar controlled its own width.)

**Step 2: Modify `src/routes/+page.svelte`**

Replace the full file:

```svelte
<script lang="ts">
    import Topbar from '$lib/components/Topbar.svelte';
    import AgentSidebar from '$lib/components/AgentSidebar.svelte';
    import DetailPanel from '$lib/components/DetailPanel.svelte';
    import Splitter from '$lib/components/Splitter.svelte';
    import type { CollapseLevel } from '$lib/components/Splitter.svelte';

    interface SplitterApiHandle {
        toggleMini: () => void;
        expand: () => void;
        collapseLevel: () => CollapseLevel;
    }

    let splitterApi = $state<SplitterApiHandle | null>(null);
</script>

<div class="relative z-10 flex flex-col h-screen overflow-hidden">
    <Topbar />
    <Splitter
        storageKey="sidebar-main"
        defaultSize={20}
        minibarSize={5}
        maxSize={28}
        onapi={(api) => { splitterApi = api; }}
    >
        {#snippet panel({ collapseLevel })}
            <AgentSidebar
                {collapseLevel}
                ontoggle={() => splitterApi?.toggleMini()}
            />
        {/snippet}
        <DetailPanel />
    </Splitter>
</div>
```

**Step 3: Verify type-check**

```bash
cd /home/nikolas/Documents/CODE/AI/minion_hub && bun run check 2>&1 | grep -E "AgentSidebar|page.svelte" | grep error | head -10
```

**Step 4: Commit**

```bash
git add src/lib/components/AgentSidebar.svelte src/routes/+page.svelte
git commit -m "feat(splitter): update AgentSidebar and main page for three-level collapse"
```

---

### Task 4: Add minibar to `SettingsSidebar.svelte`

**Files:**
- Modify: `src/lib/components/settings/SettingsSidebar.svelte`
- Modify: `src/routes/settings/+page.svelte`

**Step 1: Modify `SettingsSidebar.svelte`**

Add `collapseLevel` prop and render icon-only view when in mini mode.

Import `CollapseLevel` and add to Props:
```ts
import type { CollapseLevel } from '$lib/components/Splitter.svelte';

interface Props {
    activeSection: Section;
    onselect: (s: Section) => void;
    hasOther?: boolean;
    collapseLevel?: CollapseLevel;
}

let { activeSection, onselect, hasOther = false, collapseLevel = 'expanded' }: Props = $props();

const mini = $derived(collapseLevel !== 'expanded');
```

In the template, wrap the entire content in an `{#if mini}...{:else}...{/if}` block.

The `<aside>` outer element stays. Inside it:

```svelte
<aside
    class="shrink-0 w-full border-r border-border bg-bg/50 flex flex-col overflow-y-auto py-4"
>
    {#if mini}
        <!-- Minibar: icon-only column -->
        <div class="flex flex-col items-center gap-1 px-1">
            {#each USER_SECTIONS as section (section.id)}
                <button
                    type="button"
                    class="w-8 h-8 flex items-center justify-center rounded-md transition-colors
                        {activeSection === section.id
                        ? 'text-accent bg-accent/10'
                        : 'text-muted-foreground hover:text-foreground hover:bg-bg3'}"
                    onclick={() => onselect(section.id)}
                    title={section.label}
                    aria-label={section.label}
                >
                    <section.icon size={15} />
                </button>
            {/each}

            <div class="w-4 h-px bg-border/60 my-1"></div>

            {#each visibleMeta as meta (meta.id)}
                {@const sectionId = `config-${meta.id}` as Section}
                {@const Icon = META_ICONS[meta.id]}
                {@const disabled = !conn.connected}
                <button
                    type="button"
                    class="w-8 h-8 flex items-center justify-center rounded-md transition-colors
                        {activeSection === sectionId
                        ? 'text-accent bg-accent/10'
                        : disabled
                          ? 'text-muted-foreground/30 cursor-not-allowed'
                          : 'text-muted-foreground hover:text-foreground hover:bg-bg3 cursor-pointer'}"
                    onclick={() => conn.connected && onselect(sectionId)}
                    title={meta.label}
                    aria-label={meta.label}
                >
                    <Icon size={15} />
                </button>
            {/each}

            <div class="w-4 h-px bg-border/40 my-1"></div>

            {#each GATEWAY_BOTTOM as section (section.id)}
                {@const disabled = !conn.connected && section.id !== 'gateways'}
                <button
                    type="button"
                    class="w-8 h-8 flex items-center justify-center rounded-md transition-colors
                        {activeSection === section.id
                        ? 'text-accent bg-accent/10'
                        : disabled
                          ? 'text-muted-foreground/30 cursor-not-allowed'
                          : 'text-muted-foreground hover:text-foreground hover:bg-bg3 cursor-pointer'}"
                    onclick={() => {
                        if (section.id === 'gateways' || conn.connected) onselect(section.id);
                    }}
                    title={section.label}
                    aria-label={section.label}
                >
                    <section.icon size={15} />
                </button>
            {/each}
        </div>
    {:else}
        <!-- EXISTING FULL VIEW — unchanged -->
        <!-- USER group -->
        ... (keep existing template exactly as-is) ...
    {/if}
</aside>
```

**Step 2: Modify `src/routes/settings/+page.svelte`**

Find the Splitter usage and:
1. Add `minibarSize={5}` and `maxSize={26}` props to Splitter
2. Pass `collapseLevel` from snippet to SettingsSidebar

```svelte
<Splitter
    storageKey="sidebar-settings"
    defaultSize={17}
    minibarSize={5}
    maxSize={26}
    collapsedSize={0}
>
    {#snippet panel({ collapseLevel })}
        <SettingsSidebar
            {activeSection}
            onselect={selectSection}
            hasOther={otherGroups.length > 0}
            {collapseLevel}
        />
    {/snippet}
    <main class="flex-1 min-h-0 overflow-hidden flex flex-col">
        ...existing content unchanged...
    </main>
</Splitter>
```

**Step 3: Verify**

```bash
cd /home/nikolas/Documents/CODE/AI/minion_hub && bun run check 2>&1 | grep "SettingsSidebar\|settings/+page" | grep error | head -10
```

**Step 4: Commit**

```bash
git add src/lib/components/settings/SettingsSidebar.svelte src/routes/settings/+page.svelte
git commit -m "feat(splitter): minibar view for SettingsSidebar"
```

---

### Task 5: Add minibar to `ConfigSidebar.svelte`

**Files:**
- Modify: `src/lib/components/config/ConfigSidebar.svelte`
- Modify: `src/routes/config/+page.svelte`

The ConfigSidebar shows config groups (fine-grained). In minibar mode, show meta-group icons — one per visible meta-group. Clicking navigates to the first group in that meta-group.

**Step 1: Modify `ConfigSidebar.svelte`**

Add imports for meta-group icons and CollapseLevel:

```ts
import type { CollapseLevel } from '$lib/components/Splitter.svelte';
import { META_GROUPS } from '$lib/utils/config-schema';
import {
    SlidersHorizontal,
    Brain,
    Zap,
    Radio,
    Plug,
    Monitor,
    MoreHorizontal,
} from 'lucide-svelte';

const META_ICONS: Record<string, any> = {
    setup:      SlidersHorizontal,
    ai:         Brain,
    automation: Zap,
    comms:      Radio,
    extensions: Plug,
    system:     Monitor,
    other:      MoreHorizontal,
};
```

Update props:

```ts
let {
    activeGroupId,
    onselect,
    collapseLevel = 'expanded' as CollapseLevel,
}: {
    activeGroupId: string | null;
    onselect: (id: string) => void;
    collapseLevel?: CollapseLevel;
} = $props();

const mini = $derived(collapseLevel !== 'expanded');
```

In the template, wrap in `{#if mini}...{:else}...{/if}`. For minibar, show meta-group icons with click navigating to the first group in each meta:

```svelte
<nav class="w-full shrink-0 border-r border-border overflow-y-auto py-3 bg-bg2/50">
    {#if mini}
        <div class="flex flex-col items-center gap-1 px-1 pt-1">
            {#each visibleMeta as meta (meta.id)}
                {@const Icon = META_ICONS[meta.id] ?? SlidersHorizontal}
                {@const firstGroup = meta.items[0]}
                <button
                    type="button"
                    class="w-8 h-8 flex items-center justify-center rounded-md transition-colors cursor-pointer border-none
                        {meta.items.some(g => g.id === activeGroupId)
                        ? 'text-accent bg-accent/10'
                        : 'text-muted-foreground hover:text-foreground hover:bg-bg3'}"
                    onclick={() => firstGroup && onselect(firstGroup.id)}
                    title={meta.label}
                    aria-label={meta.label}
                >
                    <Icon size={15} />
                </button>
            {/each}
        </div>
    {:else}
        <!-- Existing full view — unchanged -->
        {#each visibleMeta as meta (meta.id)}
            ...existing template...
        {/each}
    {/if}
</nav>
```

**Step 2: Modify `src/routes/config/+page.svelte`**

Find the Splitter usage (inside the `{:else}` block) and:
1. Add `minibarSize={5}` and `maxSize={26}` props
2. Pass `collapseLevel` to ConfigSidebar

```svelte
<Splitter
    storageKey="sidebar-config"
    defaultSize={17}
    minibarSize={5}
    maxSize={26}
    collapsedSize={0}
>
    {#snippet panel({ collapseLevel })}
        <ConfigSidebar {activeGroupId} onselect={scrollToGroup} {collapseLevel} />
    {/snippet}
    <div class="flex-1 flex flex-col min-h-0">
        ...existing content unchanged...
    </div>
</Splitter>
```

**Step 3: Verify**

```bash
cd /home/nikolas/Documents/CODE/AI/minion_hub && bun run check 2>&1 | grep "ConfigSidebar\|config/+page" | grep error | head -10
```

**Step 4: Commit**

```bash
git add src/lib/components/config/ConfigSidebar.svelte src/routes/config/+page.svelte
git commit -m "feat(splitter): minibar view for ConfigSidebar"
```

---

### Task 6: Add minibar to marketplace layout

**Files:**
- Modify: `src/routes/marketplace/+layout.svelte`

**Step 1: Update the snippet and aside**

Find the current Splitter snippet:
```svelte
{#snippet panel()}
    <aside class="marketplace-sidebar">
```

Change to receive collapseLevel:
```svelte
{#snippet panel({ collapseLevel })}
    <aside class="marketplace-sidebar" class:mini={collapseLevel !== 'expanded'}>
```

Inside the aside, wrap the brand + nav text content so it hides in mini mode. Add a CSS class `mini` to the aside and use it to toggle views.

The simplest approach: add `mini` class to aside when `collapseLevel !== 'expanded'`. Then in CSS:
- `.marketplace-sidebar.mini .brand-text,
  .marketplace-sidebar.mini .nav-label,
  .marketplace-sidebar.mini .nav-text,
  .marketplace-sidebar.mini .soon-badge,
  .marketplace-sidebar.mini .sidebar-actions,
  .marketplace-sidebar.mini .brand-text { display: none; }`
- `.marketplace-sidebar.mini { padding: 8px 0; }`
- `.marketplace-sidebar.mini .nav-item { padding: 8px; justify-content: center; }`
- `.marketplace-sidebar.mini .sidebar-brand { justify-content: center; padding: 4px 8px 8px; }`
- `.marketplace-sidebar.mini .brand-icon { margin: 0; }`

**Step 2: Add Splitter props**

```svelte
<Splitter
    storageKey="sidebar-marketplace"
    defaultSize={16}
    minibarSize={5}
    maxSize={22}
    collapsedSize={0}
>
```

**Step 3: Add CSS for mini mode**

Inside the existing `<style>` block, add:
```css
/* Mini (icon-only) mode */
.marketplace-sidebar.mini {
    padding: 8px 0;
}

.marketplace-sidebar.mini .brand-text,
.marketplace-sidebar.mini .nav-label,
.marketplace-sidebar.mini .nav-text,
.marketplace-sidebar.mini .soon-badge,
.marketplace-sidebar.mini .sidebar-actions {
    display: none;
}

.marketplace-sidebar.mini .sidebar-brand {
    justify-content: center;
    padding: 4px 0 8px;
}

.marketplace-sidebar.mini .sidebar-nav {
    padding: 4px 6px;
}

.marketplace-sidebar.mini .nav-item {
    padding: 8px;
    justify-content: center;
    gap: 0;
}
```

**Step 4: Verify**

```bash
cd /home/nikolas/Documents/CODE/AI/minion_hub && bun run check 2>&1 | grep "marketplace" | grep error | head -10
```

**Step 5: Commit**

```bash
git add src/routes/marketplace/+layout.svelte
git commit -m "feat(splitter): minibar view for marketplace sidebar"
```

---

### Task 7: Final verification

**Step 1: Full type-check**

```bash
cd /home/nikolas/Documents/CODE/AI/minion_hub && bun run check 2>&1 | grep -v "flow-editor\|FlowCanvas\|reliability" | grep -iE "error" | head -30
```
Expected: 0 errors in the modified files

**Step 2: Smoke-test all pages**

Start dev server: `bun run dev`

For each page:
- `/` — drag sidebar to minibar-width → snaps to icon-only; drag further → collapses to 0, popout tab appears; click popout → expands; chevron button cycles mini↔expanded only; sparklines visible after expand
- `/settings` — same three-level behavior; icon-only in mini mode
- `/config` — meta-group icons in mini mode; drag collapse works
- `/marketplace/agents` — icon-only nav in mini; nav links still work

**Step 3: Verify localStorage keys**

Open devtools → Application → Local Storage. Confirm:
- `splitter:sidebar-main`, `splitter:sidebar-settings`, `splitter:sidebar-config`, `splitter:sidebar-marketplace`
- Each stores a number between minibarSize and maxSize (never 0)

**Step 4: Final commit**

```bash
git add -p
git commit -m "feat: three-level sidebar collapse with minibar, maxSize, popout tab"
```
