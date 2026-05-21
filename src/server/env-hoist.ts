/**
 * Hoist SvelteKit's `$env/dynamic/private` values into `process.env` at server boot.
 *
 * Why this exists:
 *   Vite's `loadEnv` populates `import.meta.env` and SvelteKit's `$env/*` modules,
 *   but it does NOT mutate `process.env`. Server-side modules that read raw
 *   `process.env` (e.g. `src/server/services/ssrf-guard.ts`, which intentionally
 *   does so for vitest testability per its docstring) therefore see `undefined`
 *   for any var declared only in `.env` / `.env.local`.
 *
 *   The hub is deployed three ways:
 *     - Vercel: `process.env` is populated by Vercel project env vars — works.
 *     - Tauri:  desktop launcher injects env — works if propagated correctly.
 *     - `bun run dev`:  Bun loads `.env` for the parent process, but the
 *       Vite-spawned SvelteKit server reads `$env/dynamic/private`; raw
 *       `process.env.X` is empty for non-shell-exported vars.
 *
 *   Importing this module once at boot bridges those three modes by copying
 *   every key from `$env/dynamic/private` into `process.env` ONLY when the key
 *   is not already set. Explicit shell exports + Vercel env always win.
 *
 * Safe to import multiple times: idempotent (skips keys that already exist).
 * Skips empty-string values to avoid clobbering meaningful absent-state.
 */

import { env } from '$env/dynamic/private';

let hoisted = false;

export function hoistDynamicEnvIntoProcessEnv(): void {
  if (hoisted) return;
  hoisted = true;
  for (const key of Object.keys(env)) {
    if (process.env[key] !== undefined) continue;
    const value = env[key];
    if (value === undefined || value === '') continue;
    process.env[key] = value;
  }
}

// Auto-hoist on import. `hooks.server.ts` imports this once, before any
// request handler runs, so downstream `process.env` reads see the full set.
hoistDynamicEnvIntoProcessEnv();
