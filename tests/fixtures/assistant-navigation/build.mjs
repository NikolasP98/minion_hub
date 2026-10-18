import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const hub = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = fileURLToPath(new URL('./', import.meta.url));
const out = process.env.MINION_NAVIGATION_FIXTURE_OUT;
const stubs = path.join(hub, 'src/server/test-utils/env-stubs');
if (!out) throw new Error('Set MINION_NAVIGATION_FIXTURE_OUT to an owned artifact directory');
await build({
  configFile: false,
  root: hub,
  envDir: false,
  plugins: [tailwindcss(), svelte({ configFile: false })],
  resolve: {
    alias: [
      { find: '$lib/access/can.svelte', replacement: path.join(fixture, 'access.ts') },
      { find: '$lib/navigation', replacement: path.join(fixture, 'navigation.ts') },
      {
        find: /^\$lib\/paraglide\/messages$/,
        replacement: path.join(hub, 'src/lib/paraglide/messages/en.js'),
      },
      { find: '$app/state', replacement: path.join(stubs, 'app-state.ts') },
      { find: '$app/navigation', replacement: path.join(stubs, 'app-navigation.ts') },
      { find: '$app/environment', replacement: path.join(stubs, 'app-environment.ts') },
      { find: '$env/dynamic/private', replacement: path.join(stubs, 'dynamic-private.ts') },
      { find: '$env/dynamic/public', replacement: path.join(stubs, 'dynamic-public.ts') },
      { find: '$env/static/public', replacement: path.join(stubs, 'static-public.ts') },
      { find: '$lib', replacement: path.join(hub, 'src/lib') },
    ],
    dedupe: ['svelte'],
  },
  build: {
    outDir: out,
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: path.join(fixture, 'main.ts'),
      output: { entryFileNames: 'entry.js', assetFileNames: '[name][extname]' },
    },
  },
});
fs.cpSync(path.join(hub, 'static/fonts'), path.join(out, 'fonts'), { recursive: true });
const css = fs
  .readdirSync(out)
  .filter((name) => name.endsWith('.css'))
  .map((name) => `<link rel="stylesheet" href="/${name}">`)
  .join('');
fs.writeFileSync(
  path.join(out, 'index.html'),
  `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}<title>Assistant navigation regression fixture</title></head><body><main id="app"></main><script type="module" src="/entry.js"></script></body></html>`,
);
console.log(JSON.stringify({ fixtureOutput: out }));
