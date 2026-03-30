# Phase 12: Electrobun Desktop Wrapper - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Wrap the existing Minion Hub SvelteKit web dashboard in an optional Electrobun desktop engine. The web deployment to Vercel must remain completely unchanged. Desktop mode is opt-in via `DESKTOP=1` environment variable, producing a native app that embeds a SvelteKit Node server and opens it in a BrowserWindow.

This phase does NOT include: tray icon, auto-updates, native notifications, deep linking, or any desktop-specific UI beyond the window shell. Those are future scope.

</domain>

<decisions>
## Implementation Decisions

### Desktop Server
- **D-01:** Embedded server port is `5959` (avoids Vite 5173/5174 and preview 4173 conflicts)
- **D-02:** App quits when last window closes (`exitOnLastWindowClosed: true`). No tray mode in this phase.
- **D-03:** SvelteKit Node server starts inside the Electrobun Bun process using Node's `http.createServer` with the adapter-node handler (not Bun.serve — adapter-node targets the Node HTTP API)
- **D-04:** BrowserWindow loads `http://127.0.0.1:5959` — the SvelteKit app is NOT served via Electrobun's `views://` protocol

### Adapter Switching
- **D-05:** `svelte.config.js` conditionally imports `@sveltejs/adapter-node` when `DESKTOP=1`, otherwise uses `@sveltejs/adapter-vercel` (existing behavior). Uses dynamic `import()` with top-level `await`.
- **D-06:** Both `DESKTOP=1` (server/build) and `VITE_DESKTOP=1` (client) env vars are set together for desktop builds

### Vercel Code Guards
- **D-07:** `@vercel/analytics` and `@vercel/speed-insights` are conditionally loaded via dynamic `import()` guarded by `!import.meta.env.VITE_DESKTOP` in `+layout.svelte` and `+layout.ts`
- **D-08:** PostHog init in `hooks.client.ts` short-circuits with early return when `VITE_DESKTOP` is set
- **D-09:** PostHog proxy handler in `hooks.server.ts` passes through to `resolve(event)` when `DESKTOP=1`

### Desktop Auth
- **D-10:** Auth stays enabled by default in desktop mode. Users can opt into `AUTH_DISABLED=true` + `PUBLIC_AUTH_DISABLED=true` for single-user local use (existing pattern in hooks.server.ts)
- **D-11:** Better Auth `trustedOrigins` already dynamically includes `BETTER_AUTH_URL` — setting `BETTER_AUTH_URL=http://localhost:5959` in desktop env handles it. No code change needed in `auth.ts`.

### Native Module Handling
- **D-12:** `@libsql/client` and `@node-rs/argon2` are marked `external` in `electrobun.config.ts` to prevent bundling native `.node` addons

### Project Structure
- **D-13:** Desktop files live in `desktop/` directory at project root (peer to `src/`, not inside it)
- **D-14:** `electrobun.config.ts` lives at project root (required by Electrobun CLI)
- **D-15:** `.env.desktop` template file (not committed) provides desktop-mode environment defaults

### Claude's Discretion
- Window dimensions (default 1400x900 is reasonable, Claude can adjust)
- `titleBarStyle` choice (hiddenInset vs default)
- Application menu structure (Edit/View menus)
- Whether to use a `preBuild` script or inline the SvelteKit build in package.json scripts

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Electrobun Documentation
- `docs/electrobun/index.md` — Master index of all 33 Electrobun doc files
- `docs/electrobun/11-browser-window-api.md` — BrowserWindow constructor, options, methods
- `docs/electrobun/15-application-menu-api.md` — Native menu bar setup
- `docs/electrobun/22-build-configuration.md` — electrobun.config.ts full reference
- `docs/electrobun/23-cli-args.md` — CLI commands (init, build, dev)
- `docs/electrobun/03-hello-world.md` — From-scratch setup guide

### Implementation Plan
- `.claude/plans/enumerated-skipping-hennessy.md` — Detailed implementation plan with code patterns for all 11 steps

### Current Config Files (must read before modifying)
- `svelte.config.js` — Current adapter-vercel config (the main file to modify)
- `vite.config.ts` — Vite plugins and optimization config
- `src/routes/+layout.svelte` — Root layout with Vercel imports to guard
- `src/routes/+layout.ts` — Analytics injection to guard
- `src/hooks.server.ts` — Server hooks with PostHog proxy to guard
- `src/hooks.client.ts` — Client hooks with PostHog init to guard
- `src/lib/auth/auth.ts` — Better Auth config with trustedOrigins

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `AUTH_DISABLED` pattern in `hooks.server.ts:94-99` — exact model for desktop env guards
- Dynamic env access via `$env/dynamic/private` — already used throughout, works in desktop mode (Bun reads `.env`)
- Better Auth `trustedOrigins` spread pattern in `auth.ts:27-29` — already handles custom `BETTER_AUTH_URL`

### Established Patterns
- Conditional code via env vars (AUTH_DISABLED, VERCEL_URL checks) — well-established in hooks
- Dynamic imports used in `+layout.svelte` for lazy loading components
- SPA mode (`ssr: false`, `prerender: false`) — desktop mode benefits from same approach
- PostHog error swallowing in `vite.config.ts:10-15` — may need similar guard for desktop

### Integration Points
- `svelte.config.js` — adapter is the single integration point for build target switching
- `package.json` scripts — add desktop commands alongside existing web commands
- `.gitignore` — add Electrobun output directories

</code_context>

<specifics>
## Specific Ideas

- User explicitly requested Electrobun (not Electron or Tauri) — TypeScript-only, Bun-native, lightweight
- The app should work identically in desktop mode — same auth, same DB, same gateway WebSocket connections
- "Optional" is key — the desktop wrapper is additive, not a replacement for the web deployment

</specifics>

<deferred>
## Deferred Ideas

- **Tray icon with minimize-to-tray** — Future desktop enhancement
- **Auto-updates via Electrobun Updater** — Future phase, requires release infrastructure
- **Native notifications** — Could replace browser notifications for gateway events
- **Deep linking** — `minionhub://` URL scheme for opening specific agents/sessions
- **Desktop-specific UI** — Native context menus, window controls in titlebar

None — discussion stayed within phase scope

</deferred>

---

*Phase: 12-electrobun-desktop-wrapper*
*Context gathered: 2026-03-30*
