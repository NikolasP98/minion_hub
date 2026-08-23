import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';

export default defineConfig({
  plugins: [svelte({ compilerOptions: { hmr: false } })],
  resolve: {
    // `svelte`'s package.json routes the default condition to its SSR build,
    // which throws `lifecycle_function_unavailable` on `Svelte.mount` — the
    // client build (needed by @testing-library/svelte) only resolves under
    // the `browser` condition. Gated on VITEST so it never affects the app
    // build. See vitest.config.ts's export-map safety note below.
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
