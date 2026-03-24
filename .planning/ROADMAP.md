# Roadmap: Minion Hub

## Milestones

- ✅ **v1.0 Settings Page Revamp** - Phase 1 shipped 2026-03-12; Phases 2-4 paused
- ✅ **v2.0 Skill Builder Improvements** - Phases 5-7 shipped 2026-03-19; Phases 8-13 deferred
- 🚧 **v3.0 Pixel Office** - Phases 8-11 (in progress)

## Phases

<details>
<summary>✅ v1.0 Settings Page Revamp (Phase 1 shipped 2026-03-12; Phases 2-4 deferred to v3.0)</summary>

### Phase 1: Tab Layout and Save Infrastructure
**Goal**: Administrators can navigate settings via tabs with reliable save behavior, restart recovery, and no state loss during navigation
**Depends on**: Nothing (first phase)
**Requirements**: LAYOUT-01, LAYOUT-04, LAYOUT-05, SAVE-02, SAVE-03, INTG-01, INTG-02, PLSH-01, PLSH-03
**Success Criteria** (what must be TRUE):
  1. User sees top-level tabs (AI, Agents, Comms, Security, System, Appearance) and can switch between them without losing scroll position or input state
  2. User sees loading skeletons while config loads, and the page matches existing Minion Hub theming
  3. User is warned before navigating away with unsaved changes (both browser close and in-app navigation), and can save via Ctrl/Cmd+S
  4. After saving a config change that triggers gateway restart, user sees a clear "restarting" indicator and the connection auto-recovers without manual intervention
  5. Config changes are confirmed as applied on the gateway via the config.patch WebSocket response
**Plans:** 3/3 plans complete

Plans:
- [x] 01-01-PLAN.md — Tab reorganization
- [x] 01-02-PLAN.md — Save/restart hardening
- [x] 01-03-PLAN.md — Gap closure

### Phase 2: Cards and Field Widgets (Deferred)
### Phase 3: Discovery and Overrides (Deferred)
### Phase 4: Setup Wizard (Deferred)

</details>

<details>
<summary>✅ v2.0 Skill Builder Improvements (Phases 5-7 shipped 2026-03-19; Phases 8-13 deferred)</summary>

### Phase 5: State Architecture Refactor
**Goal**: Skill editor business logic lives in a dedicated state module
**Plans:** 1/1 plans complete

Plans:
- [x] 05-01-PLAN.md — Extract state to skill-editor.svelte.ts

### Phase 6: Critical Code Fixes
**Goal**: Skill builder produces correct AI output, performs efficient DB operations, handles edge cases
**Plans:** 3/3 plans complete

Plans:
- [x] 06-01-PLAN.md — Fix AI endpoints
- [x] 06-02-PLAN.md — Fix builder service
- [x] 06-03-PLAN.md — Fix publish safety

### Phase 7: Validation UX
**Goal**: Skill authors see exactly which chapters have errors and why publish is blocked
**Plans:** 3/3 plans complete

Plans:
- [x] 07-01-PLAN.md — Shared validation module
- [x] 07-02-PLAN.md — State + server wiring
- [x] 07-03-PLAN.md — UI integration

### v2.0 Deferred Phases (8-13)

Phases 8-13 from v2.0 Skill Builder (Error Handling, AI Quality, Data Flow, Cost Tracking, Versioning, Advanced Features) are deferred. They will resume in a future milestone.

</details>

---

### 🚧 v3.0 Pixel Office (In Progress)

**Milestone Goal:** Complete the pixel art office workshop view with character animations driven by real-time gateway data, user interaction, GPU-accelerated PixiJS rendering, and a layout editor.

- [x] **Phase 8: Character Animation + Gateway Bridge** - Animate pixel characters driven by real-time agent FSM states (completed 2026-03-23)
- [ ] **Phase 9: Interaction + Persistence** - Click selection, pan/zoom, status labels, and localStorage persistence
- [ ] **Phase 10: PixiJS Renderer Migration** - Replace Canvas 2D rendering with PixiJS sprite batching
- [ ] **Phase 11: Layout Editor** - Furniture placement, floor/wall painting, and undo/redo

## Phase Details

### Phase 8: Character Animation + Gateway Bridge
**Goal**: Pixel characters animate and behave according to real-time gateway agent states -- typing when conversing, reading when scanning files, wandering when idle, with spawn/despawn effects on connect/disconnect
**Depends on**: Phase 7 (existing Canvas 2D renderer, asset loader, view mode toggle, gateway bridge module)
**Requirements**: ANIM-01, ANIM-02, ANIM-03, ANIM-04, ANIM-05, ANIM-06, GATE-01, GATE-02, GATE-03, GATE-04, GATE-05, GATE-06
**Success Criteria** (what must be TRUE):
  1. Characters visibly walk with a 4-frame animation when wandering between tiles, and play distinct typing/reading animations when the agent is active
  2. When a gateway agent connects or disconnects, a pixel character appears or disappears with a matrix digital rain effect
  3. Agent tool usage (Write/Edit/Bash vs Read/Grep/Glob) correctly drives typing vs reading animation on the corresponding character
  4. CRT monitor sprites switch to their ON state when the seated agent is actively typing, and permission/waiting bubbles appear above characters based on gateway presence data
  5. Idle agents wander via BFS pathfinding on the tile grid (respecting furniture walkability) and return to their assigned seat when becoming active
**Plans:** 3/3 plans complete

Plans:
- [x] 08-01-PLAN.md — Animation constants consolidation + character FSM updates
- [x] 08-02-PLAN.md — Gateway bridge enhancement + spawn/despawn wiring
- [x] 08-03-PLAN.md — Renderer additions + drag-to-reassign interaction

### Phase 9: Interaction + Persistence
**Goal**: Users can click characters to select agents, navigate the office with pan/zoom, see status labels, and have all layout state persist across reloads
**Depends on**: Phase 8
**Requirements**: INTR-01, INTR-02, INTR-03, INTR-04, INTR-05, PERS-01, PERS-02, PERS-03, PERS-04
**Success Criteria** (what must be TRUE):
  1. Clicking a pixel character selects the corresponding agent in the sidebar, with a white pixel-outline highlight around the selected character
  2. Mouse wheel zooms with world-space pivot preservation at integer zoom levels 1-8x, and left-click drag pans the viewport with grab/grabbing cursor
  3. Active characters display a status label showing the current tool name above them
  4. Pixel office layout, zoom level, pan position, seat assignments, and view mode preference all persist across page reloads via localStorage
**Plans**: TBD
**UI hint**: yes

### Phase 10: PixiJS Renderer Migration
**Goal**: The pixel office renders entirely through PixiJS instead of Canvas 2D, reusing the existing workshop PixiJS Application for GPU-accelerated sprite batching
**Depends on**: Phase 9
**Requirements**: PIXI-01, PIXI-02, PIXI-03, PIXI-04, PIXI-05, PIXI-06, PIXI-07
**Success Criteria** (what must be TRUE):
  1. Tile grid, furniture, and characters all render as PixiJS Sprites (TilingSprite for grid, Sprite with z-sorting for furniture, AnimatedSprite for characters) instead of Canvas 2D draw calls
  2. The pixel office runs within the existing workshop PixiJS Application -- no separate canvas element is created
  3. Rendering remains pixel-perfect with nearest-neighbor scaling at all integer zoom levels
  4. The office maintains 60fps with 10+ agents visible at zoom level 4
**Plans**: TBD

### Phase 11: Layout Editor
**Goal**: Users can customize their pixel office layout by placing furniture, painting floors and walls, with full undo/redo support
**Depends on**: Phase 10
**Requirements**: EDIT-01, EDIT-02, EDIT-03, EDIT-04, EDIT-05, EDIT-06
**Success Criteria** (what must be TRUE):
  1. Toggling edit mode allows dragging furniture to new tile positions and placing new furniture from a catalog palette
  2. Users can paint floor tiles with pattern and color choices, and paint or erase wall tiles
  3. All editor operations support undo/redo with a 50-level history stack
  4. A grid overlay showing tile boundaries is visible when edit mode is active
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 8 → 9 → 10 → 11

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Tab Layout and Save Infrastructure | v1.0 | 3/3 | Complete | 2026-03-12 |
| 2. Cards and Field Widgets | v1.0 | 0/0 | Deferred | - |
| 3. Discovery and Overrides | v1.0 | 0/0 | Deferred | - |
| 4. Setup Wizard | v1.0 | 0/0 | Deferred | - |
| 5. State Architecture Refactor | v2.0 | 1/1 | Complete | 2026-03-19 |
| 6. Critical Code Fixes | v2.0 | 3/3 | Complete | 2026-03-19 |
| 7. Validation UX | v2.0 | 3/3 | Complete | 2026-03-19 |
| 8. Character Animation + Gateway Bridge | v3.0 | 3/3 | Complete   | 2026-03-23 |
| 9. Interaction + Persistence | v3.0 | 0/? | Not started | - |
| 10. PixiJS Renderer Migration | v3.0 | 0/? | Not started | - |
| 11. Layout Editor | v3.0 | 0/? | Not started | - |
