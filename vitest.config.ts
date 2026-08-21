import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';

export default defineConfig({
  plugins: [svelte({ compilerOptions: { hmr: false } })],
  // Svelte's package.json routes the default export condition to its SSR build,
  // which throws `lifecycle_function_unavailable` on client-only APIs (e.g.
  // `mount`). Enabling the `browser` condition under Vitest resolves the client
  // build instead — needed for @testing-library/svelte DOM-mount tests. Verified
  // safe against every dependency with an `exports` map that could be affected
  // (postgres, drizzle-orm, @electric-sql/pglite: none declare a `browser`
  // condition; svelte's `./server` subpath used by SSR-string tests only has a
  // `default` condition, so it's unaffected).
  resolve: {
    conditions: process.env.VITEST ? ['browser'] : [],
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
    },
  },
});
