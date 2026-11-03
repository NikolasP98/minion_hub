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
  process.env.MINION_CLINIC_OUT ?? fs.mkdtempSync(path.join(os.tmpdir(), 'minion-clinic-fixture-'));
await build({
  configFile: false,
  envDir: false,
  root: hub,
  cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'minion-clinic-cache-')),
  plugins: [
    {
      name: 'no-server-preference-writes',
      enforce: 'pre',
      resolveId(id) {
        if (/preference-sync\.svelte(?:\.ts)?$/.test(id)) return fixture + 'preference-sync.js';
      },
    },
    tailwindcss(),
    svelte({ configFile: false }),
  ],
  resolve: {
    alias: {
      '$app/navigation': hub + 'tests/fixtures/mobile-composition/stubs/app-navigation.js',
      '$app/environment': hub + 'tests/fixtures/mobile-composition/stubs/app-environment.js',
      $lib: hub + 'src/lib',
    },
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
fs.cpSync(path.join(hub, 'static/fonts'), path.join(out, 'fonts'), { recursive: true });
fs.writeFileSync(
  path.join(out, 'index.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}<title>Clinic theme · production component fixture</title></head><body><div id="app"></div><script type="module" src="/entry.js"></script></body></html>`,
);
const tokenCss = fs.readFileSync(
  path.join(hub, 'node_modules/@minion-stack/design-tokens/tokens.css'),
  'utf8',
);
fs.writeFileSync(
  path.join(out, 'tokens.json'),
  JSON.stringify([
    ...new Set([...tokenCss.matchAll(/^\s*(--[\w-]+):/gm)].map((match) => match[1])),
  ]),
);
console.log(out);
