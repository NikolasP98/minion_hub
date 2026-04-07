# Phase 12: Electrobun Desktop Wrapper - Research

**Researched:** 2026-03-30
**Domain:** Electrobun desktop embedding, SvelteKit adapter-node, conditional build configuration
**Confidence:** HIGH (all key claims verified against local Electrobun doc mirror and official SvelteKit docs)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Embedded server port is `5959`
- **D-02:** App quits when last window closes (`exitOnLastWindowClosed: true`). No tray mode in this phase.
- **D-03:** SvelteKit Node server starts inside the Electrobun Bun process using Node's `http.createServer` with the adapter-node handler (not Bun.serve)
- **D-04:** BrowserWindow loads `http://127.0.0.1:5959` — NOT via `views://` protocol
- **D-05:** `svelte.config.js` conditionally imports `@sveltejs/adapter-node` when `DESKTOP=1`, uses dynamic `import()` with top-level `await`
- **D-06:** Both `DESKTOP=1` (server/build) and `VITE_DESKTOP=1` (client) env vars are set together for desktop builds
- **D-07:** `@vercel/analytics` and `@vercel/speed-insights` guarded by `!import.meta.env.VITE_DESKTOP` in `+layout.svelte` and `+layout.ts`
- **D-08:** PostHog init in `hooks.client.ts` short-circuits with early return when `VITE_DESKTOP` is set
- **D-09:** PostHog proxy handler in `hooks.server.ts` passes through to `resolve(event)` when `DESKTOP=1`
- **D-10:** Auth stays enabled by default. `AUTH_DISABLED=true` + `PUBLIC_AUTH_DISABLED=true` opt-in for single-user local use (existing pattern).
- **D-11:** Setting `BETTER_AUTH_URL=http://localhost:5959` in desktop env handles trustedOrigins. No code change needed in `auth.ts`.
- **D-12:** `@libsql/client` and `@node-rs/argon2` marked `external` in `electrobun.config.ts`
- **D-13:** Desktop files in `desktop/` directory at project root
- **D-14:** `electrobun.config.ts` lives at project root
- **D-15:** `.env.desktop` template file (not committed) provides desktop-mode environment defaults

### Claude's Discretion

- Window dimensions (default 1400x900 is reasonable)
- `titleBarStyle` choice (`hiddenInset` vs `default`)
- Application menu structure (Edit/View menus)
- Whether to use a `preBuild` script or inline the SvelteKit build in package.json scripts

### Deferred Ideas (OUT OF SCOPE)

- Tray icon with minimize-to-tray
- Auto-updates via Electrobun Updater
- Native notifications
- Deep linking (`minionhub://` URL scheme)
- Desktop-specific UI (native context menus, window controls in titlebar)
</user_constraints>

---

## Summary

Phase 12 wraps the existing Minion Hub SvelteKit dashboard in an optional Electrobun native desktop shell. The approach is additive: `bun run dev` and `bun run build` remain completely unchanged; all desktop-specific behavior is gated behind `DESKTOP=1` / `VITE_DESKTOP=1` env vars.

The core pattern is: (1) build SvelteKit with `@sveltejs/adapter-node` (instead of `adapter-vercel`) when `DESKTOP=1`, (2) start the resulting `build/handler.js` in a Node `http.createServer` on port 5959 inside the Electrobun Bun main process, (3) open a `BrowserWindow` pointing at `http://127.0.0.1:5959`. Vercel-specific code (`@vercel/analytics`, `@vercel/speed-insights`, PostHog proxy) is conditionally skipped via env-var guards in three files.

Neither `electrobun` nor `@sveltejs/adapter-node` are currently installed. Both must be added to `package.json` as part of Wave 0. All decisions are already locked in CONTEXT.md — the planner's primary job is to sequence tasks correctly to avoid catching unresolved deps mid-build.

**Primary recommendation:** Install deps and configure the build pipeline first (Wave 0); implement conditional guards and desktop entry point second (Wave 1); smoke-test and verify the full round-trip last (Wave 2).

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `electrobun` | `1.16.0` (latest) | Desktop app framework: BrowserWindow, app lifecycle, build/dev CLI | Project decision (D-14); Bun-native TypeScript-only desktop runtime |
| `@sveltejs/adapter-node` | `5.5.4` (latest) | Produce a standalone Node HTTP server handler from SvelteKit build | Locked (D-05); official SvelteKit adapter for embedded Node servers |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:http` (built-in) | — | `http.createServer(handler)` to serve the SvelteKit build on port 5959 | Desktop entry point only (D-03) |
| `electrobun/bun` (sub-import) | — | `BrowserWindow`, `ApplicationMenu`, `Electrobun.events` | Desktop main process (`desktop/main.ts`) |

### Not Used (for clarity)

| Instead of | Why Excluded |
|------------|-------------|
| `Bun.serve` | adapter-node exports a Node HTTP handler; D-03 explicitly requires `node:http` |
| `views://` URL scheme | D-04: app runs over HTTP, not packaged static assets |
| CEF bundling | Default native WebKit/WebView2/WebKitGTK is sufficient; no CEF needed for MVP |

**Installation:**

```bash
bun add -d electrobun @sveltejs/adapter-node
```

Both are devDependencies — only needed at build time and in the desktop entry point (which is built by the Electrobun CLI, not shipped as npm deps).

**Version verification (confirmed against npm registry 2026-03-30):**
- `@sveltejs/adapter-node@5.5.4` — latest stable (dist-tags.latest)
- `electrobun@1.16.0` — latest stable (dist-tags.latest; beta 1.17.0-beta.0 exists, use stable)

---

## Architecture Patterns

### Recommended Project Structure

```
/                               # project root
├── electrobun.config.ts        # required at root (D-14)
├── svelte.config.js            # modified: conditional adapter (D-05)
├── package.json                # add desktop:dev, desktop:build scripts
├── .env.desktop                # template (not committed) (D-15)
├── .gitignore                  # add build/, desktop-build/ (Electrobun output)
├── desktop/                    # (D-13) Electrobun main process
│   └── main.ts                 # BrowserWindow creation + embedded server start
└── src/
    ├── routes/
    │   ├── +layout.svelte      # guard @vercel/speed-insights + analytics (D-07)
    │   └── +layout.ts          # guard injectAnalytics (D-07)
    ├── hooks.server.ts         # guard posthogProxy (D-09)
    └── hooks.client.ts         # guard posthog.init (D-08)
```

### Pattern 1: Conditional svelte.config.js

`svelte.config.js` is a plain ESM module — top-level `await` works because SvelteKit processes it with Bun (the project's runtime). The `DESKTOP` env var gates which adapter loads.

```javascript
// svelte.config.js
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// D-05: dynamic import allows conditional adapter selection
const adapterModule = process.env.DESKTOP === '1'
  ? await import('@sveltejs/adapter-node')
  : await import('@sveltejs/adapter-vercel');

const adapter = adapterModule.default;

const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: process.env.DESKTOP === '1'
      ? adapter()                       // adapter-node defaults are fine
      : adapter({ runtime: 'nodejs22.x' }),
    alias: {
      '$server': 'src/server',
      '$server/*': 'src/server/*'
    },
    paths: { relative: false }
  }
};

export default config;
```

### Pattern 2: Desktop Main Process (desktop/main.ts)

```typescript
// desktop/main.ts
import { createServer } from 'node:http';
import { BrowserWindow, ApplicationMenu } from 'electrobun/bun';
import Electrobun from 'electrobun/bun';

const PORT = 5959;

// Start the embedded SvelteKit server
// adapter-node build output: ./build/handler.js (relative to project root at build time)
const { handler } = await import('../build/handler.js');
const server = createServer(handler);
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[desktop] SvelteKit server listening on http://127.0.0.1:${PORT}`);
});

// Open BrowserWindow (D-04: load via HTTP, not views://)
const win = new BrowserWindow({
  title: 'Minion Hub',
  url: `http://127.0.0.1:${PORT}`,
  frame: { width: 1400, height: 900 },
  titleBarStyle: 'hiddenInset',   // Claude's discretion
});

// Shut down the HTTP server when the app quits
Electrobun.events.on('before-quit', async () => {
  server.close();
});

// Application menu (Edit + View basics)
ApplicationMenu.setApplicationMenu([
  {
    submenu: [{ label: 'Quit Minion Hub', role: 'quit' }],
  },
  {
    label: 'Edit',
    submenu: [
      { role: 'undo' }, { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
      { role: 'selectAll' },
    ],
  },
  {
    label: 'View',
    submenu: [
      { role: 'toggleFullScreen' },
    ],
  },
]);
```

**Important nuance:** `../build/handler.js` is the path from `desktop/main.ts` to the SvelteKit build output. At Electrobun build time this relative path is resolved at bundle time, so the SvelteKit build must exist before `electrobun build` runs.

### Pattern 3: electrobun.config.ts

```typescript
// electrobun.config.ts
import type { ElectrobunConfig } from 'electrobun';

export default {
  app: {
    name: 'Minion Hub',
    identifier: 'app.minionhub.desktop',
    version: '0.0.1',
  },
  runtime: {
    exitOnLastWindowClosed: true,   // D-02
  },
  build: {
    bun: {
      entrypoint: 'desktop/main.ts',
      external: [                   // D-12: native .node addons must not be bundled
        '@libsql/client',
        '@node-rs/argon2',
      ],
    },
  },
} satisfies ElectrobunConfig;
```

### Pattern 4: Vercel Code Guards

**+layout.ts** — guard `injectAnalytics`:

```typescript
// src/routes/+layout.ts
import { dev } from '$app/environment';

// D-07: skip Vercel analytics in desktop mode
if (!import.meta.env.VITE_DESKTOP) {
  const { injectAnalytics } = await import('@vercel/analytics/sveltekit');
  injectAnalytics({ mode: dev ? 'development' : 'production' });
}

export const ssr = false;
export const prerender = false;
```

**+layout.svelte** — guard speed-insights and analytics:

```svelte
<script lang="ts">
  // existing imports ...
  import { injectSpeedInsights } from '@vercel/speed-insights/sveltekit';
  import { inject as injectAnalytics } from '@vercel/analytics';

  // D-07: only call Vercel telemetry when NOT in desktop mode
  if (!import.meta.env.VITE_DESKTOP) {
    injectSpeedInsights();
    injectAnalytics();
  }
  // ... rest of script unchanged
</script>
```

**hooks.client.ts** — guard PostHog init (D-08):

```typescript
export async function init() {
  if (import.meta.env.VITE_DESKTOP) return;   // D-08: skip in desktop
  posthog.init(PUBLIC_POSTHOG_KEY, { /* existing config */ });
  (window as Window & { posthog?: typeof posthog }).posthog = posthog;
}
```

**hooks.server.ts** — guard PostHog proxy (D-09):

```typescript
const posthogProxyHandle: Handle = async ({ event, resolve }) => {
  if (env.DESKTOP === '1') return resolve(event);   // D-09: pass-through in desktop
  const { pathname } = event.url;
  if (pathname.startsWith('/ingest')) {
    // ... existing proxy logic
  }
  return resolve(event);
};
```

### Pattern 5: package.json Scripts

```json
{
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "desktop:build": "DESKTOP=1 VITE_DESKTOP=1 vite build && DESKTOP=1 electrobun build",
    "desktop:dev": "DESKTOP=1 VITE_DESKTOP=1 vite build && DESKTOP=1 VITE_DESKTOP=1 electrobun dev"
  }
}
```

Note: `electrobun dev` rebuilds+relaunches the Electrobun Bun bundle; it does NOT run Vite in watch mode. For fast iteration, the SvelteKit build must finish first, then Electrobun launches it. This is acceptable for a v1 desktop wrapper.

### Pattern 6: .env.desktop Template

```bash
# .env.desktop — copy to .env for desktop development (not committed)
DESKTOP=1
VITE_DESKTOP=1
BETTER_AUTH_URL=http://localhost:5959     # D-11: auth trustedOrigins
BETTER_AUTH_SECRET=change-me-local
TURSO_DB_URL=file:./data/minion_hub.db   # local SQLite (no Turso needed)
# AUTH_DISABLED=true                     # uncomment for single-user local mode (D-10)
# PUBLIC_AUTH_DISABLED=true
PORT=5959                                # adapter-node reads this
ORIGIN=http://localhost:5959             # adapter-node origin check
```

### Anti-Patterns to Avoid

- **Using `Bun.serve` instead of `node:http`:** adapter-node's handler expects the Node `(req, res)` signature, not the Fetch API. D-03 is explicit.
- **Using `views://` URL:** The SvelteKit app uses WebSocket connections to the gateway; loading via `views://` would break the relative URL resolution for the gateway WS and all API routes. D-04 is explicit.
- **Importing `electrobun/bun` in SvelteKit source:** The Electrobun main process runs separately from the SvelteKit app. Never import `electrobun/bun` in `src/`. The desktop entry lives in `desktop/` and is bundled by the Electrobun CLI.
- **Forgetting `ORIGIN` env var:** `@sveltejs/adapter-node` performs an origin check on requests. Without `ORIGIN=http://localhost:5959`, cross-origin cookie operations and CSRF protection may fail.
- **Building Electrobun before Vite:** `desktop/main.ts` imports `../build/handler.js` at bundle time. Running `electrobun build` before `vite build` will fail with a module-not-found error.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Desktop window lifecycle | Custom Bun WebSocket IPC | `Electrobun.events.on('before-quit')` | Handles all quit paths: Cmd+Q, last-window, Ctrl+C, SIGTERM, updater |
| Cross-platform window chrome | CSS-based custom titlebar | `titleBarStyle: 'hiddenInset'` | Native OS controls; `'hidden'` requires implementing close/minimize/maximize manually |
| HTTP server for SvelteKit | Custom fetch-adapter shim | `node:http` + `adapter-node`'s `handler` | adapter-node already handles SSR, static assets, streaming, 404 fallback |
| App quit event | `process.on('SIGTERM')` | `Electrobun.events.on('before-quit')` | Electrobun intercepts `process.exit()` too; direct signal handlers may not fire reliably |

**Key insight:** Electrobun's architecture is intentionally minimal — it provides BrowserWindow + IPC + lifecycle, nothing else. Don't over-engineer the desktop layer. The SvelteKit app running over localhost HTTP is exactly the right abstraction boundary.

---

## Common Pitfalls

### Pitfall 1: Missing ORIGIN env var for adapter-node

**What goes wrong:** Requests to API routes return 403 or auth cookies fail to set. Better Auth and SvelteKit's CSRF protection both validate the `Origin` header against the trusted origins list.
**Why it happens:** `@sveltejs/adapter-node` requires `ORIGIN` to be set to the app's base URL. Without it, the server cannot verify request origins.
**How to avoid:** Set `ORIGIN=http://localhost:5959` in `.env.desktop`. The `PORT=5959` and `HOST=127.0.0.1` vars also control what address adapter-node binds to, but the `ORIGIN` var is separate.
**Warning signs:** `403 Forbidden` on POST requests, auth sign-in failing silently.

### Pitfall 2: Native module bundling failure

**What goes wrong:** Electrobun's Bun bundler tries to bundle `@libsql/client` or `@node-rs/argon2` and fails because they contain pre-compiled `.node` native addons.
**Why it happens:** Bun's bundler can't process `.node` binary files. D-12 pre-empts this.
**How to avoid:** Both packages MUST be in `electrobun.config.ts`'s `build.bun.external` array. The native binaries will be resolved at runtime from `node_modules`.
**Warning signs:** `Cannot bundle native addon` or `Failed to resolve .node file` errors during `electrobun build`.

### Pitfall 3: PostHog PUBLIC env vars missing at desktop build time

**What goes wrong:** `hooks.client.ts` imports `PUBLIC_POSTHOG_KEY` and `PUBLIC_POSTHOG_HOST` from `$env/static/public`. If those vars are not set in the `.env` during desktop Vite build, the build fails with "missing public env var".
**Why it happens:** SvelteKit's `$env/static/public` is evaluated at build time and throws if required vars are missing — even if the PostHog code is behind an `if (!import.meta.env.VITE_DESKTOP)` check (because the import itself is at module top-level, not behind the guard).
**How to avoid:** Two options: (a) move the `posthog-js` import inside the `if` block so it's tree-shaken, or (b) add placeholder values for `PUBLIC_POSTHOG_KEY=''` and `PUBLIC_POSTHOG_HOST=''` to `.env.desktop`. Option (a) is cleaner.
**Warning signs:** `Missing env var: PUBLIC_POSTHOG_KEY` during `DESKTOP=1 vite build`.

### Pitfall 4: svelte.config.js top-level await requires ESM context

**What goes wrong:** `SyntaxError: await is not allowed outside an async function` when Vite loads `svelte.config.js`.
**Why it happens:** Top-level `await` requires the module to be treated as ESM. `package.json` has `"type": "module"` (confirmed), so this should work — but older Vite versions may not support it in config files.
**How to avoid:** Verify `"type": "module"` is in `package.json` (it is — confirmed). If Vite version is old (<4), use an async IIFE pattern instead. Current setup uses Vite 5.x so top-level await is fine.
**Warning signs:** SyntaxError on `vite build` when `DESKTOP=1`.

### Pitfall 5: WebSocket gateway connection in desktop mode

**What goes wrong:** The gateway WebSocket connection (gateway.svelte.ts `wsConnect()`) connects to a configured host URL stored in the database. In desktop mode, the gateway is still a remote service — not embedded. This works fine as-is.
**Why it happens:** Not actually a pitfall — the existing WebSocket connection logic uses dynamic host URLs from the database, not a hardcoded localhost. No changes needed.
**How to avoid:** No action needed. Document so the planner doesn't add unnecessary scope.

### Pitfall 6: `electrobun dev` does not watch SvelteKit source

**What goes wrong:** Developer edits `.svelte` files, but the desktop app doesn't update.
**Why it happens:** `electrobun dev --watch` watches the `desktop/` entrypoint directory, not the SvelteKit source. Vite's dev server is not involved.
**How to avoid:** For Phase 12 (v1 wrapper), accept this limitation. The `desktop:dev` script rebuilds SvelteKit first, then Electrobun. A future enhancement could use `preBuild` hooks or parallel watchers. Document as known limitation.

### Pitfall 7: adapter-node handler.js path in electrobun bundle

**What goes wrong:** `import('../build/handler.js')` in `desktop/main.ts` fails at runtime in the Electrobun app.
**Why it happens:** Electrobun bundles `desktop/main.ts` into a self-contained bundle in `build/bun/`. Relative imports are resolved at bundle time relative to the source file, not the output file. The `../build/handler.js` file is the SvelteKit output — it must be either (a) included in the Electrobun app bundle via `build.copy`, or (b) resolved from a known absolute path.
**How to avoid:** Use `build.copy` in `electrobun.config.ts` to include the SvelteKit build output, OR use `Paths.RESOURCES_FOLDER` to construct an absolute path at runtime. For dev mode (`electrobun dev`), the working directory is the project root and the relative path resolves correctly — this is only a concern for `electrobun build` (production).
**Warning signs:** `Cannot find module '../build/handler.js'` in the packaged app.

---

## Code Examples

Verified patterns from official sources:

### BrowserWindow with HTTP URL (docs/electrobun/11-browser-window-api.md)

```typescript
// Source: docs/electrobun/11-browser-window-api.md
import { BrowserWindow } from 'electrobun/bun';

const win = new BrowserWindow({
  title: 'Minion Hub',
  url: 'http://127.0.0.1:5959',
  frame: { width: 1400, height: 900 },
});
```

### Exit lifecycle (docs/electrobun/19-events-api.md)

```typescript
// Source: docs/electrobun/19-events-api.md
import Electrobun from 'electrobun/bun';

Electrobun.events.on('before-quit', async (e) => {
  await saveState();
  server.close();
});
```

### ExitOnLastWindowClosed (docs/electrobun/22-build-configuration.md)

```typescript
// Source: docs/electrobun/22-build-configuration.md
export default {
  runtime: { exitOnLastWindowClosed: true },
} satisfies ElectrobunConfig;
```

### ApplicationMenu (docs/electrobun/15-application-menu-api.md)

```typescript
// Source: docs/electrobun/15-application-menu-api.md
import { ApplicationMenu } from 'electrobun/bun';

ApplicationMenu.setApplicationMenu([
  { submenu: [{ label: 'Quit', role: 'quit' }] },
  {
    label: 'Edit',
    submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ],
  },
]);
```

### adapter-node custom server (svelte.dev/docs/kit/adapter-node)

```javascript
// Source: https://svelte.dev/docs/kit/adapter-node
import { createServer } from 'node:http';
import { handler } from './build/handler.js';

const server = createServer(handler);
server.listen(3000);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Electron (Node + Chromium) | Electrobun (Bun + system WebKit/WebView2) | 2024 (Electrobun v1) | ~50MB app vs ~100-200MB Electron app; TypeScript-native |
| adapter-static (SPA) | adapter-node (full SSR server) | — | Preserves all server routes, auth, WebSocket handler, API endpoints |

**Deprecated/outdated:**
- `Bun.serve` as SvelteKit host: Not compatible with adapter-node's Node HTTP API signature.

---

## Open Questions

1. **SvelteKit build output path in packaged app (Pitfall 7)**
   - What we know: `electrobun dev` works with relative paths from project root; `electrobun build` bundles into a `.app` bundle where relative paths from the source file may not resolve.
   - What's unclear: Does Electrobun's bundler rewrite relative `import()` paths to absolute paths, or does it bundle them? The docs don't address this pattern explicitly.
   - Recommendation: Use `Paths.RESOURCES_FOLDER` (from `electrobun/bun`) for production path resolution, keep `../build/handler.js` for dev. Add an `electrobun:build` Wave 0 smoke test to verify. This is a dev-only v1 — full packaging/distribution is out of scope for this phase.

2. **`VITE_DESKTOP` type declaration for TypeScript**
   - What we know: `import.meta.env.VITE_DESKTOP` requires a type declaration to avoid TypeScript errors. SvelteKit auto-generates `$env/static/public` types but not `import.meta.env` custom keys.
   - What's unclear: Whether existing `app.d.ts` or a `vite-env.d.ts` already declares this.
   - Recommendation: Add `interface ImportMeta { readonly env: ImportMetaEnv }` with `VITE_DESKTOP?: string` to `src/vite-env.d.ts` (create if absent). Low effort, prevents TS errors in `+layout.ts`.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `bun` | All build commands | ✓ | 1.3.4 | — |
| `node` | Fallback check | ✓ | 22.22.1 | — |
| `electrobun` | `desktop:dev`, `desktop:build` | ✗ | — (not installed) | Install via `bun add -d electrobun` (Wave 0) |
| `@sveltejs/adapter-node` | `DESKTOP=1 vite build` | ✗ | — (not installed) | Install via `bun add -d @sveltejs/adapter-node` (Wave 0) |

**Missing dependencies with no fallback:**
- `electrobun@1.16.0` — must be installed before any desktop commands work
- `@sveltejs/adapter-node@5.5.4` — must be installed before `DESKTOP=1 vite build`

**Missing dependencies with fallback:**
- None — both missing deps are install-only blockers, not feature blockers.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.x |
| Config file | `vitest.config.ts` |
| Quick run command | `bun run vitest run src/lib/utils/format.test.ts` |
| Full suite command | `bun run test` |

### Phase Requirements → Test Map

This phase has no formal requirement IDs (user-requested feature). Success criteria from CONTEXT.md:

| Criterion | Behavior | Test Type | Automated Command | File Exists? |
|-----------|----------|-----------|-------------------|-------------|
| SC-1 | `bun run build` still works after svelte.config.js change | smoke | `bun run build` (exit 0) | N/A — build command |
| SC-2 | `DESKTOP=1 vite build` produces `build/handler.js` | smoke | `DESKTOP=1 bun run build && ls build/handler.js` | N/A — build command |
| SC-3 | `desktop:dev` launches without crash | manual | `bun run desktop:dev` (observe window opens) | N/A — manual |
| SC-4 | Vercel analytics NOT called in desktop build | unit | Check that `@vercel/analytics` is not imported when `VITE_DESKTOP=1` | ❌ Wave 0 |
| SC-5 | PostHog init skips in desktop | unit | Mock `import.meta.env.VITE_DESKTOP` and verify `posthog.init` not called | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `bun run test` (existing suite must stay green)
- **Per wave merge:** `bun run build` (Vercel adapter, no regression) + `DESKTOP=1 bun run build` (adapter-node)
- **Phase gate:** Both build commands succeed AND `desktop:dev` smoke test passes before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/lib/utils/desktop-env.test.ts` — unit test that `VITE_DESKTOP` guards work (mock `import.meta.env`)
- [ ] Framework itself: no new framework needed — Vitest already installed and configured

*(Note: The most valuable tests for this phase are build-level smoke tests, not unit tests. The planner should include explicit `DESKTOP=1 bun run build` verification steps in each plan.)*

---

## Project Constraints (from CLAUDE.md)

| Directive | Applies To This Phase |
|-----------|----------------------|
| Bun for SvelteKit projects (not pnpm/npm) | All `bun add`, `bun run` commands |
| Svelte 5 runes only — no legacy patterns | Any new `.svelte` files (none in this phase) |
| TypeScript strict mode, no `any`, no `@ts-nocheck` | `desktop/main.ts`, `electrobun.config.ts` |
| `$lib` → `src/lib/`, `$server` → `src/server/` path aliases | Not relevant in `desktop/` (outside SvelteKit) |
| Feature branches → `dev` → `master` | Standard — work on feature branch |
| Multi-agent safety: scope commits to own changes | Standard |
| `bun run check` after any SvelteKit changes | After modifying `+layout.svelte`, `+layout.ts`, hooks |

---

## Sources

### Primary (HIGH confidence)

- `docs/electrobun/` (local mirror, fetched 2026-03-30) — BrowserWindow API, CLI args, build config, events API, compatibility, architecture
- `https://svelte.dev/docs/kit/adapter-node` — handler import pattern, ORIGIN env var, custom server usage (WebFetch verified 2026-03-30)
- `npm view @sveltejs/adapter-node` — version 5.5.4 confirmed current
- `npm view electrobun` — version 1.16.0 confirmed current

### Secondary (MEDIUM confidence)

- Project source files (`svelte.config.js`, `vite.config.ts`, `src/hooks.server.ts`, `src/hooks.client.ts`, `src/routes/+layout.svelte`, `src/routes/+layout.ts`, `src/lib/auth/auth.ts`, `package.json`) — read directly, HIGH confidence for existing patterns

### Tertiary (LOW confidence)

- Pitfall 7 (handler.js path in packaged app) — inferred from Electrobun architecture docs; no explicit example found for this pattern. Flagged as Open Question.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — both packages verified against npm registry; adapter-node docs verified against svelte.dev
- Architecture patterns: HIGH — Electrobun docs are a local mirror, all patterns verified directly; adapter-node handler pattern verified against official docs
- Pitfalls: HIGH for P1–P4 (verified against official docs / source inspection); MEDIUM for P5–P7 (inferred from architecture)

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (stable libraries; Electrobun has active development, check for minor version updates before implementation)
