import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const hub = path.resolve(import.meta.dirname, '../../../..');
const here = import.meta.dirname;

/** Static HC-043 fixture: real app.css + real ChatMessage markup, no app shell, no login. */
export default defineConfig({
  root: here,
  base: './',
  plugins: [tailwindcss(), svelte({ compilerOptions: { hmr: false } })],
  resolve: {
    alias: [
      {
        find: /^.*state\/features\/aliases\.svelte$/,
        replacement: path.join(here, 'stubs/aliases.ts'),
      },
      { find: /^.*ChatBlocks\.svelte$/, replacement: path.join(here, 'stubs/Empty.svelte') },
      { find: /^.*AIDisclosureBadge\.svelte$/, replacement: path.join(here, 'stubs/Empty.svelte') },
      {
        find: /^\$lib\/paraglide\/runtime$/,
        replacement: path.join(here, 'stubs/paraglide-runtime.ts'),
      },
      { find: /^\$lib/, replacement: path.join(hub, 'src/lib') },
    ],
  },
  build: { outDir: process.env.HC043_OUT ?? path.join(here, 'dist'), emptyOutDir: true },
});
