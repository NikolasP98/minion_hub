# Task 1 Report: `build-graph.ts` — Pure Graph Builder

**Status: DONE**

## What Was Built

Implemented the first phase of the `/overview` org graph redesign: a pure TypeScript graph-building module that converts component props into a normalized node/edge representation with precomputed target anchors.

### Files Created

1. **`src/lib/components/overview/graph/build-graph.ts`** (374 lines)
   - Pure function `buildGraph(input: BuildInput): { nodes: GraphNode[]; edges: GraphEdge[] }`
   - Type exports: `NodeKind`, `GraphNode`, `GraphEdge`, `BuildInput`
   - Helper exports: `RADII`, `hexToRgba()`, `shade()`
   - No external dependencies beyond existing codebase imports
   - Ports existing `OverviewGraph.svelte` graph logic into testable module

2. **`src/lib/components/overview/graph/build-graph.test.ts`** (89 lines)
   - 6 test cases covering all major graph behaviors:
     - Org node at origin, pinned
     - Each kind anchored on its ring radius
     - Integration nodes (disc+logo collapse)
     - Service account exclusion + shared band
     - Subscription edges (dashed)
     - Unassigned bucket for loose agents

### Architecture

- **Graph structure**: 7 concentric rings (org at center, then shared/area/skill/integration/agent/user outward)
- **Node anchors**: Each node precomputes `(ax, ay)` preserving ring radius and sector angle
- **No new dependencies**: Uses only existing services (`org-areas.service`, `entities`, `lucide-svg`)
- **Type safety**: Full strict TypeScript, no `any`, all tests pass type-check

## TDD Evidence

### Step 1: Test Written & Failed (RED)
```bash
bun run vitest run src/lib/components/overview/graph/build-graph.test.ts
# FAIL: Cannot find module './build-graph'
```

### Step 2: Implementation Complete
- Wrote `build-graph.ts` with full graph logic ported from component
- Fixed test data to use valid integration key ('meta' instead of 'slack')
- Fixed test cases to avoid mutation of base() return values

### Step 3: Tests Pass (GREEN)
```bash
bun run vitest run src/lib/components/overview/graph/build-graph.test.ts
# Test Files  1 passed (1)
# Tests  6 passed (6)
```

### Step 4: Type-Check Clean (REFACTOR)
```bash
bun run check
# COMPLETED 8323 FILES 0 ERRORS 0 WARNINGS
```

### Step 5: Committed
```
f35e1941 feat(overview): pure graph builder with target anchors (d3/pixi redesign)
```

## Self-Review Checklist

- ✅ Matches brief's type signatures exactly (`GraphNode`, `GraphEdge`, `BuildInput`, `buildGraph`)
- ✅ All 6 tests pass with correct semantics
- ✅ No TypeScript errors or warnings
- ✅ No external dependencies added
- ✅ Helper functions exported (`RADII`, `hexToRgba`, `shade`)
- ✅ Strict mode enforcement (no `any`)
- ✅ Integration key validation (filters undefined keys from INTEGRATIONS)
- ✅ Service account handling (separate ring)
- ✅ Subscription edges with dashed flag
- ✅ Unassigned bucket creation for loose agents
- ✅ Test data isolation (no mutation of shared base objects)
- ✅ Commit message includes co-author as specified

## Key Design Decisions

1. **Ring radius constants**: Precomputed `RADII` object for all 7 node kinds, immutable across module
2. **Angle spreading**: Sectors divided proportionally across bucket count; spread() helper within each sector
3. **Integration collapse**: One node per integration key per area (disc + logoImage overlay)
4. **Service accounts**: Own "shared" ring at RADII.shared=150, separate from user ring
5. **Unassigned bucket**: Created only if loose agents/users exist or all areas are empty
6. **Avatar generation**: DiceBear API with area-color tinting for visual sector cohesion

## Test Coverage

| Test | Purpose | Pass |
|---|---|---|
| org at origin | Pinning + anchor (0,0) | ✅ |
| ring radius anchoring | Distance validation for all 7 kinds | ✅ |
| integration disc+logo | Single node with logoImage field | ✅ |
| service exclusion | Service accounts in shared, not users | ✅ |
| subscription edges | Dashed edges from shared→subscriber | ✅ |
| unassigned bucket | Loose agents collected into one area | ✅ |

## Concerns

None. Module is complete, tested, and ready for consumption by Tasks 2-4 (renderer, physics, canvas integration).
