import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hub = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = fileURLToPath(new URL('./', import.meta.url));
const out =
  process.env.MINION_CHART_FIXTURE_OUT ??
  fs.mkdtempSync(path.join(os.tmpdir(), 'minion-chart-fixture-'));
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'minion-chart-cache-'));

await build({
  configFile: false,
  envDir: false,
  cacheDir: cache,
  root: hub,
  plugins: [tailwindcss(), svelte({ configFile: false })],
  resolve: {
    alias: { '$lib/paraglide/messages': fixture + 'messages.js', $lib: hub + '/src/lib' },
    dedupe: ['svelte'],
  },
  build: {
    outDir: out,
    emptyOutDir: false,
    minify: false,
    rollupOptions: {
      input: fixture + 'main.js',
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
  `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}<title>Minion isolated chart accessibility verification</title></head><body><div id="app"></div><script type="module" src="/entry.js"></script></body></html>`,
);
