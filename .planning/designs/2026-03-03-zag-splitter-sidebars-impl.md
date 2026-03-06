# Zag.js Resizable Splitter Sidebars — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add resizable drag handles to all four layouts (main, settings, config, marketplace), collapsing the sidebar when dragged below a threshold.

**Architecture:** A single shared `Splitter.svelte` component wraps `@zag-js/splitter`. Each layout opts in by replacing the static sidebar+content flex row with `<Splitter>` passing content as snippets. The splitter handles drag-to-resize, collapse-on-threshold, and localStorage persistence per layout.

**Tech Stack:** `@zag-js/splitter`, `@zag-js/svelte`, Svelte 5 snippets, Tailwind CSS

---

### Task 1: Install `@zag-js/splitter`

**Files:**
- Modify: `package.json`

**Step 1: Install the package**

```bash
bun add @zag-js/splitter
```

**Step 2: Verify it appears in package.json**

```bash
grep splitter package.json
```
Expected: `"@zag-js/splitter": "^1.x.x"`

**Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add @zag-js/splitter"
```

---

### Task 2: Create `Splitter.svelte` component

**Files:**
- Create: `src/lib/components/Splitter.svelte`

**Step 1: Create the component**

```svelte
<script lang="ts">
    import * as splitter from '@zag-js/splitter';
    import { normalizeProps, useMachine } from '@zag-js/svelte';
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

    const service = useMachine(splitter.machine, () => ({
        id: storageKey,
        orientation: 'horizontal' as const,
        defaultSize: [initialSize, 100 - initialSize],
        panels: [
            { id: 'panel', minSize, collapsible: true, collapsedSize },
            { id: 'content', minSize: 5 },
        ],
        onResizeEnd(details: { sizes: number[] }) {
            localStorage.setItem(`splitter:${storageKey}`, String(details.sizes[0]));
        },
        onCollapse() {
            oncollapse?.();
        },
        onExpand() {
            onexpand?.();
        },
    }));

    const api = $derived(splitter.connect(service, normalizeProps));
    const isCollapsed = $derived(api.isPanelCollapsed('panel'));

    $effect(() => {
        onapi?.({
            collapse: () => api.collapsePanel('panel'),
            expand: () => api.expandPanel('panel'),
            isCollapsed: () => api.isPanelCollapsed('panel'),
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
```

**Step 2: Verify type-check passes**

```bash
bun run check 2>&1 | head -30
```
Expected: no errors in `Splitter.svelte`

**Step 3: Commit**

```bash
git add src/lib/components/Splitter.svelte
git commit -m "feat: add Splitter.svelte component with Zag.js"
```

---

### Task 3: Integrate into main page (`/`)

**Files:**
- Modify: `src/routes/+page.svelte`
- Modify: `src/lib/components/AgentSidebar.svelte`

The `AgentSidebar` currently controls its own width via `w-70`/`w-15` Tailwind classes on the outer `HudBorder`. We need to remove those so the splitter panel controls width. The sidebar will fill the panel with `w-full`. The `collapsed` state will come from the splitter callback and drive the existing compact view.

**Step 1: Modify `AgentSidebar.svelte`**

Add props for external collapse control (replaces the internal `ui.sidebarCollapsed` source):

Find the current props section (there are none) and the `collapsed` derived:
```ts
// BEFORE (line ~30-34 in AgentSidebar.svelte):
const collapsed = $derived(ui.sidebarCollapsed);

function toggleCollapse() {
    ui.sidebarCollapsed = !ui.sidebarCollapsed;
}
```

Replace with:
```ts
interface Props {
    /** Called when user clicks the collapse/expand chevron */
    ontoggle?: () => void;
    /** Controlled collapsed state from parent splitter */
    collapsed?: boolean;
}

let { ontoggle, collapsed: collapsedProp }: Props = $props();

// Fall back to ui state if no prop provided (backward compat during migration)
const collapsed = $derived(collapsedProp ?? ui.sidebarCollapsed);

function toggleCollapse() {
    if (ontoggle) {
        ontoggle();
    } else {
        ui.sidebarCollapsed = !ui.sidebarCollapsed;
    }
}
```

Also remove the fixed-width classes from `HudBorder` — change:
```svelte
<!-- BEFORE -->
<HudBorder
    class="{collapsed
        ? 'w-15'
        : 'w-70'} shrink-0 overflow-hidden border-r border-border bg-bg2 flex flex-col transition-[width] duration-200 ease-out"
>
```
to:
```svelte
<!-- AFTER -->
<HudBorder
    class="w-full shrink-0 overflow-hidden border-r border-border bg-bg2 flex flex-col"
>
```

**Step 2: Modify `src/routes/+page.svelte`**

Replace the full file:

```svelte
<script lang="ts">
    import Topbar from '$lib/components/Topbar.svelte';
    import AgentSidebar from '$lib/components/AgentSidebar.svelte';
    import DetailPanel from '$lib/components/DetailPanel.svelte';
    import Splitter from '$lib/components/Splitter.svelte';
    import { ui } from '$lib/state/ui.svelte';

    interface SplitterApi {
        collapse: () => void;
        expand: () => void;
        isCollapsed: () => boolean;
    }

    let splitterApi = $state<SplitterApi | null>(null);

    function handleSidebarToggle() {
        if (!splitterApi) {
            ui.sidebarCollapsed = !ui.sidebarCollapsed;
            return;
        }
        if (splitterApi.isCollapsed()) {
            splitterApi.expand();
        } else {
            ui.sidebarCollapsed = !ui.sidebarCollapsed;
        }
    }
</script>

<div class="relative z-10 flex flex-col h-screen overflow-hidden">
    <Topbar />
    <Splitter
        storageKey="sidebar-main"
        defaultSize={20}
        minSize={5}
        collapsedSize={0}
        onapi={(api) => { splitterApi = api; }}
        oncollapse={() => { ui.sidebarCollapsed = false; }}
        onexpand={() => { ui.sidebarCollapsed = false; }}
    >
        {#snippet panel({ collapsed })}
            <AgentSidebar
                collapsed={collapsed || ui.sidebarCollapsed}
                ontoggle={handleSidebarToggle}
            />
        {/snippet}
        <DetailPanel />
    </Splitter>
</div>
```

**Step 3: Verify type-check**

```bash
bun run check 2>&1 | grep -E "error|Error" | head -20
```
Expected: no new errors

**Step 4: Test in browser**

Start dev server: `bun run dev`

- Verify drag handle appears between sidebar and main content
- Drag to resize — sidebar should change width
- Drag to narrow → collapses (hides sidebar)
- Click chevron `<` button → switches to icon-only compact view
- Sidebar resize is remembered on page reload

**Step 5: Commit**

```bash
git add src/routes/+page.svelte src/lib/components/AgentSidebar.svelte
git commit -m "feat(splitter): integrate resizable splitter on main dashboard"
```

---

### Task 4: Integrate into settings page (`/settings`)

**Files:**
- Modify: `src/routes/settings/+page.svelte`
- Modify: `src/lib/components/settings/SettingsSidebar.svelte`

The settings sidebar is a plain component without fixed width classes — its width comes from parent layout. We just need to ensure it fills the panel.

**Step 1: Check `SettingsSidebar.svelte` outer element**

Read the file and note the outer wrapper element. If it has a fixed `w-*` class, remove it and replace with `w-full`.

Common pattern to look for:
```svelte
<aside class="w-56 ...">
```
Change to:
```svelte
<aside class="w-full ...">
```

**Step 2: Modify settings page layout section**

Find in `src/routes/settings/+page.svelte`:
```svelte
    <div class="flex flex-1 min-h-0">
        <SettingsSidebar
            {activeSection}
            onselect={selectSection}
            hasOther={otherGroups.length > 0}
        />

        <main class="flex-1 min-h-0 overflow-hidden flex flex-col">
```

Add import at top of `<script>`:
```ts
import Splitter from '$lib/components/Splitter.svelte';
```

Replace the flex wrapper + sidebar + main with:
```svelte
    <Splitter
        storageKey="sidebar-settings"
        defaultSize={17}
        minSize={10}
        collapsedSize={0}
    >
        {#snippet panel()}
            <SettingsSidebar
                {activeSection}
                onselect={selectSection}
                hasOther={otherGroups.length > 0}
            />
        {/snippet}
        <main class="flex-1 min-h-0 overflow-hidden flex flex-col">
            <!-- all existing main content here unchanged -->
        </main>
    </Splitter>
```

**Step 3: Verify type-check**

```bash
bun run check 2>&1 | grep -E "error|Error" | head -20
```

**Step 4: Test**

- Navigate to `/settings`
- Drag handle visible and functional
- Dragging to edge collapses sidebar
- Reload — size restored from localStorage

**Step 5: Commit**

```bash
git add src/routes/settings/+page.svelte src/lib/components/settings/SettingsSidebar.svelte
git commit -m "feat(splitter): integrate resizable splitter on settings page"
```

---

### Task 5: Integrate into config page (`/config`)

**Files:**
- Modify: `src/routes/config/+page.svelte`
- Modify: `src/lib/components/config/ConfigSidebar.svelte`

**Step 1: Check `ConfigSidebar.svelte` outer element**

Read the file and ensure the outer element uses `w-full` (remove any fixed `w-*` class).

**Step 2: Modify config page layout**

Find in `src/routes/config/+page.svelte` (inside the `{:else}` block):
```svelte
    <div class="flex-1 flex min-h-0">
      <!-- Sidebar -->
      <ConfigSidebar {activeGroupId} onselect={scrollToGroup} />

      <!-- Content -->
      <div class="flex-1 flex flex-col min-h-0">
```

Add import at top of `<script>`:
```ts
import Splitter from '$lib/components/Splitter.svelte';
```

Replace with:
```svelte
    <Splitter
        storageKey="sidebar-config"
        defaultSize={17}
        minSize={10}
        collapsedSize={0}
    >
        {#snippet panel()}
            <ConfigSidebar {activeGroupId} onselect={scrollToGroup} />
        {/snippet}
        <div class="flex-1 flex flex-col min-h-0">
            <!-- existing content unchanged -->
        </div>
    </Splitter>
```

Note: keep the outer `<div class="relative z-10 flex flex-col h-screen overflow-hidden text-foreground">` and `<Topbar />` unchanged. The `Splitter` replaces only the inner flex row.

**Step 3: Verify type-check**

```bash
bun run check 2>&1 | grep -E "error|Error" | head -20
```

**Step 4: Test**

- Navigate to `/config` (requires connected gateway)
- Drag handle functional
- Collapse/expand works

**Step 5: Commit**

```bash
git add src/routes/config/+page.svelte src/lib/components/config/ConfigSidebar.svelte
git commit -m "feat(splitter): integrate resizable splitter on config page"
```

---

### Task 6: Integrate into marketplace layout (`/marketplace/*`)

**Files:**
- Modify: `src/routes/marketplace/+layout.svelte`

The marketplace sidebar uses a CSS class `.marketplace-sidebar` with fixed `width: 220px`. We remove that fixed width and wrap in `Splitter`.

**Step 1: Modify `+layout.svelte`**

Add import at top of `<script>`:
```ts
import Splitter from '$lib/components/Splitter.svelte';
```

Find the inner layout div:
```svelte
    <div class="flex flex-1 overflow-hidden max-[768px]:flex-col">
        <!-- Sidebar -->
        <aside class="marketplace-sidebar">
            ...
        </aside>

        <!-- Main Content -->
        <main class="marketplace-main">
            {@render children()}
        </main>
    </div>
```

Replace with:
```svelte
    <Splitter
        storageKey="sidebar-marketplace"
        defaultSize={16}
        minSize={10}
        collapsedSize={0}
    >
        {#snippet panel()}
            <aside class="marketplace-sidebar">
                ...all existing aside content unchanged...
            </aside>
        {/snippet}
        <main class="marketplace-main">
            {@render children()}
        </main>
    </Splitter>
```

Also in the `<style>` block, remove the fixed width from `.marketplace-sidebar`:
```css
/* REMOVE or change: */
.marketplace-sidebar {
    width: 220px;  /* <-- remove this line */
    flex-shrink: 0;
    ...
}
```

Add `width: 100%` instead so it fills the splitter panel:
```css
.marketplace-sidebar {
    width: 100%;
    flex-shrink: 0;
    ...
}
```

Also remove the responsive media queries for `.marketplace-sidebar` width (`@media (max-width: 1024px)` and `@media (max-width: 768px)`) since the splitter now handles resize.

**Step 2: Verify type-check**

```bash
bun run check 2>&1 | grep -E "error|Error" | head -20
```

**Step 3: Test**

- Navigate to `/marketplace/agents`
- Drag handle visible
- Collapse/expand works
- Nav links still work after resize

**Step 4: Commit**

```bash
git add src/routes/marketplace/+layout.svelte
git commit -m "feat(splitter): integrate resizable splitter on marketplace layout"
```

---

### Task 7: Final verification

**Step 1: Full type-check**

```bash
bun run check
```
Expected: 0 errors

**Step 2: Manual smoke test all four pages**

1. `/` — drag sidebar, collapse, refresh (size restored), chevron toggle still works
2. `/settings` — drag, collapse, refresh
3. `/config` — drag, collapse, refresh (may need gateway connection)
4. `/marketplace/agents` — drag, collapse, refresh

**Step 3: Verify localStorage keys**

Open browser devtools → Application → Local Storage → check for:
- `splitter:sidebar-main`
- `splitter:sidebar-settings`
- `splitter:sidebar-config`
- `splitter:sidebar-marketplace`

**Step 4: Final commit**

```bash
git add -p  # any remaining changes
git commit -m "feat: resizable sidebars with Zag.js splitter on all layouts"
```
