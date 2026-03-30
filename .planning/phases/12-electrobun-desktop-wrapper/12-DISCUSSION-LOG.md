# Phase 12: Electrobun Desktop Wrapper - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-30
**Phase:** 12-electrobun-desktop-wrapper
**Areas discussed:** Desktop port & lifecycle, Adapter-node handler compatibility, Native module bundling, Desktop auth mode
**Mode:** --auto (all decisions auto-selected as recommended defaults)

---

## Desktop Port & Lifecycle

| Option | Description | Selected |
|--------|-------------|----------|
| Port 5959 | Avoids Vite 5173/5174 and preview 4173 conflicts | ✓ |
| Port 3000 | Common default, but may conflict with other dev servers | |
| Random port | Flexible but harder to configure auth trustedOrigins | |

**User's choice:** [auto] Port 5959 (recommended default)

| Option | Description | Selected |
|--------|-------------|----------|
| Quit on last window close | Standard desktop behavior | ✓ |
| Minimize to tray | Keep running in background | |

**User's choice:** [auto] Quit on last window close (recommended default)
**Notes:** Tray mode deferred to future phase.

---

## Adapter-Node Handler Compatibility

| Option | Description | Selected |
|--------|-------------|----------|
| Node http.createServer | adapter-node targets Node HTTP API; Bun supports node:http | ✓ |
| Bun.serve (fetch API) | Native Bun server, but adapter-node handler may not be fetch-compatible | |
| Express/Polka wrapper | Additional dependency, unnecessary indirection | |

**User's choice:** [auto] Node http.createServer (recommended default)
**Notes:** Safest approach since adapter-node explicitly documents Node HTTP compatibility.

---

## Native Module Bundling

| Option | Description | Selected |
|--------|-------------|----------|
| Mark as external | Exclude from Electrobun bundler, include binaries in app bundle | ✓ |
| Bundle with workarounds | Complex, fragile, not worth the effort | |
| Replace with pure-JS alternatives | Would change the stack, out of scope | |

**User's choice:** [auto] Mark as external (recommended default)
**Notes:** @libsql/client and @node-rs/argon2 both have native .node bindings.

---

## Desktop Auth Mode

| Option | Description | Selected |
|--------|-------------|----------|
| Auth enabled (default), AUTH_DISABLED opt-in | Preserves security, existing pattern | ✓ |
| Auth always disabled in desktop | Simpler but less secure | |
| Desktop-specific auth (OS keychain) | Over-engineered for v1 | |

**User's choice:** [auto] Auth enabled with opt-in disable (recommended default)
**Notes:** hooks.server.ts already has AUTH_DISABLED pattern at line 94-99.

---

## Claude's Discretion

- Window dimensions, titleBarStyle, menu structure
- Build script organization (preBuild vs inline)

## Deferred Ideas

- Tray icon, auto-updates, native notifications, deep linking, desktop-specific UI
