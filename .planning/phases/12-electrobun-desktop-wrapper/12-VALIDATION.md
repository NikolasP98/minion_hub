---
phase: 12
slug: electrobun-desktop-wrapper
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-30
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing) + manual desktop verification |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `bun run test` |
| **Full suite command** | `bun run test && bun run check` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun run test`
- **After every plan wave:** Run `bun run test && bun run check`
- **Before `/gsd:verify-work`:** Full suite must be green + `bun run desktop:build` must succeed
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 1 | SC-01 (web unchanged) | build | `bun run build` | existing | pending |
| 12-01-02 | 01 | 1 | SC-03 (Vercel guards) | build+check | `bun run check` | existing | pending |
| 12-02-01 | 02 | 2 | SC-02 (desktop:dev) | build | `DESKTOP=1 VITE_DESKTOP=1 bun run build` | new | pending |
| 12-02-02 | 02 | 2 | SC-04 (auth works) | manual | Start desktop, login | n/a | pending |
| 12-02-03 | 02 | 2 | SC-05 (API+WS works) | manual | Connect to gateway | n/a | pending |

*Status: pending = not yet executed*

---

## Wave 0 Requirements

- [ ] `@sveltejs/adapter-node` — install dev dependency
- [ ] `electrobun` — install dev dependency

*These must be installed before any code changes.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Desktop window opens | SC-02 | Requires display server + Electrobun runtime | Run `bun run desktop:dev`, verify BrowserWindow appears at localhost:5959 |
| Auth login works | SC-04 | Requires interactive browser session | Login at localhost:5959/login with test credentials |
| Gateway WebSocket connects | SC-05 | Requires running gateway instance | Connect to a gateway host, verify agent list loads |
| Vercel analytics not loaded | SC-03 | Requires browser DevTools inspection | Check Network tab — no requests to vercel.com or posthog |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
