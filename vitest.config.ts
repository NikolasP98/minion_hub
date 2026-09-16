import { configDefaults, defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';

const sqlLane = Object.keys(process.env).some((key) => /^REQUIRE_[A-Z_]+_POSTGRES$/.test(key));

export default defineConfig({
  plugins: [svelte({ compilerOptions: { hmr: false } })],
  resolve: {
    // Keep Node's condition while opting Svelte's root export into its client
    // entry. `browser` alone makes Vite 8's Rolldown optimizer treat its own
    // node:module import as a browser dependency under Bun.
    conditions: ['node', 'module', 'browser', 'development|production'],
  },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'tests/dependencies/**/*.test.ts'],
    // SQL fixtures belong to the explicit marked-runtime qualification lane: the CI
    // Postgres jobs opt in by setting a REQUIRE_*_POSTGRES marker; an ordinary run
    // (including a full local run with .env present) never discovers them.
    exclude: sqlLane
      ? configDefaults.exclude
      : [
          ...configDefaults.exclude,
          '**/*.sql.integration.test.ts',
          // Eager application-environment SQL fixture; split/migrate before admission.
          'src/server/services/brain-business-persistence.service.test.ts',
          'src/server/services/crm-funnel.concurrent.integration.test.ts',
        ],
    setupFiles: ['src/server/test-utils/setup.ts'],
    // Default hookTimeout (10s) is too tight for the ~12 files that spin up a
    // real PGlite (WASM Postgres) instance in beforeAll/beforeEach: startup is
    // CPU-bound, and under CI's parallel worker load it routinely exceeds 10s
    // even though the same hook finishes in ~1-2s run in isolation. This was
    // the actual cause behind `--retry=2` in the CI "Unit tests" step failing
    // to fully absorb load-induced flakes (e.g. scheduling-bookings-atomic.test.ts
    // and attachments.service.test.ts beforeAll/beforeEach hook timeouts,
    // reproduced locally by running the full suite back-to-back under load).
    hookTimeout: 30_000,
    alias: {
      $lib: path.resolve('src/lib'),
      $server: path.resolve('src/server'),
      // SvelteKit virtual $env modules don't resolve under vitest (no sveltekit
      // plugin). Alias them to stubs so any transitive import works; tests that
      // need specific values still override via vi.mock('$env/...').
      '$env/dynamic/private': path.resolve('src/server/test-utils/env-stubs/dynamic-private.ts'),
      '$env/dynamic/public': path.resolve('src/server/test-utils/env-stubs/dynamic-public.ts'),
      '$env/static/public': path.resolve('src/server/test-utils/env-stubs/static-public.ts'),
      // Same story for `$app/environment` (tanstack query client reads `browser`).
      '$app/environment': path.resolve('src/server/test-utils/env-stubs/app-environment.ts'),
      '$app/state': path.resolve('src/server/test-utils/env-stubs/app-state.ts'),
    },
  },
});
