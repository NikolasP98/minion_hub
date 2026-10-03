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
// Use the installed preprocessor wired by the real svelte.config.js. Importing
// this small module avoids invoking the separate message compiler/telemetry.
const { preprocessor } = await import(
  path.join(hub, 'node_modules/@inlang/paraglide-sveltekit/dist/vite/preprocessor/index.js')
);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'minion-button-semantics-'));
const out = path.resolve(process.env.MINION_BUTTON_FIXTURE_OUT ?? path.join(work, 'bundle'));
if (fs.existsSync(out)) throw new Error('Button semantics fixture output must be fresh');

const uiArchive = path.resolve(
  process.env.MINION_BUTTON_UI_ARCHIVE ??
    path.join(hub, 'deps/minion-stack-ui-0.1.0-readiness.1.tgz'),
);
execFileSync('tar', ['-xzf', uiArchive, '-C', work]);
const uiPackage = path.join(work, 'package');
// Resolve peer dependencies from the actual consumer without modifying its install.
fs.symlinkSync(path.join(hub, 'node_modules'), path.join(uiPackage, 'node_modules'), 'dir');
const productInputs = new Set();
await build({
  configFile: false,
  root: hub,
  envDir: false,
  cacheDir: path.join(work, 'cache'),
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
  define: { __APP_VERSION__: JSON.stringify('button-semantics-v1') },
  resolve: {
    alias: [
      { find: /^@minion-stack\/ui$/, replacement: path.join(uiPackage, 'dist/index.js') },
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
  `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}<title>Button semantics evidence</title></head><body><div id="app"></div><script type="module" src="/entry.js"></script></body></html>`,
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

const inputs = fs
  .readdirSync(fixture)
  .filter((name) => fs.statSync(path.join(fixture, name)).isFile())
  .map((name) => ({ name, sha256: sha256(path.join(fixture, name)) }));
const productionSources = [...productInputs]
  .sort()
  .map((file) => ({ name: path.relative(hub, file), sha256: sha256(file) }));
const gitHead =
  process.env.MINION_BUTTON_SOURCE_REVISION ??
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: hub, encoding: 'utf8' }).trim();
if (!/^[0-9a-f]{40}$/.test(gitHead))
  throw new Error('Source revision must be a canonical commit SHA');
fs.writeFileSync(
  path.join(out, 'fixture-manifest.json'),
  JSON.stringify(
    {
      fixtureVersion: 'button-semantics-v1',
      builtAt: new Date().toISOString(),
      gitHead,
      nodeVersion: process.version,
      work,
      inputs,
      productionSources,
      dependencyLock: sha256(path.join(hub, 'bun.lock')),
      uiArchive: { name: path.basename(uiArchive), sha256: sha256(uiArchive) },
      packedButton: {
        runtime: sha256(path.join(uiPackage, 'dist/Button.svelte')),
        declaration: sha256(path.join(uiPackage, 'dist/Button.svelte.d.ts')),
      },
      seams: [
        'Actual packed Button and actual FlowExports; exact archive/source hashes recorded',
        'Synthetic rows and PATCH response; fetch refuses all other requests',
        'Real native keyboard, focus, link and form behavior; no logged-in session or production writes',
      ],
      fonts,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ fixtureOutput: out, fixtureVersion: 'button-semantics-v1' }));
