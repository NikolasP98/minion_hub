---
phase: 7
slug: validation-ux
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-19
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | `vite.config.ts` (vitest plugin) |
| **Quick run command** | `bun run vitest run src/lib/utils/skill-validation.test.ts` |
| **Full suite command** | `bun run test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun run vitest run src/lib/utils/skill-validation.test.ts`
- **After every plan wave:** Run `bun run test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 0 | VALID-04 | unit | `bun run vitest run src/lib/utils/skill-validation.test.ts` | ❌ W0 | ⬜ pending |
| 07-01-02 | 01 | 1 | VALID-04 | unit | `bun run vitest run src/lib/utils/skill-validation.test.ts` | ❌ W0 | ⬜ pending |
| 07-02-01 | 02 | 1 | VALID-01, VALID-02 | manual | — | — | ⬜ pending |
| 07-02-02 | 02 | 1 | VALID-03 | manual | — | — | ⬜ pending |
| 07-02-03 | 02 | 1 | VALID-05 | manual | — | — | ⬜ pending |
| 07-03-01 | 03 | 2 | A11Y-01 | manual | — | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/utils/skill-validation.test.ts` — stubs for VALID-04 (shared validation module)
- [ ] `src/lib/utils/skill-validation.ts` — pure validation function module

*Framework and test infrastructure already exists.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Publish button disabled with tooltip when errors exist | VALID-01 | DOM interaction + CSS state | Open skill with missing chapter tools → verify button is grayed, cursor is not-allowed, tooltip shows error count |
| Validation panel shows per-chapter grouped errors with Fix button | VALID-02 | UI layout + navigation | Open skill with multiple chapter errors → verify panel groups errors by chapter name → click Fix → verify chapter editor opens |
| Warning-only publish shows "Publish Anyway" in panel footer | VALID-03, VALID-05 | UI flow + state transition | Create skill with warnings but no errors → click Publish → verify panel opens with "Publish Anyway" button |
| Toasts replace error banner for server errors | VALID-03 | UI integration | Trigger a server-side publish error → verify Zag.js toast appears (not banner) |
| All modals have role="dialog" with aria-labelledby | A11Y-01 | DOM attributes | Open chapter editor, condition editor, delete modal → inspect each for role="dialog" on modal element + aria-labelledby on title |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
