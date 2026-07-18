/**
 * Bun plugin that lets bun scripts import the SvelteKit server graph (services
 * that use `$server/*` aliases and transitively pull SvelteKit virtuals like
 * $env/dynamic/private and $app/environment, which bare bun can't resolve).
 *
 * Import this file (side-effect) BEFORE dynamically importing any `$server`
 * module, or pass it via `bun --preload scripts/_sveltekit-bun-shim.ts <file>`.
 * It shims the virtuals to process.env and maps $server/$lib to src/*.
 */
import { plugin } from 'bun';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// bun runtime plugins only honor virtual `build.module` (onResolve path-rewrites
// don't fire at runtime), so we register each `$server/*` VALUE specifier the
// runtime graph needs as a virtual that re-exports the real file (imported by
// its absolute path, which bun resolves natively). `import type` specifiers are
// erased by bun, so type-only aliases ($server/auth/core-ctx) need no shim.
const SERVER_VALUE_MODULES = ['$server/db/with-org-core', '$server/llm'];

plugin({
  name: 'sveltekit-bun-shim',
  setup(build) {
    const envMod = { exports: { env: process.env }, loader: 'object' as const };
    build.module('$env/dynamic/private', () => envMod);
    build.module('$env/dynamic/public', () => envMod);
    build.module('$app/environment', () => ({
      exports: { dev: false, browser: false, building: false },
      loader: 'object' as const,
    }));
    for (const spec of SERVER_VALUE_MODULES) {
      const real = join(ROOT, 'src/server', `${spec.slice('$server/'.length)}.ts`);
      build.module(spec, async () => ({ exports: { ...(await import(real)) }, loader: 'object' as const }));
    }
  },
});
