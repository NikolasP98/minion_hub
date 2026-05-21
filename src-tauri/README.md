# minion-hub-desktop (Tauri v2 shell)

Minimal Tauri v2 wrapper around the existing SvelteKit adapter-node server.

## What this does

1. On launch, spawns `node build/index.js` as a child process with
   `DESKTOP=1`, `PORT=5959`, `HOST=127.0.0.1`, `ORIGIN=http://localhost:5959`.
2. Opens a single window pointing at `loading-dist/index.html`, which polls
   `http://127.0.0.1:5959` and redirects to it once the server responds.
3. Kills the child when the last window closes.

The hub itself runs unchanged. All server routes, Drizzle/libSQL, Better Auth,
B2 uploads, AI builder endpoints, backup scheduler — all execute inside the
embedded Node process.

## Dev workflow

```bash
# One-time: install Tauri CLI as a dev dependency of the hub
cd minion_hub
bun add -D @tauri-apps/cli

# Run the desktop shell in dev (rebuilds SvelteKit + spawns server + opens window)
bunx tauri dev

# Produce a release bundle (.deb / .AppImage on Linux; .dmg on macOS; .msi on Windows)
bunx tauri build
```

`tauri.conf.json` `beforeDevCommand` runs `bun run desktop:build && bun run desktop:serve`
before opening the window. That builds the SvelteKit `adapter-node` output into
`minion_hub/build/` and is what the Rust shell's spawned child consumes.

## Files

| File | Purpose |
|---|---|
| `Cargo.toml` | Rust manifest. Pins Tauri v2. |
| `build.rs` | Standard Tauri build hook. |
| `tauri.conf.json` | App config, window shape, bundle settings, icon paths. |
| `src/main.rs` | Entry point. Forwards to `lib.rs::run`. |
| `src/lib.rs` | Spawns Node child, manages lifecycle, kills on exit. |
| `capabilities/default.json` | Tauri v2 capability config. Minimal — just `core:default`. |
| `loading-dist/index.html` | Tiny loader page shown while the Node server boots. |
| `icons/` | App icons. **TODO**: generate via `bunx tauri icon path/to/source.png`. |

## What's not yet done

- [ ] **Icons**: `icons/` is empty. Build will fail until icons land. Generate with:
      `bunx tauri icon path/to/source.png` (square PNG, ≥1024×1024).
- [ ] **Sidecar packaging**: today we shell out to `node` from PATH. For
      shippable installers, switch to `tauri-plugin-shell`'s `externalBin` so
      a signed Node binary is bundled.
- [ ] **Code signing**: macOS notarytool + Windows Authenticode pipelines.
      See `/tmp/desktop-eval/REPORT.md` §5 risks.
- [ ] **Auto-update**: `tauri-plugin-updater` + minisign keys + update endpoint.
- [ ] **WS reconnect on suspend/resume**: needs `tauri-plugin-process` resume
      hook + heartbeat in the hub's WebSocket client.
- [ ] **`desktop-session.ts` re-evaluation**: written for Electrobun bug #278
      (CEF cookie incognito fallback on Linux). Tauri's webview persists
      cookies by default — likely dead code; verify after first successful run.
- [ ] **protocolVersion handshake**: `/tmp/desktop-eval/04-protocol-version-patch.diff`
      should land before any bundled release.

## Why this layout

- **No `tauri-plugin-shell`**: keeps the Rust shell dependency-free for v0.
  Sidecar bundling comes when we package signed installers.
- **`loading-dist/index.html` instead of `app.windows[0].url = http://...`**:
  Tauri v2 requires `frontendDist` at build time; pointing it at a real local
  asset lets the bundler validate the build. The page immediately redirects.
- **Server lives in `minion_hub/build/`**: produced by the existing
  `desktop:build` script (`DESKTOP=1 VITE_DESKTOP=1 vite build` → adapter-node
  output). Tauri does not touch SvelteKit code.

## Provenance

Created 2026-05-20 during the Electrobun → Tauri pivot. Evaluation:
`/tmp/desktop-eval/REPORT.md`. Archived Electrobun work:
`../archive/electrobun/`.
