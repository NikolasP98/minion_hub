# Task 2 Fix Report: Link Rest-Length = Ring-Radius Gap

**Status: DONE**

## Changes Applied

### File: `src/lib/components/overview/graph/simulation.ts` (lines 85-88)

**Before:**
```typescript
.force('link', forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(60).strength(LINK_STRENGTH))
```

**After:**
```typescript
.force('link', forceLink<SimNode, SimLink>(links).id((d) => d.id).distance((l) => {
  const s = l.source as SimNode;
  const t = l.target as SimNode;
  return Math.abs(s.radius - t.radius) || 60;
}).strength(LINK_STRENGTH))
```

**Rationale:** Link rest length now equals the natural gap between endpoint ring radii, so edges exert ~zero tension at intended layout. Anchor springs (ANCHOR_STRENGTH=0.08) now control settlement without edge tension fighting against them.

### File: `src/lib/components/overview/graph/simulation.test.ts` (line 20)

**Before:**
```typescript
const settle = (sim: ReturnType<typeof createSimulation>, n = 1000) => {
```

**After:**
```typescript
const settle = (sim: ReturnType<typeof createSimulation>, n = 400) => {
```

## Test Results

### Focused Test Run
```bash
bun run vitest run src/lib/components/overview/graph/simulation.test.ts
```

**Output:**
```
 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  12:31:39
   Duration  8.38s
```

All 3 tests PASS at ANCHOR_STRENGTH=0.08 with settle=400.

### Area Node Offset Measurement
```
Offset distance: 0.15px
Anchor: (0.00, -300.00)
Position: (0.00, -299.85)
Expected: < 80px (tolerance)
PASS: ✅
```

The area node now settles just **0.15 pixels** from its anchor — far exceeding the 80px tolerance requirement.

## Configuration Verification

- ✅ ANCHOR_STRENGTH = 0.08 (unchanged, as required)
- ✅ settle default = 400 (as required)
- ✅ LINK_STRENGTH = 0.05 (unchanged)
- ✅ All other constants unchanged (COLLIDE_PAD, WEAK_REPULSION, WANDER_*, BREATHE_ALPHA, DRAG_ALPHA)

## Check Result

```bash
bun run check
```

**Output:**
```
1781717442882 START "/home/nikolas/Documents/CODE/MINION/minion_hub/.worktrees/overview-graph-fluid"
1781717442912 COMPLETED 8326 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

✅ **0 errors, 0 warnings**

## Commit

```
0ce058c9 fix(overview): link rest-length = ring-radius gap so edges don't collapse rings (task-2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

Branch: `feature/overview-graph-fluid`
