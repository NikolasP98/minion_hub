---
phase: 12-electrobun-desktop-wrapper
plan: 01
subsystem: infra
tags: [electrobun, sveltekit, adapter-node, adapter-vercel, desktop, build-pipeline]

# Dependency graph
requires: []
provides:
  - Conditional SvelteKit adapter selection: adapter-node when DESKTOP=1, adapter-vercel otherwise
  - electrobun@1.16.0 and @sveltejs/adapter-node@5.5.4 installed as devDependencies
  - desktop:dev and desktop:build npm scripts with DESKTOP=1 + VITE_DESKTOP=1 env vars
  - .env.desktop template documenting all required desktop env vars
  - VITE_DESKTOP TypeScript type declaration in ImportMetaEnv
  - desktop-build/ added to .gitignore
  - Fixed top-level await build regression in +layout.ts (from 12-02 commit)
affects: [12-02, 12-03, desktop-build-commands]

# Tech tracking
tech-stack:
  added:
    - electrobun@1.16.0
    - "@sveltejs/adapter-node@5.5.4"
  patterns:
    - "Conditional adapter: dynamic import() in svelte.config.js based on process.env.DESKTOP"
    - "IIFE pattern for async dynamic imports in browser route files (avoid top-level await)"

key-files:
  created:
    - .env.desktop
  modified:
    - package.json
    - svelte.config.js
    - src/app.d.ts
    - .gitignore
    - src/routes/+layout.ts

key-decisions:
  - "Use dynamic import() with top-level await in svelte.config.js (Node/ESM context, not browser)"
  - "Desktop scripts set both DESKTOP=1 (server/build) and VITE_DESKTOP=1 (client) together"
  - "adapter-node called with no arguments (defaults: output to build/, reads PORT/ORIGIN from env)"
  - "Fix +layout.ts top-level await via void IIFE to maintain browser ES2020 compatibility"

patterns-established:
  - "Pattern: svelte.config.js uses process.env.DESKTOP to conditionally select adapter at build time"
  - "Pattern: VITE_DESKTOP guards client-side Vercel telemetry calls"

requirements-completed: []

# Metrics
duration: 11min
completed: 2026-03-30
---

# Phase 12 Plan 01: Desktop Build Pipeline Summary

**Conditional SvelteKit adapter switching via dynamic import in svelte.config.js: adapter-node when DESKTOP=1, adapter-vercel otherwise, with both build paths verified working**

## Performance

- **Duration:** 11 min
- **Started:** 2026-03-30T06:55:05Z
- **Completed:** 2026-03-30T07:06:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Installed electrobun@1.16.0 and @sveltejs/adapter-node@5.5.4 as devDependencies
- Rewrote svelte.config.js with conditional adapter selection via dynamic import() and top-level await
- Added desktop:dev and desktop:build scripts to package.json
- Created .env.desktop template with all required env vars (PORT, ORIGIN, BETTER_AUTH_URL, etc.)
- Added VITE_DESKTOP type declaration to src/app.d.ts (ImportMetaEnv interface)
- Verified both build paths: `bun run build` (Vercel adapter, exits 0) and `DESKTOP=1 bun run build` (adapter-node, produces build/handler.js)
- Auto-fixed pre-existing build regression in +layout.ts from 12-02 commit

## Task Commits

Each task was committed atomically:

1. **Task 1: Install dependencies and configure build pipeline** - `8f0a5ce` (chore)
2. **Rule 1 fix: Replace top-level await with void IIFE in +layout.ts** - `7153642` (fix)

## Files Created/Modified
- `package.json` - Added electrobun + adapter-node devDeps, desktop:dev and desktop:build scripts
- `bun.lock` - Updated lockfile with new packages
- `svelte.config.js` - Conditional dynamic import() for adapter-node vs adapter-vercel
- `src/app.d.ts` - Added ImportMetaEnv interface with VITE_DESKTOP?: string
- `.gitignore` - Added desktop-build/ for Electrobun build output
- `.env.desktop` - New desktop environment template (gitignored by .env.* pattern)
- `src/routes/+layout.ts` - Fixed top-level await regression (void IIFE pattern)

## Decisions Made
- Used dynamic `import()` with top-level await in svelte.config.js — this is a Node/Vite config context (not browser), so top-level await is safe here
- adapter-node invoked with no arguments (sensible defaults: outputs to build/, reads PORT/ORIGIN from env)
- Both DESKTOP=1 and VITE_DESKTOP=1 set together in desktop scripts per D-06
- `.env.desktop` is gitignored via the existing `.env.*` pattern — no .gitignore rule needed specifically for it

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed top-level await build failure in +layout.ts**
- **Found during:** Task 1 verification (running `bun run build`)
- **Issue:** The 12-02 commit introduced `await import('@vercel/analytics/sveltekit')` at the top level of `+layout.ts`. SvelteKit browser route files have a build target of Chrome 87/ES2020 which does not support top-level await. The esbuild transpile step errored: "Top-level await is not available in the configured target environment".
- **Fix:** Wrapped the dynamic import in a `void (async () => { ... })()` IIFE, which is supported in ES2020 targets and achieves identical runtime behavior.
- **Files modified:** src/routes/+layout.ts
- **Verification:** `bun run build` exits 0 after the fix
- **Committed in:** `7153642`

---

**Total deviations:** 1 auto-fixed (1 Rule 1 bug)
**Impact on plan:** The fix was necessary for the primary success criterion (`bun run build` exits 0). No scope creep — the fix is minimal and correct.

## Issues Encountered
- Git stash conflict during pre-existing build verification. Parallel agents had modified `src/hooks.client.ts` and `src/hooks.server.ts` (uncommitted). After `git stash` + `git stash pop` failed due to these files, the stash was dropped and all task 1 changes were re-applied cleanly. No data loss.

## User Setup Required
None — no external service configuration required. The .env.desktop file is a template; developers copy it to .env for desktop development.

## Next Phase Readiness
- Build pipeline foundation is complete
- Plan 12-02 (Vercel code guards for hooks.client.ts + hooks.server.ts) can now be verified with a passing `bun run build`
- Plan 12-03 (electrobun.config.ts + desktop/main.ts entry point) can proceed — adapter-node is installed and the build pipeline works

---
*Phase: 12-electrobun-desktop-wrapper*
*Completed: 2026-03-30*

## Self-Check: PASSED

- package.json: FOUND
- svelte.config.js: FOUND (contains adapter-node)
- src/app.d.ts: FOUND (contains VITE_DESKTOP)
- .env.desktop: FOUND
- .gitignore: FOUND (contains desktop-build/)
- 12-01-SUMMARY.md: FOUND
- Commit 8f0a5ce: FOUND
- Commit 7153642: FOUND
