// HC-040 native evidence fixture: the actual FlowExports (and the installed
// shared Button) mounted behind synthetic flow data and a parked fetch.
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
const { preprocessor } = await import(
  path.join(hub, 'node_modules/@inlang/paraglide-sveltekit/dist/vite/preprocessor/index.js')
);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'minion-hc040-'));
const out = path.resolve(process.env.MINION_HC040_FIXTURE_OUT ?? path.join(work, 'bundle'));
if (fs.existsSync(out)) throw new Error('HC-040 fixture output must be fresh');

const productInputs = new Set();
await build({
  configFile: false,
  root: hub,
  envDir: false,
  cacheDir: path.join(work, 'cache'),
  logLevel: 'warn',
  plugins: [
    tailwindcss(),
    svelte({ configFile: false, preprocess: [preprocessor({})] }),
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
  define: { __APP_VERSION__: JSON.stringify('hc040-v1') },
  resolve: {
    alias: [
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
  `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}<title>Flow export ownership evidence</title></head><body><div id="app"></div><script type="module" src="/entry.js"></script></body></html>`,
);

fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
for (const match of fs
  .readFileSync(path.join(hub, 'src/app.css'), 'utf8')
  .matchAll(/\/fonts\/([^)'"\s]+)/g)) {
  const target = path.join(out, 'fonts', match[1]);
  if (!fs.existsSync(target)) fs.copyFileSync(path.join(hub, 'static/fonts', match[1]), target);
}

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: hub, encoding: 'utf8' }).trim();
fs.writeFileSync(
  path.join(out, 'fixture-manifest.json'),
  JSON.stringify(
    {
      fixtureVersion: 'hc040-v1',
      builtAt: new Date().toISOString(),
      gitHead,
      worktreeDirty: execFileSync('git', ['status', '--porcelain', '--', 'src/lib/components/flow-editor', 'messages'], { cwd: hub, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
      nodeVersion: process.version,
      inputs: fs
        .readdirSync(fixture)
        .filter((name) => fs.statSync(path.join(fixture, name)).isFile())
        .map((name) => ({ name, sha256: sha256(path.join(fixture, name)) })),
      productionSources: [...productInputs]
        .sort()
        .map((file) => ({ name: path.relative(hub, file), sha256: sha256(file) })),
      installedButton: sha256(path.join(hub, 'node_modules/@minion-stack/ui/dist/Button.svelte')),
      seams: [
        'Actual FlowExports and installed shared Button; flow data and PATCH replies are synthetic',
        'fetch refuses every request except the export PATCH; replies are parked until the harness settles them',
        'No logged-in session, no production data, no production writes',
      ],
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ fixtureOutput: out, fixtureVersion: 'hc040-v1' }));
