---
gsd_state_version: 1.0
milestone: v3.0
milestone_name: Pixel Office
status: defining-requirements
stopped_at: Milestone v3.0 started — requirements defined, creating roadmap
last_updated: "2026-03-23"
last_activity: 2026-03-23
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-23)

**Core value:** Agents are visualized as pixel art characters in a virtual office, driven by real-time gateway data, with GPU-accelerated rendering.
**Current focus:** Defining requirements for v3.0 Pixel Office

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-03-23 — Milestone v3.0 started

## Accumulated Context

### From previous milestones (v2.0)
- Workshop canvas uses PixiJS 8 + Rapier2D physics with renderer-adapter pattern (classic/habbo/pixel)
- Pixel office engine ported from pixel-agents: 15 modules (4,200+ lines) in src/lib/workshop/pixel/
- Asset loader fetches floor tiles, wall tiles, furniture, character sprites from /pixel-office/ static dir
- Canvas 2D rendering works with auto-zoom, auto-center, pan/zoom interaction
- Gateway bridge module (gateway-pixel-bridge.ts) maps workshop instanceId ↔ pixel charId
- dt clamping bug fixed in simulation.ts (was missing, caused agent teleportation)
- Furniture catalog auto-generated from nested manifests (furniture-catalog.json)
- isDesk bug fixed — desks category now properly marked, surface items z-sort correctly

### Key technical decisions
- Canvas 2D → will migrate to PixiJS for GPU batching (same PixiJS app as classic/habbo modes)
- BFS pathfinding uses integer keys (col + row * MAX_COLS) instead of string keys
- Character sprites loaded from PNGs via browser Image + Canvas → SpriteData → offscreen canvas cache
- Pixel canvas is a sibling of PixiJS div with absolute inset-0 z-10 overlay
