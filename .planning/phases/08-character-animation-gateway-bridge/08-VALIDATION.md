---
phase: 08
slug: character-animation-gateway-bridge
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-23
---

# Phase 08 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `bun run vitest run --reporter=verbose` |
| **Full suite command** | `bun run test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun run vitest run --reporter=verbose`
- **After every plan wave:** Run `bun run test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | ANIM-01 | unit | `bun run vitest run` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ANIM-02 | unit | `bun run vitest run` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ANIM-03 | unit | `bun run vitest run` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ANIM-04 | unit | `bun run vitest run` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ANIM-05 | unit | `bun run vitest run` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ANIM-06 | unit | `bun run vitest run` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | GATE-01 | unit | `bun run vitest run` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | GATE-02 | unit | `bun run vitest run` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | GATE-03 | unit | `bun run vitest run` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | GATE-04 | unit | `bun run vitest run` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | GATE-05 | unit | `bun run vitest run` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | GATE-06 | unit | `bun run vitest run` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Test stubs for ANIM-01 through ANIM-06 (animation state machine, walk cycle, typing/reading, spawn/despawn effects)
- [ ] Test stubs for GATE-01 through GATE-06 (gateway bridge tool events, presence sync, CRT monitor state, bubbles)
- [ ] Shared test fixtures for mock gateway presence data and canvas state

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Walk animation visual smoothness | ANIM-01 | Canvas rendering requires visual inspection | Open pixel office, observe character walking between tiles — 4 frames should be visible |
| Matrix spawn/despawn effect | ANIM-05 | Visual effect timing | Connect/disconnect agent, observe green rain effect on character tile |
| CRT monitor glow ON state | GATE-04 | Canvas visual state | Seat agent, start typing, verify monitor sprite switches to glow state |
| Permission/done bubbles | GATE-05 | Canvas overlay position | Trigger permission state, verify amber bubble appears above character head |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
