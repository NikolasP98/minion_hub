import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

const hub = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = fileURLToPath(new URL('./', import.meta.url));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'minion-notification-health-'));
const out = path.resolve(
  process.env.MINION_NOTIFICATION_HEALTH_FIXTURE_OUT ?? path.join(work, 'bundle'),
);
if (fs.existsSync(out)) throw new Error('Notification health fixture output must be fresh');

const productInputs = new Set();
await build({
  configFile: false,
  root: hub,
  envDir: false,
  cacheDir: path.join(work, 'cache'),
  plugins: [
    tailwindcss(),
    svelte({ configFile: false }),
    {
      name: 'fixture-source-provenance',
      generateBundle() {
        for (const id of this.getModuleIds()) {
          const source = id.split('?')[0];
          if (source.startsWith(path.join(hub, 'src') + path.sep) && fs.existsSync(source)) {
            productInputs.add(source);
          }
        }
      },
    },
  ],
  define: { __APP_VERSION__: JSON.stringify('notification-health-v4') },
  resolve: {
    alias: [
      { find: /^\$app\/navigation$/, replacement: path.join(fixture, 'navigation.ts') },
      { find: /^\$app\/state$/, replacement: path.join(fixture, 'state.ts') },
      { find: /^\$lib\/components\/ui$/, replacement: path.join(fixture, 'ui.ts') },
      { find: '$lib', replacement: path.join(hub, 'src/lib') },
    ],
    dedupe: ['svelte'],
  },
  build: {
    outDir: out,
    emptyOutDir: false,
    minify: false,
    rollupOptions: {
      input: path.join(fixture, 'main.ts'),
      output: { entryFileNames: 'entry.js', assetFileNames: '[name][extname]' },
    },
  },
});

const css = fs
  .readdirSync(out)
  .filter((name) => name.endsWith('.css'))
  .map((name) => `<link rel="stylesheet" href="/${name}">`)
  .join('');
fs.writeFileSync(
  path.join(out, 'index.html'),
  `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}<title>Notification health evidence</title></head><body><div id="app"></div><script type="module" src="/entry.js"></script></body></html>`,
);

fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
const fonts = [];
for (const match of fs
  .readFileSync(path.join(hub, 'src/app.css'), 'utf8')
  .matchAll(/\/fonts\/([^)'"\s]+)/g)) {
  const name = match[1];
  if (fonts.some((font) => font.name === name)) continue;
  const bytes = fs.readFileSync(path.join(hub, 'static/fonts', name));
  fs.writeFileSync(path.join(out, 'fonts', name), bytes);
  fonts.push({ name, sha256: createHash('sha256').update(bytes).digest('hex') });
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const inputs = ['Fixture.svelte', 'main.ts', 'ui.ts', 'navigation.ts', 'state.ts', 'build.mjs'].map(
  (name) => ({
    name,
    sha256: sha256(path.join(fixture, name)),
  }),
);
const productionSources = [...productInputs]
  .sort()
  .map((file) => ({ name: path.relative(hub, file), sha256: sha256(file) }));
const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: hub, encoding: 'utf8' }).trim();
fs.writeFileSync(
  path.join(out, 'fixture-manifest.json'),
  JSON.stringify(
    {
      fixtureVersion: 'notification-health-v4',
      builtAt: new Date().toISOString(),
      gitHead,
      nodeVersion: process.version,
      work,
      inputs,
      productionSources,
      dependencyLock: sha256(path.join(hub, 'bun.lock')),
      seams: [
        'Synthetic PageData for one enabled legacy rule and actor/organization health seed',
        'Synthetic notification-health GET transport, including ignored-abort delayed response',
        'No SvelteKit router or authenticated session; legacy-rule writes are not exercised, while their rendered mobile action bounds, editor reveal/focus and Cancel focus return are evidence targets',
        'Synthetic successful SvelteKit page state exists only for the dormant checked-refresh seam; this fixture dispatches no legacy-rule write',
      ],
      fonts,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ fixtureOutput: out, fixtureVersion: 'notification-health-v4' }));
