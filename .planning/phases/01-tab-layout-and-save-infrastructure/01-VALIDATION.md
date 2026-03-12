---
phase: 1
slug: tab-layout-and-save-infrastructure
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.0.18 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `bun run vitest run src/lib/state/config/config-restart.test.ts` |
| **Full suite command** | `bun run test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun run vitest run src/lib/state/config/config-restart.test.ts`
- **After every plan wave:** Run `bun run test`
- **Before `/gsd:verify-work`:** `bun run test` + `bun run check` must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | LAYOUT-01 | unit | `bun run vitest run src/lib/utils/config-schema.test.ts` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | LAYOUT-01 | unit | `bun run vitest run src/lib/utils/config-schema.test.ts` | ❌ W0 | ⬜ pending |
| 01-01-03 | 01 | 1 | LAYOUT-04, LAYOUT-05 | manual | Verify skeleton loading + theme consistency | N/A | ⬜ pending |
| 01-02-01 | 02 | 1 | INTG-01, INTG-02 | unit | `bun run vitest run src/lib/state/config/config-restart.test.ts` | ✅ | ⬜ pending |
| 01-02-02 | 02 | 1 | SAVE-02, SAVE-03 | unit | `bun run vitest run src/lib/utils/config-schema.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-03 | 02 | 1 | PLSH-01 | unit | `bun run vitest run src/lib/state/config/config-restart.test.ts` | ✅ | ⬜ pending |
| 01-02-04 | 02 | 1 | PLSH-03 | manual | Disconnect → edit → reconnect → verify auto-save | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/utils/config-schema.test.ts` — covers LAYOUT-01 (tab count/order assertions, channels merged into comms) and SAVE-02/SAVE-03 (dirty path computation edge cases). Pure function tests — no mocking needed.

*Existing `config-restart.test.ts` covers INTG-02 and PLSH-01 restart state machine transitions.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Tab visibility switching preserves scroll position | LAYOUT-01, LAYOUT-05 | DOM/CSS visibility behavior — no component test infra | Switch between tabs → verify scroll position preserved per-tab |
| Loading skeleton appears while config loads | LAYOUT-04 | Component rendering behavior | Refresh settings page → observe skeleton → config loads |
| Navigation guard modal (Save/Discard/Cancel) | SAVE-03 | Modal + `beforeNavigate` interaction | Edit config → navigate away → verify modal appears with 3 buttons |
| Restart toast with auto-dismiss | PLSH-01 | Toast timing + reconnect wiring | Save restart-triggering config → verify persistent toast → auto-dismiss on reconnect |
| Auto-save on reconnect (non-restart) | PLSH-03 | Component behavior + WebSocket state | Disconnect with dirty changes → reconnect → verify auto-save fires only when idle |
| Ctrl/Cmd+S keyboard shortcut | SAVE-02 | Keyboard event + save bar interaction | Focus settings page → Ctrl+S → verify save triggers |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
