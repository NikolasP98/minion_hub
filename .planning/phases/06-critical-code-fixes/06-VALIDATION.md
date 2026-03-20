---
phase: 06
slug: critical-code-fixes
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-19
---

# Phase 06 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (existing) |
| **Config file** | `vite.config.ts` (inline test config via `defineConfig`) |
| **Quick run command** | `bun run vitest run src/server/services/builder.service.test.ts` |
| **Full suite command** | `bun run test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun run vitest run src/server/services/builder.service.test.ts`
- **After every plan wave:** Run `bun run test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 06-01-01 | 01 | 1 | CFIX-01 | grep | `grep -c 'directed graph' src/routes/api/builder/ai/suggest-skill/+server.ts` | ⬜ pending |
| 06-01-02 | 01 | 1 | CFIX-02 | grep | `grep -c 'anyOf' src/routes/api/builder/ai/suggest-skill/+server.ts` | ⬜ pending |
| 06-01-03 | 01 | 1 | CFIX-05 | grep | `grep -c 'completion.error' src/routes/api/builder/ai/suggest-skill/+server.ts` | ⬜ pending |
| 06-01-04 | 01 | 1 | CFIX-07 | grep | `grep -c 'skill_name' src/routes/api/builder/ai/suggest-skill/+server.ts` | ⬜ pending |
| 06-01-05 | 01 | 1 | CFIX-03 | grep | `grep -c 'availableSet' src/routes/api/builder/ai/suggest-skill/+server.ts` | ⬜ pending |
| 06-01-06 | 01 | 1 | CFIX-10 | grep | `grep -c 'MODEL_PRICE_TABLE' src/routes/api/builder/ai/suggest-skill/+server.ts` | ⬜ pending |
| 06-02-01 | 02 | 1 | CFIX-04 | unit | `bun run vitest run src/server/services/builder.service.test.ts` | ⬜ pending |
| 06-02-02 | 02 | 1 | CFIX-08 | unit | `bun run vitest run src/server/services/builder.service.test.ts` | ⬜ pending |
| 06-02-03 | 02 | 1 | CFIX-09 | unit | `bun run vitest run src/server/services/builder.service.test.ts` | ⬜ pending |
| 06-03-01 | 03 | 1 | CFIX-06 | grep | `grep -c 'Cannot publish' src/lib/state/builder/skill-editor.svelte.ts` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/server/services/builder.service.test.ts` — stubs for CFIX-04, CFIX-08, CFIX-09

Plan 02 (Task 1) creates this test file as part of its TDD workflow. Plans 01 and 03 use grep-based verification — no test files required.

*Existing test infrastructure covers framework needs — no new framework install required.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SYSTEM_PROMPT no longer says "DAG" for acyclic constraint | CFIX-01 | Prompt text review | Verify SYSTEM_PROMPT in suggest-skill endpoint no longer claims output must be acyclic |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved
