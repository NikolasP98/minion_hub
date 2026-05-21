# Electrobun (archived)

Archived **2026-05-20** during the pivot to Tauri v2.

## What was here

A working-but-incomplete Electrobun desktop shell. The hub already shipped with
CEF on Linux (`bundleCEF: true`, `defaultRenderer: 'cef'`) and had received real
production fixes over April–May 2026:

- `187d2f2` postbuild hook + launch script
- `a0ab65d` `persist:minionhub` partition + `/auth/` unprotected routes
- `9bb4558` removed partition, added `password-store=basic` for CEF on Linux
- `8907c9b` Google OAuth `localhost` vs `127.0.0.1` fix
- `1130c04` lint-config formatting

## Why it was archived (not deleted)

Decision recorded in `/tmp/desktop-eval/REPORT.md` (eval session 2026-05-20).
Tauri v2 won on signing maturity (minisign+Ed25519 verified updater, automated
notarytool, Windows EV/SmartScreen pathway, 3 Linux bundle formats vs `.deb`
only on Electrobun). The PixiJS+Rapier2D spike on WebKitGTK 2.52.3 passed
(`/tmp/webkit-spike/`), so dropping CEF on Linux is acceptable.

Files are kept here so the past work — particularly the Linux CEF fixes and the
postbuild/launch pipeline — is recoverable as reference if the Tauri pivot
stalls or we ever want to ship a CEF variant separately.

## What's still active outside this folder (intentionally not archived)

- `svelte.config.js` — `DESKTOP=1` switch to `adapter-node`. Shell-agnostic;
  Tauri will reuse it.
- `src/hooks.server.ts` — three `DESKTOP=1` guards (auth cookie persistence,
  PostHog bypass). Shell-agnostic.
- `src/server/auth/desktop-session.ts` — cookie persistence helpers. Named
  shell-agnostically; originally written for Electrobun bug #278 (CEF Linux
  incognito fallback). Tauri's webview persists cookies by default so this may
  become dead code — leave in place until the Tauri scaffold is tested, then
  re-evaluate.
- `package.json` scripts:
  - **kept**: `desktop:build`, `desktop:serve` (framework-agnostic)
  - **removed**: `desktop:dev`, `desktop:window` (called `electrobun` directly)
- `devDependencies.electrobun` — removed from `package.json`. Run
  `bun install` to update the lockfile.

## Files in this archive

| File | Original location |
|---|---|
| `electrobun.config.ts` | `minion_hub/electrobun.config.ts` |
| `desktop-main.ts` | `minion_hub/desktop/main.ts` |
| `desktop-postbuild.ts` | `minion_hub/desktop/postbuild.ts` |
| `desktop-launch.sh` | `minion_hub/desktop/launch.sh` |

## To restore

```bash
cd minion_hub
mkdir -p desktop
git mv archive/electrobun/electrobun.config.ts ./electrobun.config.ts
git mv archive/electrobun/desktop-main.ts desktop/main.ts
git mv archive/electrobun/desktop-postbuild.ts desktop/postbuild.ts
git mv archive/electrobun/desktop-launch.sh desktop/launch.sh
# Then re-add electrobun devDep to package.json and run `bun install`.
```
