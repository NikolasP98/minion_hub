---
phase: 06
slug: critical-code-fixes
status: draft
nyquist_compliant: false
wave_0_complete: false
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

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | CFIX-01 | manual/review | code review only | N/A | ⬜ pending |
| 06-01-02 | 01 | 1 | CFIX-02 | unit | `bun run vitest run src/routes/api/builder/ai/suggest-skill/suggest-skill.test.ts` | ❌ W0 | ⬜ pending |
| 06-01-03 | 01 | 1 | CFIX-05 | unit | `bun run vitest run src/routes/api/builder/ai/suggest-skill/suggest-skill.test.ts` | ❌ W0 | ⬜ pending |
| 06-01-04 | 01 | 1 | CFIX-07 | unit | `bun run vitest run src/routes/api/builder/ai/suggest-skill/suggest-skill.test.ts` | ❌ W0 | ⬜ pending |
| 06-01-05 | 01 | 1 | CFIX-03 | unit | `bun run vitest run src/routes/api/builder/ai/suggest-skill/suggest-skill.test.ts` | ❌ W0 | ⬜ pending |
| 06-01-06 | 01 | 1 | CFIX-10 | unit | `bun run vitest run src/routes/api/builder/ai/suggest-skill/suggest-skill.test.ts` | ❌ W0 | ⬜ pending |
| 06-02-01 | 02 | 1 | CFIX-04 | unit | `bun run vitest run src/server/services/builder.service.test.ts` | ❌ W0 | ⬜ pending |
| 06-02-02 | 02 | 1 | CFIX-08 | unit | `bun run vitest run src/server/services/builder.service.test.ts` | ❌ W0 | ⬜ pending |
| 06-02-03 | 02 | 1 | CFIX-09 | unit | `bun run vitest run src/server/services/builder.service.test.ts` | ❌ W0 | ⬜ pending |
| 06-03-01 | 03 | 1 | CFIX-06 | unit | `bun run vitest run src/lib/state/builder/skill-editor.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/server/services/builder.service.test.ts` — stubs for CFIX-04, CFIX-08, CFIX-09
- [ ] `src/routes/api/builder/ai/suggest-skill/suggest-skill.test.ts` — stubs for CFIX-02, CFIX-03, CFIX-05, CFIX-07, CFIX-10
- [ ] `src/lib/state/builder/skill-editor.test.ts` — stubs for CFIX-06

*Existing test infrastructure covers framework needs — no new framework install required.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SYSTEM_PROMPT no longer says "DAG" for acyclic constraint | CFIX-01 | Prompt text review | Verify SYSTEM_PROMPT in suggest-skill endpoint no longer claims output must be acyclic |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
