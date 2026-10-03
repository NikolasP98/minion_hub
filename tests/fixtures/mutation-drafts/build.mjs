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
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'minion-mutation-drafts-'));
const out = path.resolve(
  process.env.MINION_MUTATION_DRAFTS_FIXTURE_OUT ?? path.join(work, 'bundle'),
);
if (fs.existsSync(out)) throw new Error('Mutation draft fixture output must be fresh');

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
  define: { __APP_VERSION__: JSON.stringify('mutation-drafts-v1') },
  resolve: {
    alias: [
      {
        find: /^\$lib\/components\/ui\/foundations$/,
        replacement: path.join(fixture, 'foundations.ts'),
      },
      { find: /^\$app\/navigation$/, replacement: path.join(fixture, 'navigation.ts') },
      { find: /^\$app\/state$/, replacement: path.join(fixture, 'state.svelte.ts') },
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
  `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}<title>Mutation draft evidence</title></head><body><div id="app"></div><script type="module" src="/entry.js"></script></body></html>`,
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

const inputs = [
  'Fixture.svelte',
  'BeforePulse.svelte',
  'BeforeScheduling.svelte',
  'main.ts',
  'ui.ts',
  'foundations.ts',
  'navigation.ts',
  'state.svelte.ts',
  'build.mjs',
  '$types.ts',
].map((name) => ({
  name,
  sha256: sha256(path.join(fixture, name)),
}));
const productionSources = [...productInputs]
  .sort()
  .map((file) => ({ name: path.relative(hub, file), sha256: sha256(file) }));
const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: hub, encoding: 'utf8' }).trim();
fs.writeFileSync(
  path.join(out, 'fixture-manifest.json'),
  JSON.stringify(
    {
      fixtureVersion: 'mutation-drafts-v1',
      builtAt: new Date().toISOString(),
      gitHead,
      nodeVersion: process.version,
      work,
      inputs,
      productionSources,
      dependencyLock: sha256(path.join(hub, 'bun.lock')),
      beforeSourceCommit: 'fae8ff43d44f4a0fd8bb0565c32bc51182f18d7a',
      seams: [
        'Actual Pulse and Scheduling pages; before copies are verbatim from the named signed source',
        'Synthetic proposals and event kinds; no logged-in or production session',
        'Synthetic fetch acknowledges or loses replies only after explicit fixture controls',
        'Synthetic invalidate counts reads and can throw; no SvelteKit router or database',
        'Real action runtime and current-scope reset; no real writes or notifications',
      ],
      fonts,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ fixtureOutput: out, fixtureVersion: 'mutation-drafts-v1' }));
