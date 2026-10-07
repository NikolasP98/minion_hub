import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hub = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = fileURLToPath(new URL('./', import.meta.url));
const stubs = path.join(hub, 'src/server/test-utils/env-stubs');
const out = process.env.MINION_ROLE_BUTTON_OUT ?? '/tmp/minion-role-button-fixture';

await build({
  configFile: false,
  root: hub,
  envDir: false,
  plugins: [tailwindcss(), svelte({ configFile: false })],
  define: { __APP_VERSION__: JSON.stringify('role-button-fixture') },
  resolve: {
    // Same SvelteKit virtual-module stubs vitest uses; English messages
    // directly so no locale runtime is loaded.
    alias: [
      { find: /^\$lib\/paraglide\/messages$/, replacement: path.join(hub, 'src/lib/paraglide/messages/en.js') },
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
      input: path.join(fixture, 'main.js'),
      output: { entryFileNames: 'entry.js', assetFileNames: '[name][extname]' },
    },
  },
});
const css = fs
  .readdirSync(out)
  .filter((x) => x.endsWith('.css'))
  .map((x) => `<link rel="stylesheet" href="/${x}">`)
  .join('');
fs.writeFileSync(
  out + '/index.html',
  `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}<title>HC-027 role button keyboard fixture</title></head><body><div id="app"></div><script type="module" src="/entry.js"></script></body></html>`,
);
console.log(JSON.stringify({ fixtureOutput: out }));
