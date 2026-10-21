import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [svelte({ configFile: false }), tailwindcss()],
  build: { outDir: '../desktop-dist', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5201, strictPort: true },
});
