import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';

export default defineConfig({
  plugins: [svelte({ compilerOptions: { hmr: false } })],
  resolve: {
    // Keep Node's condition while opting Svelte's root export into its client
    // entry. `browser` alone makes Vite 8's Rolldown optimizer treat its own
    // node:module import as a browser dependency under Bun.
    conditions: ['node', 'module', 'browser', 'development|production'],
  },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    setupFiles: ['src/server/test-utils/setup.ts'],
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
      // …and for `$app/state`, which `$lib/components/ui` reaches through
      // `access/can.svelte.ts`. A component-mounting test cannot cover this
      // with `vi.mock` alone: the import is resolved while Vite transforms the
      // component graph, before the mock registry applies.
      '$app/state': path.resolve('src/server/test-utils/env-stubs/app-state.ts'),
    },
  },
});
