---
phase: 12-electrobun-desktop-wrapper
plan: "02"
subsystem: analytics-guards
tags: [desktop, vercel, posthog, guards, telemetry]
dependency_graph:
  requires: []
  provides: [desktop-mode-analytics-guards]
  affects: [src/routes/+layout.svelte, src/routes/+layout.ts, src/hooks.client.ts, src/hooks.server.ts]
tech_stack:
  added: []
  patterns: [VITE_DESKTOP env guard, dynamic import() for tree-shaking, early return guard]
key_files:
  created: []
  modified:
    - src/routes/+layout.svelte
    - src/routes/+layout.ts
    - src/hooks.client.ts
    - src/hooks.server.ts
decisions:
  - "D-07: Vercel call sites guarded in +layout.svelte (static imports preserved for tree-shaking); dynamic import() used in +layout.ts (valid ESM module)"
  - "D-08: posthog-js and PUBLIC_POSTHOG env vars moved inside init() behind VITE_DESKTOP early return; top-level imports eliminated to prevent build failure when env vars absent in desktop builds"
  - "D-09: posthogProxyHandle returns resolve(event) immediately when env.DESKTOP === '1'"
metrics:
  duration: "~8 minutes"
  completed: "2026-03-30T07:03:40Z"
  tasks_completed: 2
  files_modified: 4
---

# Phase 12 Plan 02: Telemetry Guards for Desktop Mode Summary

Conditional guards added to all four Vercel/PostHog integration points so desktop builds skip analytics/telemetry services that are irrelevant (and would error) in a local desktop context. Normal web builds are completely unaffected.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Guard Vercel imports in +layout.svelte and +layout.ts | 9f228bf | src/routes/+layout.svelte, src/routes/+layout.ts |
| 2 | Guard PostHog in hooks.client.ts and hooks.server.ts | d547391 | src/hooks.client.ts, src/hooks.server.ts |

## What Was Built

### Task 1: Vercel Analytics Guards

**`src/routes/+layout.svelte`** — Static imports for `@vercel/speed-insights/sveltekit` and `@vercel/analytics` are preserved at the top of the `<script>` block (required in Svelte 5 instance scripts, which cannot use top-level `await`). The function call sites `injectSpeedInsights()` and `injectAnalytics()` are wrapped in an `if (!import.meta.env.VITE_DESKTOP)` guard. Vite statically replaces `import.meta.env.VITE_DESKTOP` at build time; when set, the calls become dead code and are tree-shaken.

**`src/routes/+layout.ts`** — This is a standard ESM module (not a Svelte instance script), so top-level `await` is valid. Replaced the static `import { injectAnalytics }` with a dynamic `await import('@vercel/analytics/sveltekit')` inside the `VITE_DESKTOP` guard. This prevents the Vercel analytics module from being required at all in desktop builds.

### Task 2: PostHog Guards

**`src/hooks.client.ts`** — The key challenge (Pitfall 3 from RESEARCH.md): `PUBLIC_POSTHOG_KEY` and `PUBLIC_POSTHOG_HOST` from `$env/static/public` are evaluated at build time. If those env vars are absent in a desktop build, the build fails even if the PostHog code is behind a runtime guard. Solution: moved both the `posthog-js` import and the `$env/static/public` import inside `init()` as dynamic imports, behind the `VITE_DESKTOP` early return. Also guarded `handleError`'s `captureException` call.

**`src/hooks.server.ts`** — Added a single early-return line at the top of `posthogProxyHandle`: `if (env.DESKTOP === '1') return resolve(event)`. The `env` import from `$env/dynamic/private` was already present. No other changes to the file.

## Verification Results

All acceptance criteria met:

1. `grep -c 'VITE_DESKTOP' src/routes/+layout.svelte` → 1 ✓
2. `grep -c 'VITE_DESKTOP' src/routes/+layout.ts` → 1 ✓
3. `grep -c 'VITE_DESKTOP' src/hooks.client.ts` → 2 ✓
4. `grep -c 'DESKTOP' src/hooks.server.ts` → 1 (the new posthogProxyHandle guard) ✓
5. Static imports `injectSpeedInsights` and `injectAnalytics` preserved in +layout.svelte ✓
6. No top-level `import posthog from 'posthog-js'` in hooks.client.ts ✓
7. No top-level `import { PUBLIC_POSTHOG_KEY` in hooks.client.ts ✓
8. `bun run check` reports 0 errors in any of the four modified files ✓

Note: `bun run build` fails with a pre-existing `codeSplitting` rollup config error and PostHog network timeout — confirmed pre-existing by testing against the unmodified baseline with `git stash`. Not caused by this plan's changes.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- src/routes/+layout.svelte — modified, guards present ✓
- src/routes/+layout.ts — modified, dynamic import guard present ✓
- src/hooks.client.ts — modified, early return + dynamic imports present ✓
- src/hooks.server.ts — modified, DESKTOP early return present ✓
- Commit 9f228bf exists ✓
- Commit d547391 exists ✓
