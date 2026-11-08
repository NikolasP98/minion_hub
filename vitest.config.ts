import { configDefaults, defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';
import { NATIVE_POSTGRES_EXCLUDES } from './scripts/qc/native-postgres-manifest';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
const sqlLane = Object.keys(process.env).some(key => /^REQUIRE_[A-Z_]+_POSTGRES$/.test(key));
export default defineConfig({
  plugins: [svelte({
    compilerOptions: {
      hmr: false
    }
  })],
  resolve: {
    // Keep Node's condition while opting Svelte's root export into its client
    // entry. `browser` alone makes Vite 8's Rolldown optimizer treat its own
    // node:module import as a browser dependency under Bun.
    conditions: ['node', 'module', 'browser', 'development|production']
  },
  test: {
    projects: [{
      extends: true,
      test: {
        name: 'unit',
        include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'tests/dependencies/**/*.test.ts', 'tests/e2e/ui-audit/**/*.test.ts'],
        // SQL fixtures belong to the explicit marked-runtime qualification lane: the CI
        // Postgres jobs opt in by setting a REQUIRE_*_POSTGRES marker; an ordinary run
        // (including a full local run with .env present) never discovers them.
        exclude: sqlLane ? configDefaults.exclude : [...configDefaults.exclude, ...NATIVE_POSTGRES_EXCLUDES],
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
          // `$lib/navigation` (locale-aware `goto`) and `$lib/records/peek.svelte`
          // (record open-mode shallow routing) transitively import this.
          '$app/navigation': path.resolve('src/server/test-utils/env-stubs/app-navigation.ts')
        }
      }
    },
    // Story tests run in a real browser (Playwright Chromium). They are opt-in so the
    // ordinary suite and the CI lanes without browsers stay unchanged: `bun run test:storybook`.
    ...(process.env.STORYBOOK_TESTS ? [{
      extends: true,
      plugins: [
      // The plugin will run tests for the stories defined in your Storybook config
      // See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
      storybookTest({
        configDir: path.join(dirname, '.storybook')
      })],
      // Build-time defines from vite.config.ts that components read at module load.
      define: {
        __APP_VERSION__: JSON.stringify('storybook')
      },
      test: {
        name: 'storybook',
        // The Storybook dev server gets $lib/$server from the SvelteKit plugin; this
        // project only runs the plain Svelte plugin, so alias them here too.
        alias: {
          $lib: path.resolve('src/lib'),
          $server: path.resolve('src/server'),
          '$app/environment': path.resolve('.storybook/app-environment.ts'),
          '$env/dynamic/public': path.resolve('.storybook/env-shim.ts'),
          '$env/static/public': path.resolve('.storybook/env-shim.ts')
        },
        browser: {
          enabled: true,
          headless: true,
          provider: playwright({}),
          instances: [{
            browser: 'chromium'
          }]
        }
      }
    }] : [])]
  }
});
