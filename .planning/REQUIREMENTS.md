# Requirements: Pixel Office (v3.0)

**Defined:** 2026-03-23
**Core Value:** Agents are visualized as pixel art characters in a virtual office, driven by real-time gateway data, with GPU-accelerated rendering.

## v1 Requirements

Requirements for v3.0 milestone. Each maps to roadmap phases.

### Character Animation

- [x] **ANIM-01**: Characters play 4-frame walk animation when wandering between tiles
- [x] **ANIM-02**: Characters play 2-frame typing animation when agent is conversing/writing
- [x] **ANIM-03**: Characters play 2-frame reading animation when agent is reading files
- [x] **ANIM-04**: Characters wander via BFS pathfinding on tile grid when idle (respecting furniture walkability)
- [x] **ANIM-05**: Characters return to assigned seat when agent becomes active
- [x] **ANIM-06**: Matrix digital rain effect plays on agent spawn/despawn (0.3s)

### Gateway Integration

- [x] **GATE-01**: Workshop agent FSM states (conversing, reading, idle, wandering) drive pixel character isActive and currentTool
- [x] **GATE-02**: Agent connect/disconnect adds/removes pixel characters with spawn/despawn effects
- [x] **GATE-03**: Agent tool activity (Write/Edit/Bash vs Read/Grep/Glob) maps to typing vs reading animation
- [x] **GATE-04**: CRT monitors auto-switch to ON sprite when agent actively types at that desk
- [x] **GATE-05**: Permission bubble (amber dots) shows when agent waits for user approval
- [x] **GATE-06**: Waiting bubble (green checkmark) shows when agent is idle after task completion

### Interaction

- [ ] **INTR-01**: Click a pixel character to select the corresponding agent in the sidebar
- [ ] **INTR-02**: Mouse wheel zoom with world-space pivot preservation (integer zoom 1-8x)
- [ ] **INTR-03**: Left-click drag pans the viewport with grab/grabbing cursor
- [ ] **INTR-04**: Status label shows current tool name above active characters
- [ ] **INTR-05**: Character selection shows white pixel-outline around selected character

### PixiJS Migration

- [ ] **PIXI-01**: Replace Canvas 2D tile grid rendering with PixiJS TilingSprite or Sprite batching
- [ ] **PIXI-02**: Convert SpriteData (string[][] hex arrays) to PixiJS Textures via offscreen canvas → PIXI.Texture
- [ ] **PIXI-03**: Render furniture as PixiJS Sprites with z-sorting via sortableChildren + zIndex
- [ ] **PIXI-04**: Render characters as PixiJS AnimatedSprite with frame-based animation
- [ ] **PIXI-05**: Reuse existing workshop PixiJS Application instead of creating separate Canvas 2D element
- [ ] **PIXI-06**: Maintain pixel-perfect rendering (nearest-neighbor scaling, integer zoom)
- [ ] **PIXI-07**: Performance: 60fps with 10+ agents at zoom level 4

### Persistence

- [ ] **PERS-01**: Pixel office layout saved to localStorage per host (auto-save with debounce)
- [ ] **PERS-02**: Zoom level and pan position persist across page reloads
- [ ] **PERS-03**: Character seat assignments persist across mode switches
- [ ] **PERS-04**: View mode preference (classic/habbo/pixel) persists (already working)

### Layout Editor

- [ ] **EDIT-01**: Toggle edit mode to drag furniture to new positions
- [ ] **EDIT-02**: Place new furniture from catalog palette
- [ ] **EDIT-03**: Paint floor tiles with pattern + color picker
- [ ] **EDIT-04**: Paint/erase wall tiles
- [ ] **EDIT-05**: Undo/redo for all editor operations (50-level stack)
- [ ] **EDIT-06**: Grid overlay shows tile boundaries in edit mode

## v2 Requirements (Future)

### Advanced Features

- **ADV-01**: Layout export/import (JSON file download/upload)
- **ADV-02**: Multiple office layouts (switch between saved layouts)
- **ADV-03**: Custom character sprite upload
- **ADV-04**: Conversation ropes between agents (visual connection lines during multi-agent chat)
- **ADV-05**: Activity sparkline per desk (from existing agentActivity spark-bins)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Physics simulation | Pixel office uses tile-grid movement, not continuous physics — Rapier2D unnecessary |
| Isometric projection | Pixel office is top-down 2D, not isometric — habbo mode handles that |
| Sound notifications | Deferred — no audio pipeline in hub yet |
| Mobile touch controls | Desktop-first, workshop not used on mobile |
| Custom furniture PNG upload | Complex asset pipeline, defer to v4 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ANIM-01 | Phase 8 | Complete |
| ANIM-02 | Phase 8 | Complete |
| ANIM-03 | Phase 8 | Complete |
| ANIM-04 | Phase 8 | Complete |
| ANIM-05 | Phase 8 | Complete |
| ANIM-06 | Phase 8 | Complete |
| GATE-01 | Phase 8 | Complete |
| GATE-02 | Phase 8 | Complete |
| GATE-03 | Phase 8 | Complete |
| GATE-04 | Phase 8 | Complete |
| GATE-05 | Phase 8 | Complete |
| GATE-06 | Phase 8 | Complete |
| INTR-01 | Phase 9 | Pending |
| INTR-02 | Phase 9 | Pending |
| INTR-03 | Phase 9 | Pending |
| INTR-04 | Phase 9 | Pending |
| INTR-05 | Phase 9 | Pending |
| PERS-01 | Phase 9 | Pending |
| PERS-02 | Phase 9 | Pending |
| PERS-03 | Phase 9 | Pending |
| PERS-04 | Phase 9 | Pending |
| PIXI-01 | Phase 10 | Pending |
| PIXI-02 | Phase 10 | Pending |
| PIXI-03 | Phase 10 | Pending |
| PIXI-04 | Phase 10 | Pending |
| PIXI-05 | Phase 10 | Pending |
| PIXI-06 | Phase 10 | Pending |
| PIXI-07 | Phase 10 | Pending |
| EDIT-01 | Phase 11 | Pending |
| EDIT-02 | Phase 11 | Pending |
| EDIT-03 | Phase 11 | Pending |
| EDIT-04 | Phase 11 | Pending |
| EDIT-05 | Phase 11 | Pending |
| EDIT-06 | Phase 11 | Pending |

**Coverage:**
- v1 requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0

---
*Requirements defined: 2026-03-23*
*Last updated: 2026-03-23 after roadmap creation*
