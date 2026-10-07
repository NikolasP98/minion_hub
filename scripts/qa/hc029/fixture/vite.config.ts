import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const hub = path.resolve(import.meta.dirname, '../../../..');
const here = import.meta.dirname;
const stubs = path.join(hub, 'src/server/test-utils/env-stubs');

/** Static HC-029 fixture: real app.css + real DateRangeControls, no app shell, no login, no data. */
export default defineConfig({
  root: here,
  base: './',
  plugins: [tailwindcss(), svelte({ compilerOptions: { hmr: false } })],
  resolve: {
    alias: [
      { find: '$app/navigation', replacement: path.join(stubs, 'app-navigation.ts') },
      { find: '$app/state', replacement: path.join(stubs, 'app-state.ts') },
      { find: '$app/environment', replacement: path.join(stubs, 'app-environment.ts') },
      { find: '$env/dynamic/public', replacement: path.join(stubs, 'dynamic-public.ts') },
      { find: '$env/static/public', replacement: path.join(stubs, 'static-public.ts') },
      { find: /^\$lib/, replacement: path.join(hub, 'src/lib') },
    ],
  },
  build: { outDir: process.env.HC029_OUT ?? path.join(here, 'dist'), emptyOutDir: true },
});
