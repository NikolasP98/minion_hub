import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';

export default defineConfig({
  plugins: [svelte({ hot: false })],
  test: {
    include: ['src/**/*.test.ts'],
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
    },
  },
});
