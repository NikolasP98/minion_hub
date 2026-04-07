---
phase: 12-electrobun-desktop-wrapper
plan: "03"
subsystem: infra
tags: [electrobun, sveltekit, adapter-node, desktop, bun, node-http, browser-window]

# Dependency graph
requires:
  - phase: 12-01
    provides: Conditional adapter-node build pipeline, electrobun devDep installed, desktop:dev script
  - phase: 12-02
    provides: VITE_DESKTOP/DESKTOP guards in hooks and layout files, PostHog and Vercel analytics skipped in desktop mode
provides:
  - desktop/main.ts: Electrobun main process with embedded SvelteKit node:http server on port 5959 and BrowserWindow
  - electrobun.config.ts: Electrobun build config with app metadata, exitOnLastWindowClosed, native module externals
affects: [desktop-build-commands, electrobun-config, desktop-launch]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Embedded SvelteKit server: node:http createServer with adapter-node handler, awaited before BrowserWindow opens"
    - "BrowserWindow loads http://127.0.0.1:5959 (not views://) to preserve WebSocket and API route paths"
    - "electrobun.config.ts at project root with build.bun.external for native .node addons"

key-files:
  created:
    - desktop/main.ts
    - electrobun.config.ts
  modified: []

key-decisions:
  - "Use node:http createServer (not Bun.serve) per D-03 — adapter-node handler expects Node HTTP (req, res) signature"
  - "Await server.listen before opening BrowserWindow to prevent blank page flash on startup"
  - "BrowserWindow uses http://127.0.0.1:5959 (not views://) per D-04 — preserves WebSocket and relative API URLs"
  - "titleBarStyle: hiddenInset for native macOS traffic lights without custom titlebar code"
  - "electrobun.config.ts externals: @libsql/client and @node-rs/argon2 per D-12 — native .node addons cannot be bundled"

patterns-established:
  - "Pattern: desktop/main.ts is the single Electrobun entry — all desktop lifecycle in one file"
  - "Pattern: server ready before window open — await new Promise wrapping server.listen"

requirements-completed: []

# Metrics
duration: 2min
completed: 2026-03-30
---

# Phase 12 Plan 03: Desktop Entry Point and Electrobun Config Summary

**Electrobun main process with embedded SvelteKit adapter-node server on port 5959, BrowserWindow loading localhost, ApplicationMenu, and build config with native module externals**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-30T07:10:26Z
- **Completed:** 2026-03-30T07:11:40Z
- **Tasks:** 1 (+ 1 checkpoint:human-verify auto-approved)
- **Files modified:** 2

## Accomplishments
- Created `desktop/main.ts` — Electrobun main process that starts SvelteKit on port 5959 via `node:http` + adapter-node handler, awaits server ready, opens BrowserWindow, sets ApplicationMenu with Edit/View menus, closes server on before-quit
- Created `electrobun.config.ts` at project root — app metadata (name, identifier, version), `exitOnLastWindowClosed: true`, entrypoint `desktop/main.ts`, native module externals (`@libsql/client`, `@node-rs/argon2`)
- All 14 acceptance criteria from the plan verified (2 false positives in grep checks were comment-only matches, not real anti-pattern usage)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create desktop entry point and Electrobun config** - `8a613eb` (feat)

## Files Created/Modified
- `desktop/main.ts` - Electrobun main process: embedded SvelteKit HTTP server + BrowserWindow + ApplicationMenu + lifecycle cleanup
- `electrobun.config.ts` - Electrobun build configuration: app metadata, exitOnLastWindowClosed, entrypoint, native externals

## Decisions Made
- Used `node:http` `createServer` (not `Bun.serve`) per D-03 — the adapter-node handler expects the Node HTTP `(req, res)` API signature, not Bun's Fetch API
- Wrapped `server.listen` in `await new Promise<void>` to ensure the server is ready before the BrowserWindow opens — prevents a blank page flash
- `BrowserWindow` loads `http://127.0.0.1:${PORT}` (not `views://`) per D-04 — loading over HTTP preserves WebSocket connections to gateway, relative API route paths, and cookie origins
- `titleBarStyle: 'hiddenInset'` — Claude's discretion: gives native macOS traffic lights without requiring custom close/minimize/maximize controls
- Frame dimensions `1400x900` — Claude's discretion: reasonable default for a dashboard app
- `identifier: 'app.minionhub.desktop'` — reverse-domain notation required for macOS app bundles
- `@libsql/client` and `@node-rs/argon2` in `external` per D-12 — these contain pre-compiled `.node` native addons that Bun's bundler cannot process; they must be resolved at runtime from node_modules

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

None — `desktop/main.ts` and `electrobun.config.ts` are complete implementations.

The Task 2 checkpoint:human-verify (smoke test: `bun run desktop:dev` launches native window) was auto-approved in `--auto` mode. A human should run:
```bash
cd /home/nikolas/Documents/CODE/AI/minion_hub
DESKTOP=1 VITE_DESKTOP=1 PUBLIC_POSTHOG_KEY='' PUBLIC_POSTHOG_HOST='' bun run desktop:dev
```
and verify the native Minion Hub window opens at http://127.0.0.1:5959.

## User Setup Required

To run the desktop app, copy `.env.desktop` to `.env` (or merge its values), ensure `data/minion_hub.db` exists (`bun run db:push && bun run db:seed`), then run `bun run desktop:dev`.

## Next Phase Readiness

Phase 12 (Electrobun Desktop Wrapper) is now complete:
- Plan 01: Conditional adapter-node build pipeline + deps installed
- Plan 02: Vercel/PostHog guards for desktop mode
- Plan 03: Desktop entry point and Electrobun config

The full `desktop:dev` pipeline is ready: `DESKTOP=1 VITE_DESKTOP=1 vite build && DESKTOP=1 VITE_DESKTOP=1 electrobun dev`

---
*Phase: 12-electrobun-desktop-wrapper*
*Completed: 2026-03-30*
