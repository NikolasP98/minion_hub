/**
 * Builds the isolated mobile-composition fixture: the ACTUAL Home and
 * scheduling Calendar route components, production-bundled with synthetic data
 * and SvelteKit `$app/*` stubs. No auth, no server routes, no network, no
 * business mutation. See README.md.
 */
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hub = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = fileURLToPath(new URL('./', import.meta.url));
const out =
  process.env.MINION_MOBILE_FIXTURE_OUT ??
  fs.mkdtempSync(path.join(os.tmpdir(), 'minion-mobile-composition-'));
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'minion-mobile-cache-'));
console.log(JSON.stringify({ fixtureOutput: out, fixtureCache: cache }));

await build({
  configFile: false,
  envDir: false,
  cacheDir: cache,
  root: hub,
  plugins: [tailwindcss(), svelte({ configFile: false })],
  define: { __APP_VERSION__: JSON.stringify('mobile-composition-fixture') },
  resolve: {
    alias: {
      '$app/navigation': fixture + 'stubs/app-navigation.js',
      '$env/dynamic/public': fixture + 'stubs/env-public.js',
      '$env/static/public': fixture + 'stubs/env-public.js',
      '$app/environment': fixture + 'stubs/app-environment.js',
      '$app/state': fixture + 'stubs/app-state.js',
      '$app/stores': fixture + 'stubs/app-stores.js',
      $lib: hub + 'src/lib',
    },
    dedupe: ['svelte'],
  },
  build: {
    outDir: out,
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: {
        calendar: fixture + 'calendar.js',
        home: fixture + 'home.js',
        calls: fixture + 'calls.js',
      },
      output: { entryFileNames: '[name].js', assetFileNames: '[name][extname]' },
    },
  },
});

// Include only the actual public font files used by app.css, not unrelated static data.
const fontRoot = path.join(hub, 'static/fonts');
const fontManifest = [];
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
for (const name of fs.readdirSync(fontRoot).sort()) {
  const source = path.join(fontRoot, name);
  if (!fs.lstatSync(source).isFile() || !/\.(woff2?|ttf|otf)$/.test(name)) continue;
  const bytes = fs.readFileSync(source);
  fs.writeFileSync(path.join(out, 'fonts', name), bytes);
  fontManifest.push({
    path: `fonts/${name}`,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}
fs.writeFileSync(path.join(out, 'font-manifest.json'), JSON.stringify(fontManifest, null, 2));

const css = fs
  .readdirSync(out)
  .filter((x) => x.endsWith('.css'))
  .map((x) => `<link rel="stylesheet" href="/${x}">`)
  .join('');
for (const page of ['calendar', 'home', 'calls']) {
  fs.writeFileSync(
    `${out}/${page}.html`,
    `<!doctype html><html data-theme="dark" lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}<title>Minion mobile composition fixture — ${page}</title></head><body><div id="app"></div><script type="module" src="/${page}.js"></script></body></html>`,
  );
}
