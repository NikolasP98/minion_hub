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
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'minion-mention-directory-'));
const out = path.resolve(process.env.MINION_MENTION_FIXTURE_OUT ?? path.join(work, 'bundle'));
if (fs.existsSync(out)) throw new Error('Mention directory fixture output must be fresh');

const phase = process.env.MINION_MENTION_PHASE ?? 'after';
if (!['before', 'after'].includes(phase)) throw new Error('Invalid phase');
let beforeAliasSource = null;
if (phase === 'before') {
  beforeAliasSource = execFileSync(
    'git',
    ['show', '909b13ec097c6d5a7752013f3a9cf9082e0b448a:src/lib/state/features/aliases.svelte.ts'],
    { cwd: hub, encoding: 'utf8' },
  );
  // Compatibility hook only: original cache and fetch/invalidation behavior remain intact.
  fs.writeFileSync(
    path.join(work, 'before-aliases.svelte.ts'),
    beforeAliasSource +
      '\nimport { onMount } from "svelte";\nexport function useAliasDirectory() { onMount(() => { void ensureAliases(); }); }\n',
  );
  fs.symlinkSync(path.join(hub, 'node_modules'), path.join(work, 'node_modules'), 'dir');
}
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
  define: {
    __APP_VERSION__: JSON.stringify('mention-directory-v1'),
    'import.meta.env.VITE_MENTION_PHASE': JSON.stringify(phase),
  },
  resolve: {
    alias: [
      ...(phase === 'before'
        ? [
            {
              find: /^\$lib\/state\/features\/aliases\.svelte$/,
              replacement: path.join(work, 'before-aliases.svelte.ts'),
            },
          ]
        : []),
      { find: '$app/state', replacement: path.join(fixture, 'page.svelte.ts') },
      { find: /^\$lib\/state\/gateway$/, replacement: path.join(fixture, 'seams.ts') },
      ...[
        '$app/environment',
        '@sentry/sveltekit',
        'posthog-js',
        '$lib/state/agents/agent-skills.svelte',
        '$lib/state/agents/agent-resource-owner.svelte',
        '$lib/state/agents/gateway-tool-catalog.svelte',
        '$lib/state/features/channel-sources.svelte',
      ].map((find) => ({ find, replacement: path.join(fixture, 'seams.ts') })),
      {
        find: '$app/navigation',
        replacement: path.join(hub, 'src/server/test-utils/env-stubs/app-navigation.ts'),
      },
      {
        find: '$env/dynamic/public',
        replacement: path.join(hub, 'src/server/test-utils/env-stubs/dynamic-public.ts'),
      },
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
  `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}<title>Mention directory evidence</title></head><body><div id="app"></div><script type="module" src="/entry.js"></script></body></html>`,
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
  process.env.MINION_MENTION_SOURCE_REVISION ??
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: hub, encoding: 'utf8' }).trim();
if (!/^[0-9a-f]{40}$/.test(gitHead))
  throw new Error('Source revision must be a canonical commit SHA');
fs.writeFileSync(
  path.join(out, 'fixture-manifest.json'),
  JSON.stringify(
    {
      fixtureVersion: 'mention-directory-v1',
      builtAt: new Date().toISOString(),
      gitHead,
      nodeVersion: process.version,
      work,
      inputs,
      productionSources,
      dependencyLock: sha256(path.join(hub, 'bun.lock')),
      phase,
      beforeAliasSha256: beforeAliasSource
        ? createHash('sha256').update(beforeAliasSource).digest('hex')
        : null,
      seams: [
        'Actual ChatMessage and ChatInput; source hashes recorded',
        'Synthetic page identity, directory fetch and disconnected unrelated Gateway resources',
        'Before uses original alias cache from 909b13ec with a lifecycle compatibility hook only',
        'No logged-in session, no production writes, no external telemetry',
      ],
      fonts,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ fixtureOutput: out, fixtureVersion: 'mention-directory-v1' }));
