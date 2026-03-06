# Design: Resizable Sidebars with Zag.js Splitter

**Date:** 2026-03-03
**Status:** Approved

## Overview

Add resizable splitter handles to all four layouts that contain a left sidebar. When the sidebar is dragged below a collapse threshold, it snaps to a collapsed state. Size is persisted per-layout in localStorage.

## Approach

A single shared `Splitter.svelte` component wraps `@zag-js/splitter`. Each layout opts in by replacing its static sidebar+content flex row with `<Splitter>` passing the panel content as snippets.

## New Component: `src/lib/components/Splitter.svelte`

**Props:**
```ts
{
  key: string           // localStorage key for size persistence
  defaultSize: number   // initial panel width in px
  minSize?: number      // minimum draggable size (default: 60)
  collapseThreshold?: number  // snap-to-collapsed below this width (default: 60)
  collapsedSize?: number      // width when collapsed (default: 0)
  panel: Snippet        // left panel content
  children: Snippet     // right panel content
}
```

**Behavior:**
- Uses `@zag-js/splitter` machine for accessible drag-to-resize
- On drag end: if size < `collapseThreshold`, snap to `collapsedSize`; otherwise save to localStorage
- Restores saved size from localStorage on mount
- Exposes `collapse()` / `expand()` methods via `bind:this` for external toggle buttons

**Handle appearance:**
- 4px wide vertical strip
- Centered grip indicator (2 dots or short line) matching `--color-border`
- Hover: highlight with `--color-accent`, cursor `col-resize`

## Per-Page Changes

| Page | Component | Key | Default | Collapsed width | Collapsed mode |
|------|-----------|-----|---------|-----------------|----------------|
| `/` | `AgentSidebar` + `DetailPanel` | `sidebar-main` | 280px | 60px | Icon-only (sync `ui.sidebarCollapsed`) |
| `/settings` | `SettingsSidebar` + content | `sidebar-settings` | 220px | 0px | Hidden |
| `/config` | `ConfigSidebar` + content | `sidebar-config` | 220px | 0px | Hidden |
| `/marketplace` | `aside` + `main` | `sidebar-marketplace` | 220px | 0px | Hidden |

### Main page (`/`)

- Wrap `<AgentSidebar>` + `<DetailPanel>` in `<Splitter>`
- Collapsed width = 60px (matches existing `w-15` compact mode)
- Sync splitter collapsed state ↔ `ui.sidebarCollapsed` so the existing chevron toggle still works
- The existing toggle buttons inside `AgentSidebar` call `splitter.collapse()` / `splitter.expand()`

### Settings, Config, Marketplace

- Simply wrap existing sidebar + content in `<Splitter>`
- Collapsed = 0px (sidebar hidden)
- No external collapse toggle needed; drag-to-edge collapses it

## Installation

```bash
bun add @zag-js/splitter
```

## Files to Create

- `src/lib/components/Splitter.svelte` — new shared component

## Files to Modify

- `src/routes/+page.svelte`
- `src/routes/settings/+page.svelte`
- `src/routes/config/+page.svelte`
- `src/routes/marketplace/+layout.svelte`
- `src/lib/components/AgentSidebar.svelte` — pass collapse/expand through to splitter
