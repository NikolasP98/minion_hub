import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hub = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = fileURLToPath(new URL('./', import.meta.url));
const stubs = hub + 'src/server/test-utils/env-stubs/';
const out =
  process.env.MINION_ARIA_FIXTURE_OUT ??
  fs.mkdtempSync(path.join(os.tmpdir(), 'minion-aria-fixture-'));
if (process.env.MINION_ARIA_FIXTURE_OUT && fs.existsSync(out))
  throw new Error('Fresh output required');
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'minion-aria-cache-'));

await build({
  configFile: false,
  envDir: false,
  cacheDir: cache,
  root: hub,
  plugins: [tailwindcss(), svelte({ configFile: false })],
  // The env stubs read `process.env`, which a browser does not have.
  define: { 'process.env': '{}' },
  resolve: {
    // The real compiled messages (`bun run i18n:compile`) are used; only SvelteKit's virtual
    // modules are replaced, by the same stubs Vitest uses.
    alias: {
      $lib: hub + '/src/lib',
      '$app/environment': fixture + 'app-environment.js',
      ...Object.fromEntries(
        ['state', 'stores', 'paths', 'navigation', 'forms'].map((name) => [
          `$app/${name}`,
          `${stubs}app-${name}.ts`,
        ]),
      ),
      '$env/dynamic/public': stubs + 'dynamic-public.ts',
      '$env/static/public': stubs + 'static-public.ts',
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
fs.writeFileSync(
  out + '/index.html',
  `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}<title>Minion aria snapshot fixture</title></head><body><div id="app"></div><script type="module" src="/entry.js"></script></body></html>`,
);

fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
for (const match of fs
  .readFileSync(path.join(hub, 'src/app.css'), 'utf8')
  .matchAll(/\/fonts\/([^)'"\s]+)/g)) {
  fs.copyFileSync(path.join(hub, 'static/fonts', match[1]), path.join(out, 'fonts', match[1]));
}
console.log(JSON.stringify({ out }));
